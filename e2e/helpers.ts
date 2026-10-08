import { readFileSync } from 'node:fs';
import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { CardColor, KeywordsRoomData, KeywordsView, RoomView, Team } from '@reviewer2/shared';
import { io, type Socket } from 'socket.io-client';
import en from '../client/src/locales/en.json' with { type: 'json' };
import zh from '../client/src/locales/zh.json' with { type: 'json' };

// Helpers for the end-to-end tests. Every player is a separate browser context, so each has its
// own storage, token and connection, as on separate phones. Button labels come from the locale
// files, so the tests read the interface the way players do.

export type Language = 'en' | 'zh';
export const TEXT = { en, zh };

// A locale string with its {placeholders} filled in, as vue-i18n fills them.
export const interpolate = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (placeholder, key: string) => values[key] ?? placeholder);

// The button that offers a seat as a student of this group during a game.
export function playFor(team: Team, language: Language = 'en'): { name: string } {
  const text = TEXT[language];
  return { name: interpolate(text.game.playFor, { group: text.lobby.group[team] }) };
}

// Script errors on any page. A test fails at its end if there were any.
const pageErrors: string[] = [];
const contexts: BrowserContext[] = [];
const sockets: Socket[] = [];

// The server's log, one JSON object a line, which e2e/server.mjs writes. The lines written during
// a test are read at its end, because the server logs an error it caught, such as a view that
// the game module couldn't build, and goes on without the connection it was for; on a page that
// no assertion looks at, nothing else would show it.
const serverLog = process.env.E2E_SERVER_LOG;
if (!serverLog) throw new Error('E2E_SERVER_LOG must be set; playwright.config.ts sets it');

// The whole lines of the log from `from` on, and where they end, which is where the next read
// starts: a line that is still being written waits for the next read.
function logLines(from = 0): { lines: string[]; end: number } {
  const log = readFileSync(serverLog as string);
  const end = log.lastIndexOf('\n') + 1;
  const lines = log.subarray(from, end).toString().split('\n').filter(Boolean);
  return { lines, end };
}

// The errors among the log's lines: the error events, and anything that isn't a log line at all,
// such as the trace of a crash.
const serverErrors = (lines: string[]) =>
  lines.filter((line) => {
    try {
      return (JSON.parse(line) as { event?: string }).event === 'error';
    } catch {
      return true;
    }
  });

// The tests' own `test`: after each test, it closes every player's browser context, since a
// browser slows to a halt with dozens of them open, and every side channel, and then fails the
// test if any page had a script error or the server logged one.
export const test = base.extend<{ cleanup: void }>({
  cleanup: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const { end: start } = logLines();
      await use();
      for (const socket of sockets.splice(0)) socket.close();
      await Promise.all(contexts.splice(0).map((context) => context.close()));
      // Everything is taken out of the lists before the first check can fail, so that nothing
      // of this test is left for the next.
      const errors = pageErrors.splice(0);
      const pages = recorded.splice(0);
      const { lines } = logLines(start);
      expect(errors, 'script errors on the pages').toEqual([]);
      expect(serverErrors(lines), 'errors the server logged').toEqual([]);
      // Whatever a page received during the test is checked, whether or not the test looked at
      // it: no key outside a PI's seat, and nothing of another group's chat or choices.
      for (const states of pages) {
        expectNoKey(states);
        expectOwnGroupOnly(states);
      }
    },
    { auto: true },
  ],
});

export { expect };

// What a browser writes to the console when it can't reach the server, which the tests that cut
// the network or the WebSocket provoke: "Failed to load resource: ..." and "WebSocket
// connection to ... failed", worded a little differently by each browser.
const NETWORK_NOTICE = /Failed to load resource|WebSocket|network/i;

// A new player in the language: a browser context of their own, on the project's device.
export async function newPlayer(browser: Browser, language: Language = 'en'): Promise<Page> {
  const context = await browser.newContext({ locale: language === 'zh' ? 'zh-CN' : 'en-US' });
  contexts.push(context);
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  // The production build of Vue doesn't throw an error from a component, a watcher or a click
  // handler: it hands it to console.error, and the page goes on with what it had. Such an error
  // counts all the same.
  page.on('console', (message) => {
    if (message.type() === 'error' && !NETWORK_NOTICE.test(message.text())) pageErrors.push(message.text());
  });
  return page;
}

const snapshots = new WeakMap<Page, RoomView[]>();
// The lists of every page of the current test, for the checks at its end.
const recorded: RoomView[][] = [];

// Every room:state this page receives from the first call on, over WebSocket and over HTTP
// long-polling alike. Later calls for the same page return the same list.
export function snapshotsOf(page: Page): RoomView[] {
  const known = snapshots.get(page);
  if (known) return known;
  const states: RoomView[] = [];
  snapshots.set(page, states);
  recorded.push(states);
  // A Socket.IO event is "42", an acknowledgement ID if it asks for one, and the JSON array of
  // the event's name and its payload. A long-polling response carries several packets, with a
  // record separator between them. A packet that can't be read fails the test.
  const read = (text: string) => {
    for (const packet of text.split('\x1e')) {
      const json = /^42\d*(\[.*)$/s.exec(packet)?.[1];
      if (!json) continue;
      const [event, state] = JSON.parse(json) as [string, RoomView];
      if (event === 'room:state') states.push(state);
    }
  };
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') read(payload);
    }),
  );
  page.on('response', async (response) => {
    if (!response.url().includes('transport=polling') || response.request().method() !== 'GET') return;
    let text: string;
    try {
      text = await response.text();
    } catch {
      return; // the page went away before the body came
    }
    read(text);
  });
  return states;
}

// A snapshot that may hold the key: a PI's, by their seat in that same snapshot, or anyone's once
// the game is over. Whoever else has seen the key, such as a PI who left their seat, gets none
// (server/src/games/keywords/view.ts).
function mayHoldKey(state: RoomView): boolean {
  const { seats, game } = state.data as KeywordsRoomData;
  if (!game || game.phase === 'over') return true;
  return state.me !== null && seats[state.me]?.role === 'captain';
}

// Every path in a value at which an object has a key that names a color, as
// "data.game.cards.3.color".
function colorPaths(value: unknown, path = ''): string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const here = path ? `${path}.${key}` : key;
    return [...(/color/i.test(key) ? [here] : []), ...colorPaths(child, here)];
  });
}

// No snapshot sent to someone outside a PI's seat before the end of a game held the color of an
// unrevealed card: such a card has no `color` key at all, only its word and, when the word
// library has them, its translations, which everyone may see. Nor is a color anywhere else in
// the snapshot, under another name for the board or in the record of the clues, in which every
// guess is a revealed card. Returns how many unrevealed cards it checked, so that a test can tell
// that it looked at something.
export function expectNoKey(states: RoomView[]): number {
  let checked = 0;
  for (const state of states) {
    if (mayHoldKey(state)) continue;
    const game = (state.data as KeywordsRoomData).game as KeywordsView;
    for (const card of game.cards) {
      if (card.revealed) continue;
      expect(card).not.toHaveProperty('color');
      expect(Object.keys(card).filter((key) => !['word', 'revealed', 'translations'].includes(key))).toEqual([]);
      checked += 1;
    }
    const allowed = new Set([
      ...game.cards.flatMap((card, i) => (card.revealed ? [`data.game.cards.${i}.color`] : [])),
      ...game.history.flatMap((clue, i) =>
        clue.guesses.map((guess, j) => {
          expect(game.cards[guess.card]?.revealed, `the card of guess ${j} of clue ${i} is revealed`).toBe(true);
          return `data.game.history.${i}.guesses.${j}.color`;
        }),
      ),
    ]);
    expect(
      colorPaths(state).filter((path) => !allowed.has(path)),
      'colors anywhere but on the revealed cards',
    ).toEqual([]);
  }
  return checked;
}

// No snapshot that this page received during a game held another group's chat or its choices of
// cards. A page outside the groups has neither key; a page in a group has its own group's chat,
// and its choices only in its turn. Returns how many snapshots it checked.
export function expectOwnGroupOnly(states: RoomView[]): number {
  let checked = 0;
  // The group of every player this page has seen in a seat. A player who left the room is in no
  // seat any more, but what they wrote stays in their group's chat; nobody changes groups during
  // a game, so the group a player was last seen in is the one they wrote to.
  const groups = new Map<string, Team>();
  for (const state of states) {
    const { game, seats } = state.data as KeywordsRoomData;
    for (const [player, seat] of Object.entries(seats)) if (seat.team) groups.set(player, seat.team);
    if (!game) continue;
    checked += 1;
    const team = state.me === null ? null : (seats[state.me]?.team ?? null);
    if (team === null) {
      expect(game).not.toHaveProperty('chat');
      expect(game).not.toHaveProperty('selections');
      continue;
    }
    for (const { player } of game.chat ?? []) {
      expect(groups.get(player), `the group of ${player}, who wrote to the ${team} group`).toBe(team);
    }
    if (game.team !== team) expect(game).not.toHaveProperty('selections');
    for (const { player } of game.selections ?? []) {
      expect(groups.get(player), `the group of ${player}, who chose a card for the ${team} group`).toBe(team);
    }
  }
  return checked;
}

// A second connection for a player who is in the room, as another tab of theirs would open it.
// It lets a test send what the interface no longer offers, as an outdated page could.
export async function sideChannel(page: Page, url: string) {
  const token = await page.evaluate(() => localStorage.getItem('r2.token'));
  const socket = io(new URL(url).origin, { auth: { token }, transports: ['websocket'] });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(undefined));
    socket.once('connect_error', reject);
  });
  const send = (event: string, payload: object = {}) =>
    socket.timeout(5000).emitWithAck(event, payload) as Promise<object>;
  expect(await send('room:join', { code: url.split('/').at(-1) })).toMatchObject({ ok: true });
  return { send };
}

export async function createRoom(page: Page, language: Language, name: string): Promise<string> {
  const text = TEXT[language];
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(`^${text.language[language]}`) }).click();
  await page.getByRole('button', { name: text.home.newRoom }).click();
  await expect(page.locator('.fields li').first()).toBeVisible();
  await page.getByLabel(text.create.name).fill(name);
  await page.getByRole('button', { name: text.create.submit }).click();
  await page.waitForURL(/\/room\/[0-9A-Z]{4}$/);
  await expect(page.locator('.lobby')).toBeVisible();
  return page.url();
}

export async function joinByLink(page: Page, url: string, name: string, language: Language): Promise<void> {
  const text = TEXT[language];
  await page.goto(url);
  await page.getByLabel(text.room.join.name).fill(name);
  await page.getByRole('button', { name: text.room.join.submit, exact: true }).click();
  await expect(page.locator('.lobby, .keywords-game').first()).toBeVisible();
}

export async function sit(page: Page, team: Team, role: 'captain' | 'guesser', language: Language): Promise<void> {
  const text = TEXT[language];
  const label = role === 'captain' ? text.lobby.takeCaptain : text.lobby.joinAsGuesser;
  await page.locator(`.group.${team}`).getByRole('button', { name: label }).click();
}

export interface Table {
  language: Language;
  url: string;
  captains: Record<Team, Page>;
  guessers: Record<Team, Page>;
  // The names the pages above joined with.
  names: { captains: Record<Team, string>; guessers: Record<Team, string> };
  spectator: Page;
  screen: Page;
  // What the guessers, the spectator and the screen received, which must never hold the key.
  public: RoomView[][];
  // What every page at the table received, the PIs' included.
  everyone: RoomView[][];
}

// Ann chairs the room and is red's PI, Bob guesses for red, Cat is blue's PI and Dan guesses for
// blue. Eve watches, and a screen shows the room. `prepare` runs on each page before it joins,
// for a test that needs a player's connection set up in some other way. The game has started
// when this returns.
export async function seatTable(
  browser: Browser,
  language: Language,
  prepare?: (page: Page, name: string) => Promise<void>,
): Promise<Table> {
  const ann = await newPlayer(browser, language);
  snapshotsOf(ann);
  const url = await createRoom(ann, language, 'Ann');
  // The others join at the same time, as separate people do.
  const join = async (name: string) => {
    const page = await newPlayer(browser, language);
    snapshotsOf(page);
    await prepare?.(page, name);
    await joinByLink(page, url, name, language);
    return page;
  };
  const [bob, cat, dan, eve] = await Promise.all([join('Bob'), join('Cat'), join('Dan'), join('Eve')]);
  await Promise.all([
    sit(ann, 'red', 'captain', language),
    sit(bob, 'red', 'guesser', language),
    sit(cat, 'blue', 'captain', language),
    sit(dan, 'blue', 'guesser', language),
  ]);

  const screen = await newPlayer(browser, language);
  snapshotsOf(screen);
  await screen.goto(`${url}/screen`);
  await expect(screen.locator('.screen')).toBeVisible();

  const text = TEXT[language];
  await expect(ann.locator('.desk .ready')).toBeVisible();
  await ann.getByRole('button', { name: text.lobby.start }).click();
  for (const page of [ann, bob, cat, dan, eve]) await expect(page.locator('.keywords-game')).toBeVisible();
  // The screen shows the board too, so that a test's look at its cards finds them.
  await expect(screen.locator('.screen-game .board .card')).toHaveCount(25);
  return {
    language,
    url,
    captains: { red: ann, blue: cat },
    guessers: { red: bob, blue: dan },
    names: { captains: { red: 'Ann', blue: 'Cat' }, guessers: { red: 'Bob', blue: 'Dan' } },
    spectator: eve,
    screen,
    public: [bob, dan, eve, screen].map(snapshotsOf),
    everyone: [ann, bob, cat, dan, eve, screen].map(snapshotsOf),
  };
}

// The group whose turn it is, from the color of the turn strip.
export async function teamOnTurn(page: Page): Promise<Team> {
  const strip = page.locator('.strip');
  await expect(strip).toHaveClass(/\b(red|blue)\b/);
  return (await strip.evaluate((element) => element.classList.contains('red'))) ? 'red' : 'blue';
}

export async function giveClue(captain: Page, word: string, count: number | 'unlimited', language: Language) {
  const text = TEXT[language];
  await captain.getByLabel(text.game.clueInput).fill(word);
  await captain.getByRole('radio', { name: count === 'unlimited' ? text.game.unlimited : String(count) }).click();
  await captain.getByRole('button', { name: text.game.sendClue }).click();
}

// The index of a hidden card of this color, read from a PI's key.
export async function keyCard(captain: Page, color: CardColor): Promise<number> {
  const index = await captain
    .locator('.board .card')
    .evaluateAll(
      (cards, wanted) =>
        cards.findIndex((card) => !card.classList.contains('revealed') && card.classList.contains(wanted)),
      color,
    );
  expect(index, `a hidden ${color} card`).toBeGreaterThanOrEqual(0);
  return index;
}

// A guesser chooses a card and confirms it.
async function reveal(guesser: Page, index: number): Promise<void> {
  await expect(guesser.locator('.guess-bar')).toBeVisible();
  await guesser.locator('.board .card').nth(index).click();
  await guesser.locator('.guess-bar button.primary').click();
  await expect(guesser.locator('.board .card').nth(index)).toHaveClass(/revealed/);
}

// A group's student reveals a card of this color, usually one of the group's own, which the PI's
// key points out. Returns once the PI's page shows the card revealed as well, so that the next
// look at the key doesn't find the same card again.
export async function revealByKey(table: Table, team: Team, color: CardColor = team): Promise<void> {
  const captain = table.captains[team];
  const index = await keyCard(captain, color);
  await reveal(table.guessers[team], index);
  await expect(captain.locator('.board .card').nth(index)).toHaveClass(/revealed/);
}

// A guesser ends the turn, and confirms it in the sheet that asks first.
export async function endTurn(guesser: Page, language: Language): Promise<void> {
  const text = TEXT[language];
  await guesser.locator('.guess-bar').getByRole('button', { name: text.game.endTurn }).click();
  await guesser.locator('[role=dialog]').getByRole('button', { name: text.game.endTurn }).click();
}

// Plays until the game ends: each turn, the PI gives a clue and the group reveals one of its own
// cards, then ends the turn.
export async function playToTheEnd(table: Table): Promise<void> {
  const ann = table.captains.red;
  for (let turn = 1; turn < 40; turn += 1) {
    if (await ann.locator('.letter').isVisible()) return;
    const team = await teamOnTurn(ann);
    await giveClue(table.captains[team], `Hint${turn}`, 2, table.language);
    await revealByKey(table, team);
    const guesser = table.guessers[team];
    if (await guesser.locator('.guess-bar').isVisible()) await endTurn(guesser, table.language);
    // The other group's turn, or the letter that ends the game.
    await expect(ann.locator(`.strip:not(.${team}), .letter`).first()).toBeVisible();
  }
  throw new Error('the game did not end');
}

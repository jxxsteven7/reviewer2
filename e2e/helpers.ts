import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import type { CardColor, KeywordsRoomData, RoomView, Team } from '@reviewer2/shared';
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

// The tests' own `test`: after each test, it closes every player's browser context, since a
// browser slows to a halt with dozens of them open, and every side channel, and then fails the
// test if any page had a script error.
export const test = base.extend<{ cleanup: void }>({
  cleanup: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use();
      for (const socket of sockets.splice(0)) socket.close();
      await Promise.all(contexts.splice(0).map((context) => context.close()));
      expect(pageErrors.splice(0), 'script errors on the pages').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

// A new player with the current project's device: its viewport, touch and user agent.
export async function newPlayer(browser: Browser, language: Language = 'en'): Promise<Page> {
  const use = test.info().project.use;
  const options: BrowserContextOptions = {
    ...(use.viewport ? { viewport: use.viewport } : {}),
    ...(use.userAgent ? { userAgent: use.userAgent } : {}),
    ...(use.deviceScaleFactor ? { deviceScaleFactor: use.deviceScaleFactor } : {}),
    ...(use.isMobile !== undefined ? { isMobile: use.isMobile } : {}),
    ...(use.hasTouch !== undefined ? { hasTouch: use.hasTouch } : {}),
    baseURL: use.baseURL,
    locale: language === 'zh' ? 'zh-CN' : 'en-US',
  };
  const context = await browser.newContext(options);
  contexts.push(context);
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return page;
}

// Every room:state this page receives, over WebSocket and over HTTP long-polling alike.
export function recordSnapshots(page: Page): RoomView[] {
  const states: RoomView[] = [];
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

// No snapshot before the end of a game held the color of an unrevealed card: such a card has no
// `color` key at all, only its word and, when the word library has them, its translations, which
// everyone may see. Returns how many unrevealed cards it checked, so that a test can tell that it
// looked at something.
export function expectNoKey(states: RoomView[]): number {
  let checked = 0;
  for (const state of states) {
    const game = (state.data as KeywordsRoomData).game;
    if (!game || game.phase === 'over') continue;
    for (const card of game.cards) {
      if (card.revealed) continue;
      expect(card).not.toHaveProperty('color');
      expect(Object.keys(card).filter((key) => !['word', 'revealed', 'translations'].includes(key))).toEqual([]);
      checked += 1;
    }
  }
  return checked;
}

// No snapshot that this page received during a game held another group's chat or its choices of
// cards. A page outside the groups has neither key; a page in a group has its own group's chat,
// and its choices only in its turn. Returns how many snapshots it checked.
export function expectOwnGroupOnly(states: RoomView[]): number {
  let checked = 0;
  for (const state of states) {
    const { game, seats } = state.data as KeywordsRoomData;
    if (!game) continue;
    checked += 1;
    const team = state.me === null ? null : (seats[state.me]?.team ?? null);
    if (team === null) {
      expect(game).not.toHaveProperty('chat');
      expect(game).not.toHaveProperty('selections');
      continue;
    }
    const inGroup = (player: string) => seats[player]?.team === team;
    for (const message of game.chat ?? []) expect(inGroup(message.player), `a message to the ${team} group`).toBe(true);
    if (game.team !== team) expect(game).not.toHaveProperty('selections');
    for (const choice of game.selections ?? [])
      expect(inGroup(choice.player), `a choice in the ${team} group`).toBe(true);
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
  spectator: Page;
  screen: Page;
  // What the guessers, the spectator and the screen received, which must never hold the key.
  public: RoomView[][];
}

// Ann chairs the room and is red's PI, Bob guesses for red, Cat is blue's PI and Dan guesses for
// blue. Eve watches, and a screen shows the room. The game has started when this returns.
export async function seatTable(browser: Browser, language: Language): Promise<Table> {
  const ann = await newPlayer(browser, language);
  const url = await createRoom(ann, language, 'Ann');
  const players: Page[] = [];
  const recorded: RoomView[][] = [];
  for (const name of ['Bob', 'Cat', 'Dan', 'Eve']) {
    const page = await newPlayer(browser, language);
    if (name !== 'Cat') recorded.push(recordSnapshots(page));
    await joinByLink(page, url, name, language);
    players.push(page);
  }
  const [bob, cat, dan, eve] = players as [Page, Page, Page, Page];
  await sit(ann, 'red', 'captain', language);
  await sit(bob, 'red', 'guesser', language);
  await sit(cat, 'blue', 'captain', language);
  await sit(dan, 'blue', 'guesser', language);

  const screen = await newPlayer(browser, language);
  recorded.push(recordSnapshots(screen));
  await screen.goto(`${url}/screen`);
  await expect(screen.locator('.screen')).toBeVisible();

  const text = TEXT[language];
  await expect(ann.locator('.desk .ready')).toBeVisible();
  await ann.getByRole('button', { name: text.lobby.start }).click();
  for (const page of [ann, bob, cat, dan, eve]) await expect(page.locator('.keywords-game')).toBeVisible();
  return {
    language,
    url,
    captains: { red: ann, blue: cat },
    guessers: { red: bob, blue: dan },
    spectator: eve,
    screen,
    public: recorded,
  };
}

export async function teamOnTurn(page: Page): Promise<Team> {
  const strip = page.locator('.strip');
  await expect(strip).toBeVisible();
  return ((await strip.getAttribute('class')) ?? '').includes('red') ? 'red' : 'blue';
}

export async function giveClue(captain: Page, word: string, count: number | 'unlimited', language: Language) {
  const text = TEXT[language];
  await captain.getByLabel(text.game.clueInput).fill(word);
  await captain.getByRole('radio', { name: count === 'unlimited' ? text.game.unlimited : String(count) }).click();
  await captain.getByRole('button', { name: text.game.sendClue }).click();
}

// The index of a hidden card of this color, read from a PI's key.
async function keyCard(captain: Page, color: CardColor): Promise<number> {
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
    await expect(ann.locator('.strip.over, .strip:not(.' + team + '), .letter').first()).toBeVisible();
  }
  throw new Error('the game did not end');
}

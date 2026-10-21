import { readFileSync } from 'node:fs';
import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { ACCOUNT_API, PROFILE_PATH, type RoomView } from '@reviewer2/shared';
import {
  checkClue,
  type CardColor,
  type KeywordsMatchRules,
  type KeywordsRoomData,
  type KeywordsView,
  type Team,
} from '@reviewer2/shared/keywords';
import { io, type Socket } from 'socket.io-client';
import { TOKEN } from '../client/src/core/session';
import en from '../client/src/locales/en.json' with { type: 'json' };
import zh from '../client/src/locales/zh.json' with { type: 'json' };
import general from '../words/general.json' with { type: 'json' };

// Helpers for the end-to-end tests. Every player is a separate browser context, so each has its
// own storage, token and connection, as on separate phones. Button labels come from the locale
// files, so the tests read the interface the way players do.

export type Language = 'en' | 'zh';
export const TEXT = { en, zh };

// A locale string with its {placeholders} filled in, as vue-i18n fills them.
export const interpolate = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (placeholder, key: string) => values[key] ?? placeholder);

// A locale string with a plural in the form that vue-i18n picks for the count: of three forms, the
// first for none, the second for one and the last for more; of two, the first for one.
export function plural(template: string, count: number): string {
  const forms = template.split(' | ');
  const form = forms.length === 3 ? forms[Math.min(count, 2)] : forms[count === 1 ? 0 : forms.length - 1];
  return interpolate(form ?? template, { count: String(count) });
}

// What the turn strip of a game says of the viewer's seat (TurnStrip.vue): their group and role, or
// that they watch.
export function seatSaid(
  team: Team | null,
  role: 'captain' | 'guesser' = 'guesser',
  language: Language = 'en',
): string {
  const text = TEXT[language];
  if (team === null) return text.banner.spectator;
  return interpolate(text.banner.seat, { group: text.lobby.group[team], role: text.banner.roles[role] });
}

// The avatar of a player in a room, which opens their panel, by its accessible name.
export function avatarOf(name: string, language: Language = 'en'): { name: string } {
  return { name: interpolate(TEXT[language].room.viewProfile, { name }) };
}

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
// What WebKit reports, as a page error or on the console, when the page loads another page while a
// long-polling request of the connection is still out, which takes the request with it: a page
// that has logged in connects at once, and a test may load the next page before the connection has
// left long polling behind. Playwright hands the text over without the "XMLHttpRequest cannot
// load" that WebKit shows in front of the address. Only the connection's own requests are let
// through; a script error says something else.
const LEFT_WHILE_POLLING = /^\S*\/socket\.io\/\?\S+ due to access control checks\.$/;

// A new player in the language: a browser context of their own, on the project's device.
export async function newPlayer(browser: Browser, language: Language = 'en'): Promise<Page> {
  const context = await browser.newContext({ locale: language === 'zh' ? 'zh-CN' : 'en-US' });
  contexts.push(context);
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    if (!LEFT_WHILE_POLLING.test(error.message)) pageErrors.push(error.message);
  });
  // The production build of Vue doesn't throw an error from a component, a watcher or a click
  // handler: it hands it to console.error, and the page goes on with what it had. Such an error
  // counts all the same.
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !NETWORK_NOTICE.test(text) && !LEFT_WHILE_POLLING.test(text)) {
      pageErrors.push(text);
    }
  });
  return page;
}

// What Chromium says of a response whose page has loaded another page before the body was read.
const NAVIGATED_AWAY = /navigated away/;

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
    } catch (error) {
      // The page closed before the body came, at the end of the test, or it loaded another page
      // meanwhile, which takes the connection with it: a page that has logged in connects at once,
      // and a test may load the next page before the connection has left long polling behind. For
      // any other reason, the snapshots in the body went unchecked, and the test fails.
      if (page.isClosed() || NAVIGATED_AWAY.test(String(error))) return;
      pageErrors.push(`the body of a polling response was lost: ${String(error)}`);
      return;
    }
    read(text);
  });
  return states;
}

// The game in a snapshot, if there is one.
export const gameOf = (state: RoomView | undefined): KeywordsView | null =>
  (state?.data as KeywordsRoomData | undefined)?.game ?? null;

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
// library has them, its translations, forms and pinyin, which everyone may see. Nor is a color anywhere else in
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
      expect(
        Object.keys(card).filter((key) => !['word', 'revealed', 'translations', 'forms', 'pinyin'].includes(key)),
      ).toEqual([]);
      checked += 1;
    }
    // A paused game has no board in the snapshot at all, so a guess's card can't be checked there.
    const allowed = new Set([
      ...game.cards.flatMap((card, i) => (card.revealed ? [`data.game.cards.${i}.color`] : [])),
      ...game.history.flatMap((clue, i) =>
        clue.guesses.map((guess, j) => {
          if (!game.paused) {
            expect(game.cards[guess.card]?.revealed, `the card of guess ${j} of clue ${i} is revealed`).toBe(true);
          }
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
// and its choices only in its turn. Only a group's students and its PI get its marks, while the game
// is on.
// Returns how many snapshots it checked.
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
    const role = state.me === null ? 'spectator' : seats[state.me]?.role;
    if (role === 'spectator' || game.phase === 'over') expect(game).not.toHaveProperty('marks');
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
  const token = await page.evaluate((key) => localStorage.getItem(key), TOKEN);
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

// A string as a regular expression that matches it and nothing else.
const literally = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Chooses one of the rules on the settings form, on the room setup or at the chair's desk, by
// its label.
export async function chooseRule(page: Page, label: string): Promise<void> {
  await page.locator('.settings-form').getByLabel(label, { exact: true }).check();
}

// Types a number into one of the boxes of the settings form, by its label.
export async function setSetting(page: Page, label: string, value: number): Promise<void> {
  await page.locator('.settings-form').getByLabel(label, { exact: true }).fill(String(value));
}

// Makes the room a match on the room setup, with these rules.
export async function chooseMatch(page: Page, language: Language, rules: KeywordsMatchRules): Promise<void> {
  const text = TEXT[language];
  await page.getByRole('radio', { name: new RegExp(`^${text.match.match}`) }).check();
  const form = page.locator('.match-form');
  await form.getByLabel(text.match.games).fill(String(rules.games));
  await form.getByLabel(text.match.teamsChoice[rules.options.teams], { exact: true }).check();
  await form.getByLabel(text.match.groupingChoice[rules.options.grouping], { exact: true }).check();
}

// Whether the page, or the project a test runs in, is a phone's: narrower than the three columns
// of the game, where the groups, the clue log and the chat open as sheets from the bar under the
// board (KeywordsGame.vue). A test that is for one kind of screen alone asks about its project
// before it seats a table, so that it skips without opening a browser for each player.
export const isPhone = (page: Page | TestInfo): boolean => {
  const width = 'viewportSize' in page ? page.viewportSize()?.width : page.project.use.viewport?.width;
  return (width ?? 1280) < 1024;
};

// How a newcomer takes part: to play, which the forms offer first, or only to watch.
export interface Joining {
  watch?: boolean;
}

async function chooseToWatch(page: Page, language: Language, { watch = false }: Joining): Promise<void> {
  if (watch) await page.getByRole('radio', { name: TEXT[language].room.join.watch }).check();
}

// Creates a room with the general word list. A first room setup starts with no list chosen, its
// lists open, and won't create the room until one is; a later one starts from the last room, its
// lists folded away (roomSetup.ts), which this opens. Nobody gives a name: a guest is numbered by
// the room, and an account has its username. `setup` runs on the room setup once a list is chosen,
// for a test that wants other settings than the defaults. The page's snapshots are recorded from
// here on (snapshotsOf), so that nameOf can tell what the room calls the player.
export async function createRoom(
  page: Page,
  language: Language,
  setup?: (page: Page) => Promise<void>,
  joining: Joining = {},
): Promise<string> {
  const text = TEXT[language];
  snapshotsOf(page);
  await page.goto('/');
  // The language gate stands on the browser's first visit. Its link begins with the language's
  // name, and goes on with a description.
  await expect(page.locator('.gate, .home').first()).toBeVisible();
  const gate = page.getByRole('link', { name: new RegExp(`^${literally(text.language[language])}`) });
  if (await gate.count()) await gate.click();
  await page.getByRole('button', { name: text.home.newRoom }).click();
  const fold = page.locator('.field-fold .toggle');
  await expect(fold.locator('.summary')).not.toHaveText(text.create.loadingFields);
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
  await expect(page.locator('.fields li').first()).toBeVisible();
  const submit = page.getByRole('button', { name: text.create.submit });
  const generalList = page.getByLabel(general.name[language]);
  if (!(await generalList.isChecked())) {
    if (!(await page.locator('.field-fold input:checked').count())) {
      await expect(submit).toBeDisabled();
      await expect(page.getByText(text.create.chooseField)).toBeVisible();
    }
    await generalList.check();
  }
  await expect(submit).toBeEnabled();
  await setup?.(page);
  await chooseToWatch(page, language, joining);
  await submit.click();
  await page.waitForURL(/\/room\/[0-9A-Z]{4}$/);
  await expect(page.locator('.lobby')).toBeVisible();
  return page.url();
}

// A newcomer joins by the room's link, on the form that asks only whether they play or watch
// (JoinForm.vue). The page's snapshots are recorded from here on, as for createRoom.
export async function joinByLink(page: Page, url: string, language: Language, joining: Joining = {}): Promise<void> {
  const text = TEXT[language];
  snapshotsOf(page);
  await page.goto(url);
  await expect(page.locator('.join-form')).toBeVisible();
  await chooseToWatch(page, language, joining);
  await page.getByRole('button', { name: text.room.join.submit, exact: true }).click();
  await expect(page.locator('.lobby, .keywords-game').first()).toBeVisible();
}

// What the interface calls the guest with this number in a room in the language.
export const guestName = (number: number, language: Language = 'en'): string =>
  interpolate(TEXT[language].room.guest, { number: String(number) });

// The name that the player of a page goes by in its room, as the pages show it (names.ts): a
// guest's number in the room's language, which is the page's, or an account's username. It is read
// from the page's latest snapshot, which createRoom and joinByLink record: guests who join at the
// same time are numbered in whatever order the server hears them, so a test asks the room rather
// than guessing.
export function nameOf(page: Page): string {
  const state = snapshotsOf(page).at(-1);
  const me = state?.players.find((player) => player.id === state.me);
  if (!state || !me) throw new Error('the page has no seat in a room that it recorded');
  return me.guest === undefined ? me.name : guestName(me.guest, state.language);
}

// The address of the public page of the account that the page is logged in to. The account page
// opens it in a sheet rather than linking to it, so it is asked of the server.
export async function pageAddress(page: Page): Promise<string> {
  const reply = await page.evaluate((path) => fetch(path).then((response) => response.json()), ACCOUNT_API.account);
  return `${PROFILE_PATH}${(reply as { account: { handle: string } }).account.handle}`;
}

// A player in the waiting room takes a seat, and the page's snapshots confirm it. While the others
// take their seats at the same time, the groups' lists grow and shrink, and a button can move out
// from under a click that was aimed while it stood still; such a click is made again. Whoever came
// to play has been given a student's seat in one of the groups already, which may be the seat
// asked for, and the page offers no button for the seat a player is in.
export async function sit(page: Page, team: Team, role: 'captain' | 'guesser', language: Language): Promise<void> {
  const text = TEXT[language];
  const label = role === 'captain' ? text.lobby.takeCaptain : text.lobby.joinAsGuesser;
  const button = page.locator(`.group.${team}`).getByRole('button', { name: label });
  const seated = () => {
    const state = snapshotsOf(page).at(-1);
    const seat = state?.me ? (state.data as KeywordsRoomData).seats[state.me] : undefined;
    return seat?.team === team && seat.role === role;
  };
  await expect(async () => {
    if (seated()) return;
    await button.click({ timeout: 2_000 });
    await expect.poll(seated, { timeout: 2_000 }).toBe(true);
  }).toPass();
}

export interface Table {
  language: Language;
  url: string;
  captains: Record<Team, Page>;
  guessers: Record<Team, Page>;
  // The names that the room gives the pages above (nameOf), as every page shows them.
  names: { captains: Record<Team, string>; guessers: Record<Team, string>; spectator: string };
  spectator: Page;
  screen: Page;
  // What the guessers, the spectator and the screen received, which must never hold the key.
  public: RoomView[][];
  // What every page at the table received, the PIs' included.
  everyone: RoomView[][];
}

// Ann chairs the room and is red's PI, Bob guesses for red, Cat is blue's PI and Dan guesses for
// blue. Eve watches, and a screen shows the room. These are the seats' names in the tests alone:
// the room numbers the guests as they come in, Ann first and the others in whatever order the
// server hears them, and `names` holds what it calls each. Everyone but Eve comes to play, so the
// server seats them first, and they move to their seats from there. `prepare` runs on each page,
// with the seat's name, before it creates or joins the room, for a test that needs a player's
// connection set up in some other way or a player logged in to an account, `setup` on Ann's room
// setup (createRoom), and `desk` at Ann's desk once everyone is seated, just before she starts the
// game. The game has started when this returns. The tests' clues are English words of up to eight
// letters, which a Chinese room counts as up to four characters, as many as its default allows.
export async function seatTable(
  browser: Browser,
  language: Language,
  prepare?: (page: Page, seat: string) => Promise<void>,
  setup?: (page: Page) => Promise<void>,
  desk?: (chair: Page) => Promise<void>,
): Promise<Table> {
  const ann = await newPlayer(browser, language);
  snapshotsOf(ann);
  await prepare?.(ann, 'Ann');
  const url = await createRoom(ann, language, setup);
  // The others join at the same time, as separate people do.
  const join = async (seat: string, joining: Joining = {}) => {
    const page = await newPlayer(browser, language);
    snapshotsOf(page);
    await prepare?.(page, seat);
    await joinByLink(page, url, language, joining);
    return page;
  };
  const [bob, cat, dan, eve] = await Promise.all([join('Bob'), join('Cat'), join('Dan'), join('Eve', { watch: true })]);
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
  await expect(ann.locator('.start-bar .ready')).toBeVisible();
  await desk?.(ann);
  await ann.getByRole('button', { name: text.lobby.start }).click();
  for (const page of [ann, bob, cat, dan, eve]) await expect(page.locator('.keywords-game')).toBeVisible();
  // The screen shows the board too, so that a test's look at its cards finds them.
  await expect(screen.locator('.screen-game .board .card')).toHaveCount(25);
  return {
    language,
    url,
    captains: { red: ann, blue: cat },
    guessers: { red: bob, blue: dan },
    names: {
      captains: { red: nameOf(ann), blue: nameOf(cat) },
      guessers: { red: nameOf(bob), blue: nameOf(dan) },
      spectator: nameOf(eve),
    },
    spectator: eve,
    screen,
    public: [bob, dan, eve, screen].map(snapshotsOf),
    everyone: [ann, bob, cat, dan, eve, screen].map(snapshotsOf),
  };
}

// The room menu, behind the "Room" button in the masthead: the player's name and avatar, and
// the ways to leave and close the room. Opens it and returns it.
export async function roomMenu(page: Page): Promise<Locator> {
  await page.locator('.masthead .room-button').click();
  const menu = page.locator('[role=dialog]:has(.room-menu)');
  await expect(menu).toBeVisible();
  return menu;
}

// On a phone, the groups and the clue log are sheets that open from the bar under the board; on
// a wide screen they stand beside the board. Opens them where they need opening,
// and returns them. A sheet that is open covers the rest of the page, so a test closes it, with
// closeSheet, before it taps anything else on that page.
export async function openGroups(page: Page): Promise<Locator> {
  const button = page.locator('.open-groups');
  if (await button.count()) await button.click();
  const rosters = page.locator('.rosters');
  await expect(rosters).toBeVisible();
  return rosters;
}

export async function openLog(page: Page): Promise<Locator> {
  const button = page.locator('.open-log');
  if (await button.count()) await button.click();
  const log = page.locator('.clue-log');
  await expect(log).toBeVisible();
  return log;
}

// Closes the sheet on top, if there is one, as Escape does.
export async function closeSheet(page: Page): Promise<void> {
  if (await page.locator('[role=dialog]').count()) await page.keyboard.press('Escape');
}

// The group whose turn it is, from the color of the turn strip.
export async function teamOnTurn(page: Page): Promise<Team> {
  const strip = page.locator('.strip');
  await expect(strip).toHaveClass(/\b(red|blue)\b/);
  return (await strip.evaluate((element) => element.classList.contains('red'))) ? 'red' : 'blue';
}

// Clues that no word list is likely to hold, for when the clue a test asked for repeats a word
// on the board.
const SPARE_CLUES = ['Nudge', 'Pointer', 'Whisper', 'Beacon', 'Signpost'];

// A clue that the rules allow on this PI's board (docs/games/keywords.md): the one asked for,
// or the first spare one that the board doesn't repeat. A word list that gains a term such as
// "danger zone" must not leave a test waiting for a button that stays off.
export function clueFor(captain: Page, wanted: string): string {
  const cards = gameOf(snapshotsOf(captain).at(-1))?.cards ?? [];
  const clue = [wanted, ...SPARE_CLUES].find((word) => checkClue(word, cards).problem === null);
  if (clue === undefined) throw new Error(`the board repeats "${wanted}" and every spare clue`);
  return clue;
}

// The PI gives the clue, or a spare one when the board repeats it. Returns the clue given.
export async function giveClue(
  captain: Page,
  word: string,
  count: number | 'unlimited',
  language: Language,
): Promise<string> {
  const text = TEXT[language];
  const clue = clueFor(captain, word);
  await captain.getByLabel(text.game.clueInput).fill(clue);
  await captain.getByRole('radio', { name: count === 'unlimited' ? text.game.unlimited : String(count) }).click();
  await captain.getByRole('button', { name: text.game.sendClue }).click();
  return clue;
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

// A guesser chooses a card: taps it, and checks that the page took the choice, so that a tap the
// page lost fails here, in seconds, and not on a button that never enables. The tap waits for the
// fonts: the Chinese fonts come in slices that a new word on the page can still be fetching, and
// when a slice arrives the text above the board can change its lines, which moves the board under
// a tap that is on its way.
export async function chooseCard(guesser: Page, index: number): Promise<Locator> {
  await guesser.evaluate(() => document.fonts.ready);
  const card = guesser.locator('.board .card').nth(index);
  await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  return card;
}

// A guesser chooses a card and confirms it.
export async function reveal(guesser: Page, index: number): Promise<void> {
  await expect(guesser.locator('.guess-bar')).toBeVisible();
  const card = await chooseCard(guesser, index);
  await guesser.locator('.guess-bar button.primary').click();
  await expect(card).toHaveClass(/revealed/);
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

// Red wins in one or two turns, with blue far behind: if red is on turn, Bob reveals an irrelevant
// paper, which ends the turn; then Dan reveals Reviewer 2 for blue. Ends when every page shows the
// letters.
export async function redWins(table: Table, language: Language): Promise<void> {
  const ann = table.captains.red;
  if ((await teamOnTurn(ann)) === 'red') {
    await giveClue(ann, 'Hint', 1, language);
    await reveal(table.guessers.red, await keyCard(ann, 'neutral'));
    await expect(ann.locator('.strip.blue')).toBeVisible();
  }
  const cat = table.captains.blue;
  await giveClue(cat, 'Hint', 1, language);
  await reveal(table.guessers.blue, await keyCard(cat, 'reviewer2'));
  for (const page of [ann, table.guessers.red, cat, table.guessers.blue, table.spectator, table.screen]) {
    await expect(page.locator('.letter').first()).toBeVisible();
  }
}

// Plays one turn, the `turn`th of the game: the PI of the group on turn gives a clue for one card
// and the group reveals one of its own cards, then ends the turn. Returns once the other group is
// on turn, or the game has ended. Under the free guess rule, 1 is the only number that a group
// with one card left may give.
export async function playTurn(table: Table, turn: number): Promise<void> {
  const ann = table.captains.red;
  const team = await teamOnTurn(ann);
  await giveClue(table.captains[team], `Hint${turn}`, 1, table.language);
  await revealByKey(table, team);
  const guesser = table.guessers[team];
  if (await guesser.locator('.guess-bar').isVisible()) await endTurn(guesser, table.language);
  // The other group's turn, or the letter that ends the game.
  await expect(ann.locator(`.strip:not(.${team}), .letter`).first()).toBeVisible();
}

// Plays until the game ends, turn by turn (playTurn), after the `played` turns that the test played
// already. Returns how many turns the game took in all: 16, because the group that goes second
// reveals its eighth card, the last one, in its eighth turn, before the first group gets to its
// ninth.
export async function playToTheEnd(table: Table, played = 0): Promise<number> {
  const ann = table.captains.red;
  for (let turn = played + 1; turn < 40; turn += 1) {
    if (await ann.locator('.letter').isVisible()) return turn - 1;
    await playTurn(table, turn);
  }
  throw new Error('the game did not end');
}

// The mails that the mailer wrote out instead of sending them (e2e/server.mjs), oldest first.
interface Mail {
  kind: 'bind' | 'reset';
  to: string;
  language: Language;
  subject: string;
  link: string;
}

const mailLog = process.env.E2E_MAIL_LOG;

function mails(): Mail[] {
  if (!mailLog) throw new Error('E2E_MAIL_LOG must be set; playwright.config.ts sets it');
  try {
    return readFileSync(mailLog, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Mail);
  } catch {
    return [];
  }
}

// The link in the latest mail of this kind to this address, waiting for the mail to be written.
export async function mailedLink(kind: Mail['kind'], to: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      () =>
        (link = mails()
          .filter((mail) => mail.kind === kind && mail.to === to)
          .at(-1)?.link),
      {
        message: `a ${kind} mail to ${to}`,
      },
    )
    .toBeTruthy();
  return link as string;
}

// Registers an account on the account page, which logs the page in, and ends on the home page.
export async function register(page: Page, username: string, password = 'correct horse'): Promise<void> {
  const text = TEXT[await pageLanguage(page)];
  await page.goto('/account');
  await page.getByRole('button', { name: text.account.signIn.register, exact: true }).click();
  await page.getByLabel(text.account.username).fill(username);
  await page.getByLabel(text.account.password, { exact: true }).fill(password);
  await page.getByLabel(text.account.signIn.agree).check();
  await page.getByRole('button', { name: text.account.signIn.registerSubmit }).click();
  await page.waitForURL(/\/$/);
}

export async function logIn(page: Page, username: string, password = 'correct horse'): Promise<void> {
  const text = TEXT[await pageLanguage(page)];
  await page.goto('/account');
  await page.getByLabel(text.account.username).fill(username);
  await page.getByLabel(text.account.password, { exact: true }).fill(password);
  await page.locator('form').getByRole('button', { name: text.account.signIn.loginSubmit }).click();
  await page.waitForURL(/\/$/);
}

// Searches the friends section of the account page, which is open, for a username or a link to a
// page, as the account typed or pasted it.
export async function searchFriends(page: Page, query: string): Promise<void> {
  const text = TEXT[await pageLanguage(page)];
  const friends = page.locator('.friends');
  await friends.getByLabel(text.friends.search.label).fill(query);
  await friends.getByRole('button', { name: text.friends.search.submit, exact: true }).click();
}

// Asks an account to be friends from the account page, which is open: the search finds them by
// their username, and their panel asks, in the sheet with a line for them, if one is given.
export async function askFriend(page: Page, username: string, line?: string): Promise<void> {
  const text = TEXT[await pageLanguage(page)];
  await searchFriends(page, username);
  await page.getByRole('dialog').getByRole('button', { name: text.friends.addFromRoom }).click();
  // The sheet lies over the panel; its title names them as the server does, whatever the case typed.
  const sheet = page.getByRole('dialog', { name: interpolate(text.friends.addTitle, { name: username }) });
  if (line !== undefined) await sheet.getByLabel(text.friends.noteLabel).fill(line);
  await sheet.getByRole('button', { name: text.friends.addSubmit }).click();
  // The word of the last request, since the word of one asked a moment ago may still be up.
  await expect(page.getByText(text.friends.requestSent).last()).toBeVisible();
}

// The language that a page shows its interface in, before it has chosen one: the browser's.
async function pageLanguage(page: Page): Promise<Language> {
  return (await page.evaluate(() => navigator.language)).startsWith('zh') ? 'zh' : 'en';
}

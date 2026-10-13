import {
  defaultSettings,
  MAX_CHAT_INPUT,
  MAX_CHAT_LENGTH,
  MAX_CLUE_INPUT,
  otherTeam,
  SPECTATOR,
  TEAMS,
  type KeywordsRoomData,
  type KeywordsSettings,
  type KeywordsView,
  type RoomView,
  type Team,
} from '@reviewer2/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { GameContext } from '../src/core/game';
import { seededRng } from '../src/core/random';
import { WordLibrary } from '../src/core/words';
import { keywordsGame } from '../src/games/keywords';
import {
  Browser,
  createRoom,
  joinRoom,
  startServer,
  TestClient,
  testWords,
  until,
  type Reply,
  type TestServer,
} from './helpers';

// The word guessing game over real sockets: seats, a whole game, the checks on every action, and
// above all that only captains ever receive the colors of unrevealed cards.

let server: TestServer;
let clients: TestClient[];

beforeEach(async () => {
  server = await startServer({ games: [keywordsGame], words: bigLibrary() });
  clients = [];
});

afterEach(async () => {
  for (const client of clients) client.close();
  await server.close();
});

// Sixty words of which no two clash, so that the room deals its boards the usual way. Each is a
// phrase such as "general wab", whose first word a clue may not repeat; the second word tells
// them apart, with three letters so that it counts as a part and is never a plural of another.
function bigLibrary(): WordLibrary {
  const tag = (i: number) =>
    `w${String.fromCharCode(0x61 + Math.floor(i / 26))}${String.fromCharCode(0x61 + (i % 26))}`;
  return new WordLibrary([
    {
      id: 'general',
      name: { zh: 'G', en: 'G' },
      terms: Array.from({ length: 60 }, (_, i) => ({ id: `w${i}`, en: `general ${tag(i)}` })),
    },
  ]);
}

const data = (client: TestClient) => client.state?.data as KeywordsRoomData;
const board = (client: TestClient) => data(client).game as KeywordsView;
const moment = (view: KeywordsView) => ({ gameId: view.gameId, turn: view.turn });

async function expectOk(reply: Promise<Reply>) {
  expect(await reply).toEqual({ ok: true });
}

// Waits until every client has the newest snapshot that any of them has.
async function settle(table: Table) {
  const rev = Math.max(...table.everyone.map((client) => client.state?.rev ?? 0));
  for (const client of table.everyone) await client.waitFor((state) => state.rev >= rev, `rev ${rev}`);
}

interface Table {
  code: string;
  captains: Record<Team, TestClient>;
  guessers: Record<Team, TestClient>;
  spectator: TestClient;
  screen: TestClient;
  everyone: TestClient[];
}

// Ann chairs and captains red, Bob guesses for red, Cat captains blue, Dan guesses for blue, Eve
// watches, and a screen shows the room.
async function seatTable(start = true, settings?: Partial<KeywordsSettings>): Promise<Table> {
  const { chair: ann, code } = await createRoom(server.url, 'Ann', {
    game: 'keywords',
    ...(settings ? { settings: { ...defaultSettings('en'), ...settings } } : {}),
  });
  const [bob, cat, dan, eve] = await Promise.all([
    joinRoom(server.url, code, 'Bob'),
    joinRoom(server.url, code, 'Cat'),
    joinRoom(server.url, code, 'Dan'),
    joinRoom(server.url, code, 'Eve'),
  ]);
  const screen = await TestClient.connect(server.url);
  expect(await screen.send('room:watch', { code })).toMatchObject({ ok: true });
  const table: Table = {
    code,
    captains: { red: ann, blue: cat },
    guessers: { red: bob, blue: dan },
    spectator: eve,
    screen,
    everyone: [ann, bob, cat, dan, eve, screen],
  };
  clients.push(...table.everyone);
  await expectOk(ann.send('keywords:seat', { team: 'red', role: 'captain' }));
  await expectOk(table.guessers.red.send('keywords:seat', { team: 'red', role: 'guesser' }));
  await expectOk(table.captains.blue.send('keywords:seat', { team: 'blue', role: 'captain' }));
  await expectOk(table.guessers.blue.send('keywords:seat', { team: 'blue', role: 'guesser' }));
  if (start) {
    await ann.waitFor((state) => (state.data as KeywordsRoomData).startProblems.length === 0, 'ready to start');
    await expectOk(ann.send('room:start', { round: ann.state?.round }));
    for (const client of table.everyone) await client.waitFor((state) => state.phase === 'playing', 'the game');
  }
  return table;
}

// Every unrevealed card in every snapshot this client received before the game ended lacks a color.
function expectNoKey(states: RoomView[]) {
  let checked = 0;
  for (const state of states) {
    const game = (state.data as KeywordsRoomData).game;
    if (!game || game.phase === 'over') continue;
    for (const card of game.cards) {
      if (card.revealed) continue;
      expect(Object.keys(card)).toEqual(['word', 'revealed']);
      checked += 1;
    }
  }
  expect(checked).toBeGreaterThan(0);
}

// A group's chat and its guessers' choices never reach anyone outside the group. In every
// snapshot that this client received during a game, a spectator or a screen has neither key, and
// a player in `team` has only their own group's chat, and its choices only in its turn.
function expectOwnGroupOnly(client: TestClient, team: Team | null, group: readonly string[] = []) {
  let checked = 0;
  for (const state of client.states) {
    const game = (state.data as KeywordsRoomData).game;
    if (!game) continue;
    checked += 1;
    if (team === null) {
      expect(game).not.toHaveProperty('chat');
      expect(game).not.toHaveProperty('selections');
      expect(game).not.toHaveProperty('marks');
      continue;
    }
    expect(game.chat?.every((message) => group.includes(message.player))).toBe(true);
    if (game.team === team) expect(game.selections?.every((choice) => group.includes(choice.player))).toBe(true);
    else expect(game).not.toHaveProperty('selections');
  }
  expect(checked).toBeGreaterThan(0);
}

// Checks expectOwnGroupOnly for everyone at a table whose seats didn't change. No captain ever gets
// a group's marks.
function expectGroupsApart(table: Table) {
  for (const team of TEAMS) {
    const group = [table.captains[team].me, table.guessers[team].me];
    expectOwnGroupOnly(table.captains[team], team, group);
    expectOwnGroupOnly(table.guessers[team], team, group);
    for (const state of table.captains[team].states) {
      expect((state.data as KeywordsRoomData).game ?? {}).not.toHaveProperty('marks');
    }
  }
  expectOwnGroupOnly(table.spectator, null);
  expectOwnGroupOnly(table.screen, null);
}

const context = (): GameContext => ({
  phase: 'playing',
  language: 'en',
  rng: seededRng(1),
  chairId: 'ann',
  now: () => 0,
  keyOf: (id) => id,
  nameOf: (id) => id,
  isOnline: () => true,
  agentOf: () => null,
  playerIds: () => ['ann', 'bob', 'cat'],
  titleCount: () => null,
});

describe('the view', () => {
  test("shares nothing with the room's own state, and is built once for each seat", () => {
    const ctx = context();
    let data = keywordsGame.create('en');
    for (const [id, seat] of [
      ['ann', { team: 'red', role: 'captain' }],
      ['bob', { team: 'red', role: 'guesser' }],
    ] as const) {
      const seated = keywordsGame.handle(data, ctx, id, 'keywords:seat', seat);
      if (!seated.ok) throw new Error(seated.error);
      data = seated.data;
    }
    data = keywordsGame.start(data, ctx, testWords().pool(['general'], 'en').slice(0, 25), 'game-1');
    const view = keywordsGame.views(data, ctx);
    const [ann, bob, cat, screen] = [
      view({ playerId: 'ann' }),
      view({ playerId: 'bob' }),
      view({ playerId: 'cat' }),
      view({ screen: true }),
    ];
    expect(ann.seats.ann).toEqual({ team: 'red', role: 'captain' });
    expect(ann.seats.ann).not.toBe(data.seating.seats.get('ann'));
    expect(ann.seats.cat).not.toBe(SPECTATOR);
    expect(ann.game?.cards.every((card) => card.color)).toBe(true);
    expect(bob.game?.cards.some((card) => card.color)).toBe(false);
    expect(cat.game).toBe(screen.game);
    expect([ann.side, bob.side, cat.side, screen.side]).toEqual(['red', 'red', null, null]);
  });
});

describe('seats and starting', () => {
  test('the waiting room shows what is missing', async () => {
    const { chair } = await createRoom(server.url, 'Ann', { game: 'keywords' });
    clients.push(chair);
    expect(data(chair).startProblems).toEqual([
      { problem: 'needs_captain', team: 'red' },
      { problem: 'needs_guesser', team: 'red' },
      { problem: 'needs_captain', team: 'blue' },
      { problem: 'needs_guesser', team: 'blue' },
    ]);
    expect(data(chair).seats[chair.me]).toEqual({ team: null, role: 'spectator' });
    expect(await chair.send('room:start', { round: chair.state?.round })).toEqual({ ok: false, error: 'cannot_start' });
  });

  test('the game needs the captains and a guesser of each group online, and starts once they are', async () => {
    const table = await seatTable(false);
    const ann = table.captains.red;
    const problems = (count: number) =>
      ann.waitFor((state) => (state.data as KeywordsRoomData).startProblems.length === count, `${count} problems`);
    await problems(0);

    // The blue captain and the blue guesser lose their connections.
    table.captains.blue.close();
    table.guessers.blue.close();
    await problems(2);
    expect(data(ann).startProblems).toEqual([
      { problem: 'captain_offline', team: 'blue' },
      { problem: 'needs_guesser', team: 'blue' },
    ]);
    expect(await ann.send('room:start', { round: ann.state?.round })).toEqual({ ok: false, error: 'cannot_start' });

    // They come back from the same browsers, and the game can start.
    for (const gone of [table.captains.blue, table.guessers.blue]) {
      const back = await TestClient.connect(server.url, { token: gone.token });
      clients.push(back);
      expect(await back.send('room:join', { code: table.code })).toMatchObject({ ok: true });
    }
    await problems(0);
    await expectOk(ann.send('room:start', { round: ann.state?.round }));
    expect(ann.state?.phase).toBe('playing');
    expect(data(ann).startProblems).toEqual([]);
  });

  test('deals no two words of which one gives the other away', async () => {
    await server.close();
    // "Gene editing" repeats both "Gene" and "Editing", which a board of these 26 words needs.
    const others = Array.from({ length: 23 }, (_, i) => `Word${String.fromCharCode(0x61 + i)}`);
    const words = ['Gene editing', 'Gene', 'Editing', ...others];
    server = await startServer({
      games: [keywordsGame],
      words: new WordLibrary([
        { id: 'general', name: { zh: 'G', en: 'G' }, terms: words.map((en, i) => ({ id: `w${i}`, en })) },
      ]),
    });
    const table = await seatTable();
    expect(new Set(board(table.spectator).cards.map((card) => card.word))).toEqual(new Set(words.slice(1)));
    expect(server.logs.map((entry) => entry.event)).not.toContain('words_clashed');
  });

  test('logs a board on which the draw found no way to keep such words apart', async () => {
    await server.close();
    // Each phrase is the one before it with a word added, "general", "general wa", "general wa wb"
    // and so on, so that every one lies inside every later one.
    const chain = (i: number) =>
      ['general', ...Array.from({ length: i }, (_, j) => `w${String.fromCharCode(0x61 + j)}`)].join(' ');
    server = await startServer({
      games: [keywordsGame],
      words: new WordLibrary([
        {
          id: 'general',
          name: { zh: 'G', en: 'G' },
          terms: Array.from({ length: 26 }, (_, i) => ({ id: `w${i}`, en: chain(i) })),
        },
      ]),
    });
    const table = await seatTable();
    expect(server.logs.filter((entry) => entry.event === 'words_clashed')).toEqual([
      { event: 'words_clashed', fields: { code: table.code, language: 'en', fields: ['general'], clashes: 300 } },
    ]);
  });

  test('a captain seat holds one player, and seats must make sense', async () => {
    const table = await seatTable(false);
    expect(await table.spectator.send('keywords:seat', { team: 'red', role: 'captain' })).toEqual({
      ok: false,
      error: 'seat_taken',
    });
    expect(await table.spectator.send('keywords:seat', { team: 'red', role: 'spectator' })).toEqual({
      ok: false,
      error: 'bad_seat',
    });
    expect(await table.spectator.send('keywords:seat', { team: 'green', role: 'guesser' })).toEqual({
      ok: false,
      error: 'bad_request',
    });
  });

  test('asking for the seat one is in changes nothing, and nobody is told', async () => {
    const table = await seatTable(false);
    const eve = table.spectator;
    // An answered message shows that nothing else was on its way.
    await eve.send('sys:ping');
    const before = { rev: eve.state?.rev, states: eve.states.length };
    await expectOk(table.guessers.red.send('keywords:seat', { team: 'red', role: 'guesser' }));
    await expectOk(eve.send('keywords:seat', { team: null, role: 'spectator' }));
    await expectOk(table.captains.red.send('room:spectate', { playerId: eve.me }));
    await eve.send('sys:ping');
    expect({ rev: eve.state?.rev, states: eve.states.length }).toEqual(before);
  });

  test('the chair can shuffle the groups', async () => {
    const table = await seatTable(false);
    // Everyone crowds into the red group, so that only a shuffle can make the groups even.
    for (const client of [table.captains.blue, table.guessers.blue, table.spectator]) {
      await expectOk(client.send('keywords:seat', { team: 'red', role: 'guesser' }));
    }
    await expectOk(table.captains.red.send('room:shuffle'));
    const seats = Object.values(data(table.captains.red).seats);
    const sizes = TEAMS.map((team) => seats.filter((seat) => seat.team === team).length);
    expect([...sizes].sort()).toEqual([2, 3]);
    for (const team of TEAMS) {
      expect(seats.filter((seat) => seat.team === team && seat.role === 'captain')).toHaveLength(1);
    }
    expect(data(table.captains.red).startProblems).toEqual([]);
  });
});

describe('a game over sockets', () => {
  test('is played to the end, and only the captains ever see the key', async () => {
    const table = await seatTable();
    const ann = table.captains.red;
    for (let turn = 1; board(ann).phase !== 'over'; turn += 1) {
      expect(turn).toBeLessThan(40);
      const team = board(ann).team;
      const captain = table.captains[team];
      const guesser = table.guessers[team];
      await expectOk(captain.send('keywords:clue', { ...moment(board(captain)), word: `Hint${turn}`, count: 1 }));
      await settle(table);
      const own = board(captain).cards.findIndex((card) => !card.revealed && card.color === team);
      await expectOk(guesser.send('keywords:reveal', { ...moment(board(guesser)), card: own }));
      if (board(guesser).phase === 'guess') await expectOk(guesser.send('keywords:pass', moment(board(guesser))));
      await settle(table);
    }

    for (const client of table.everyone) await client.waitFor((state) => state.phase === 'ended', 'the end');
    const result = board(table.spectator).result;
    expect(result?.reason).toBe('found');
    expect(board(table.spectator).remaining[result?.winner as Team]).toBe(0);
    // Once it is over, everyone sees every color.
    expect(board(table.screen).cards.every((card) => card.color !== undefined)).toBe(true);

    for (const client of [table.guessers.red, table.guessers.blue, table.spectator, table.screen]) {
      expectNoKey(client.states);
    }
    for (const captain of Object.values(table.captains)) {
      const keyed = captain.states.filter((state) => (state.data as KeywordsRoomData).game);
      expect(keyed.every((state) => (state.data as KeywordsRoomData).game?.cards.every((card) => card.color))).toBe(
        true,
      );
    }
  });

  test('ends at once when someone reveals Reviewer 2', async () => {
    const table = await seatTable();
    const team = board(table.captains.red).team;
    const captain = table.captains[team];
    await expectOk(captain.send('keywords:clue', { ...moment(board(captain)), word: 'Hint', count: 2 }));
    const reviewer2 = board(captain).cards.findIndex((card) => card.color === 'reviewer2');
    const guesser = table.guessers[team];
    await guesser.waitFor((state) => (state.data as KeywordsRoomData).game?.phase === 'guess');
    await expectOk(guesser.send('keywords:reveal', { ...moment(board(guesser)), card: reviewer2 }));
    expect(guesser.state?.phase).toBe('ended');
    expect(board(guesser).result).toEqual({ winner: team === 'red' ? 'blue' : 'red', reason: 'reviewer2' });
    expect(server.logs.some((entry) => entry.event === 'game_ended')).toBe(true);
  });

  test('checks who may do what, and refuses stale actions', async () => {
    const table = await seatTable();
    const team = board(table.captains.red).team;
    const other = otherTeam(team);
    const now = moment(board(table.captains[team]));
    const send = (client: TestClient, type: string, payload: object) => client.send(`keywords:${type}`, payload);

    expect(await send(table.guessers[team], 'reveal', { ...now, card: 0 })).toEqual({
      ok: false,
      error: 'wrong_phase',
    });
    expect(await send(table.captains[other], 'clue', { ...now, word: 'Hint', count: 1 })).toEqual({
      ok: false,
      error: 'not_your_turn',
    });
    expect(await send(table.spectator, 'clue', { ...now, word: 'Hint', count: 1 })).toEqual({
      ok: false,
      error: 'not_your_turn',
    });
    expect(await send(table.guessers[team], 'clue', { ...now, word: 'Hint', count: 1 })).toEqual({
      ok: false,
      error: 'not_captain',
    });
    expect(await send(table.captains[team], 'clue', { ...now, turn: 2, word: 'Hint', count: 1 })).toEqual({
      ok: false,
      error: 'stale',
    });
    for (const count of [12, 1.5, 2 ** 53]) {
      expect(await send(table.captains[team], 'clue', { ...now, word: 'Hint', count }), String(count)).toEqual({
        ok: false,
        error: 'bad_count',
      });
    }
    // The content of an action is for the rules to judge, whatever the characters: a text of too
    // many UTF-16 units is refused before it is looked at, with the game's own code.
    for (const word of ['x'.repeat(MAX_CLUE_INPUT + 1), '\u{1f600}'.repeat(MAX_CLUE_INPUT / 2 + 1)]) {
      expect(await send(table.captains[team], 'clue', { ...now, word, count: 1 })).toEqual({
        ok: false,
        error: 'clue_too_long',
      });
    }
    expect(await send(table.captains[team], 'clue', { ...now, word: 'two words', count: 1 })).toEqual({
      ok: false,
      error: 'clue_not_one_word',
    });
    // The test words are phrases such as "general wab", and a clue may not repeat part of one.
    const onBoard = board(table.captains[team]).cards[3]?.word.split(' ')[0];
    expect(await send(table.captains[team], 'clue', { ...now, word: onBoard, count: 1 })).toEqual({
      ok: false,
      error: 'clue_on_board',
    });
    expect(await send(table.captains[team], 'clue', { word: 'Hint' })).toEqual({ ok: false, error: 'bad_request' });

    await expectOk(send(table.captains[team], 'clue', { ...now, word: 'Hint', count: 1 }));
    expect(await send(table.captains[team], 'reveal', { ...now, card: 0 })).toEqual({
      ok: false,
      error: 'not_guesser',
    });
    expect(await send(table.guessers[team], 'pass', now)).toEqual({ ok: false, error: 'must_guess_first' });
    expect(await send(table.guessers[team], 'reveal', { ...now, card: 30 })).toEqual({
      ok: false,
      error: 'no_such_card',
    });
    expect(await send(table.guessers[team], 'flip', now)).toEqual({ ok: false, error: 'bad_request' });
  });
});

describe('the settings', () => {
  test('come with the room, everyone sees them, and the chair changes them in the waiting room', async () => {
    const table = await seatTable(false, { guessRule: 'standard', clueLength: 2, guessTime: 0 });
    const expected = { ...defaultSettings('en'), guessRule: 'standard', clueLength: 2, guessTime: 0 };
    for (const client of table.everyone) expect(data(client).settings).toEqual(expected);
    const ann = table.captains.red;
    const loose = { ...expected, clueRule: 'loose' };
    await expectOk(ann.send('room:settings', { settings: loose }));
    await table.screen.waitFor((state) => (state.data as KeywordsRoomData).settings.clueRule === 'loose');
    await expectOk(ann.send('room:start', { round: 0 }));
    expect(await ann.send('room:settings', { settings: expected })).toEqual({ ok: false, error: 'wrong_phase' });
  });

  test('must be whole and suit the language of the room', async () => {
    const { chair } = await createRoom(server.url, 'Ann', { game: 'keywords' });
    clients.push(chair);
    const english = defaultSettings('en');
    for (const settings of [
      { ...english, clueLength: 4 },
      { ...english, clueTime: 5 },
      { ...english, guessTime: 30.5 },
      { ...english, guessRule: 'fast' },
      { ...english, guessTime: '90' },
      { ...english, extensions: 'yes' },
      { guessRule: 'free' },
      'free',
      null,
    ]) {
      expect(await chair.send('room:settings', { settings }), JSON.stringify(settings)).toEqual({
        ok: false,
        error: 'bad_settings',
      });
    }
    // A Chinese room counts characters, up to 10.
    const ctx = { ...context(), phase: 'lobby' as const, language: 'zh' as const };
    const configure = (clueLength: number) =>
      keywordsGame.configure(keywordsGame.create('zh'), ctx, { ...defaultSettings('zh'), clueLength });
    expect(configure(11)).toEqual({ ok: false, error: 'bad_settings' });
    expect(configure(10)).toMatchObject({ ok: true, data: { settings: { clueLength: 10 } } });
  });

  test('of the clue reach the clue check: an English room may allow clues of several words', async () => {
    const table = await seatTable(true, { clueLength: 2 });
    const team = board(table.captains.red).team;
    const captain = table.captains[team];
    const now = moment(board(captain));
    expect(await captain.send('keywords:clue', { ...now, word: 'one two three', count: 1 })).toEqual({
      ok: false,
      error: 'clue_too_many_words',
    });
    await expectOk(captain.send('keywords:clue', { ...now, word: 'gentle   nudge', count: 1 }));
    expect(board(captain).clue).toEqual({ word: 'gentle nudge', count: 1 });
  });

  test('of the free guess rule take a number from 1 to the cards the group has left', async () => {
    const table = await seatTable();
    const team = board(table.captains.red).team;
    const captain = table.captains[team];
    const now = moment(board(captain));
    for (const count of [0, 10, 'unlimited']) {
      expect(await captain.send('keywords:clue', { ...now, word: 'Hint', count }), String(count)).toEqual({
        ok: false,
        error: 'bad_count',
      });
    }
    await expectOk(captain.send('keywords:clue', { ...now, word: 'Hint', count: 9 }));
    expect(board(captain).guessesLeft).toBeNull();
  });
});

describe('the time limits', () => {
  test('are kept by the server, which ends a turn whose time has run out', async () => {
    const table = await seatTable(true, { firstClueTime: 30, clueTime: 10, guessTime: 20 });
    const ann = table.captains.red;
    const first = board(ann).team;
    expect(board(ann).clock).toEqual({ left: 30_000, total: 30_000 });
    server.advance(12_000);
    // A new snapshot says how much time is left when it is sent.
    await expectOk(table.guessers.red.send('keywords:say', { gameId: board(ann).gameId, text: 'Hurry' }));
    await ann.waitFor((state) => ((state.data as KeywordsRoomData).game?.chat?.length ?? 0) > 0, 'the message');
    expect(board(ann).clock).toEqual({ left: 18_000, total: 30_000 });

    // The first PI says nothing in time: the turn goes to the other group, with no clue on record.
    server.advance(18_000);
    await settle(table);
    expect(board(table.spectator)).toMatchObject({ turn: 2, team: otherTeam(first), phase: 'clue' });
    expect(board(table.spectator).clock).toEqual({ left: 10_000, total: 10_000 });
    // The record says when the time ran out, from the start of the game, and whose time it was. The
    // room hears of the PI who missed the deadline; a guest's misses go uncounted.
    const pi = table.captains[first].me;
    expect(board(table.spectator).history).toEqual([
      { turn: 1, team: first, word: null, count: null, guesses: [], timedOut: true, captain: pi, at: 30_000 },
    ]);
    expect(board(table.spectator).events).toEqual([{ turn: 1, kind: 'missed', team: first, player: pi }]);

    // The second group's students run out of time without revealing anything.
    const second = otherTeam(first);
    await expectOk(table.captains[second].send('keywords:clue', { ...moment(board(ann)), word: 'Hint', count: 1 }));
    await settle(table);
    expect(board(table.spectator).clock).toEqual({ left: 20_000, total: 20_000 });
    const guesser = table.guessers[second];
    const late = moment(board(guesser));
    // Their reveal arrives just after the time is up, before the timer has fired: it is stale.
    server.advance(20_000, false);
    expect(await guesser.send('keywords:reveal', { ...late, card: 0 })).toEqual({ ok: false, error: 'stale' });
    await settle(table);
    expect(board(table.spectator)).toMatchObject({ turn: 3, team: first, phase: 'clue', guessesMade: 0 });
    expect(board(table.spectator).history[1]).toEqual({
      turn: 2,
      team: second,
      word: 'Hint',
      count: 1,
      guesses: [],
      timedOut: true,
      captain: table.captains[second].state?.me,
      at: 30_000,
    });
    // The timer that was set for that turn is gone; the next turn has its own.
    expect(server.timers()).toBe(1);
  });

  test('stop when the game ends or the chair withdraws it', async () => {
    const table = await seatTable();
    const ann = table.captains.red;
    expect(server.timers()).toBe(1);
    await expectOk(ann.send('room:end', { gameId: board(ann).gameId }));
    expect(server.timers()).toBe(0);
    expect(board(ann).clock).toBeNull();
    server.advance(10 * 60_000);
    expect(board(ann).history).toEqual([]);
  });

  test('can be turned off', async () => {
    const table = await seatTable(true, { firstClueTime: 0, clueTime: 0, guessTime: 0 });
    expect(board(table.spectator).clock).toBeNull();
    expect(server.timers()).toBe(0);
  });
});

describe('coming to play', () => {
  test('a newcomer who comes to play becomes a student of the smaller group, and the others watch', async () => {
    const { chair: ann, code } = await createRoom(server.url, 'Ann', { game: 'keywords', play: true });
    clients.push(ann);
    const annSeat = data(ann).seats[ann.me];
    expect(annSeat?.role).toBe('guesser');
    const bob = await joinRoom(server.url, code, 'Bob', { play: true });
    const cat = await joinRoom(server.url, code, 'Cat', { play: false });
    const dan = await joinRoom(server.url, code, 'Dan');
    clients.push(bob, cat, dan);
    const seats = data(dan).seats;
    expect(seats[bob.me]).toEqual({ team: otherTeam(annSeat?.team ?? 'red'), role: 'guesser' });
    expect(seats[cat.me]).toEqual(SPECTATOR);
    expect(seats[dan.me]).toEqual(SPECTATOR);
    // Nobody is made a PI: the chair's shuffle picks them.
    expect(data(dan).startProblems.map(({ problem }) => problem)).toEqual(['needs_captain', 'needs_captain']);
    await expectOk(ann.send('room:shuffle'));
    expect(data(ann).startProblems.map(({ problem }) => problem)).toEqual(['needs_guesser', 'needs_guesser']);
  });

  test('during a game, the seat rules hold for whoever comes to play', async () => {
    const table = await seatTable();
    const ann = table.captains.red;
    // A latecomer evens out the groups.
    await expectOk(table.spectator.send('keywords:seat', { team: 'blue', role: 'guesser' }));
    const fay = await joinRoom(server.url, table.code, 'Fay', { play: true });
    clients.push(fay);
    expect(data(fay).seats[fay.me]).toEqual({ team: 'red', role: 'guesser' });
    expect(data(fay).side).toBe('red');

    // Dan leaves the blue group, which is still the bigger one, and comes back to it.
    const dan = table.guessers.blue;
    await expectOk(dan.send('room:leave'));
    const danBack = await TestClient.connect(server.url, { token: dan.token });
    clients.push(danBack);
    expect(await danBack.send('room:join', { code: table.code, name: 'Dan', play: true })).toMatchObject({ ok: true });
    await danBack.waitFor((state) => state.me !== null);
    expect(data(danBack).seats[danBack.me]).toEqual({ team: 'blue', role: 'guesser' });

    // Ann has seen the key, so she comes back as a spectator.
    await expectOk(ann.send('room:leave'));
    const annBack = await TestClient.connect(server.url, { token: ann.token });
    clients.push(annBack);
    expect(await annBack.send('room:join', { code: table.code, name: 'Ann', play: true })).toMatchObject({
      ok: true,
    });
    await annBack.waitFor((state) => state.me !== null);
    expect(data(annBack).seats[annBack.me]).toEqual(SPECTATOR);
    expect(data(annBack).side).toBe('red');
  });

  test('after the game has ended, whoever sits down for the next one is no player of this one', async () => {
    const table = await seatTable();
    await expectOk(table.captains.red.send('room:end', { gameId: board(table.captains.red).gameId }));
    const fay = await joinRoom(server.url, table.code, 'Fay', { play: true });
    clients.push(fay);
    expect(data(fay).seats[fay.me]?.role).toBe('guesser');
    expect(data(fay).side).toBeNull();
    // Eve watched the game, and takes a seat for the next one; Bob played for red and stays red.
    const eve = table.spectator;
    await expectOk(eve.send('keywords:seat', { team: 'red', role: 'guesser' }));
    expect(data(eve).seats[eve.me]).toEqual({ team: 'red', role: 'guesser' });
    expect(data(eve).side).toBeNull();
    expect(data(table.guessers.red).side).toBe('red');
  });
});

describe('quick reactions', () => {
  test('come from no PI while the students guess, and from the PIs again once the turn is over', async () => {
    const table = await seatTable();
    const team = board(table.captains.red).team;
    const captain = table.captains[team];
    const guesser = table.guessers[team];
    const emote = (client: TestClient) => client.send('room:emote', { emote: 'waiting' });
    await expectOk(captain.send('keywords:clue', { ...moment(board(captain)), word: 'Hint', count: 1 }));
    await settle(table);
    for (const pi of [table.captains.red, table.captains.blue]) {
      expect(await emote(pi)).toEqual({ ok: false, error: 'emote_not_now' });
      expect(data(pi).mayEmote).toBe(false);
    }
    for (const client of [guesser, table.guessers[otherTeam(team)], table.spectator]) {
      expect(data(client).mayEmote).toBe(true);
      await expectOk(emote(client));
    }
    // The other group's PI steps out to watch, and is held back all the same, having seen the
    // key; back in the seat, the same.
    const other = table.captains[otherTeam(team)];
    await expectOk(other.send('keywords:seat', { team: null, role: 'spectator' }));
    await settle(table);
    expect(data(other).seats[other.me]).toEqual({ team: null, role: 'spectator' });
    expect(data(other).mayEmote).toBe(false);
    expect(await emote(other)).toEqual({ ok: false, error: 'emote_not_now' });
    await expectOk(other.send('keywords:seat', { team: otherTeam(team), role: 'captain' }));
    await settle(table);
    expect(data(other).mayEmote).toBe(false);
    expect(await emote(other)).toEqual({ ok: false, error: 'emote_not_now' });
    // The turn ends, and the PIs may react at once: a refusal starts no wait.
    const own = board(captain).cards.findIndex((card) => card.color === team);
    await expectOk(guesser.send('keywords:reveal', { ...moment(board(guesser)), card: own }));
    await expectOk(guesser.send('keywords:pass', moment(board(guesser))));
    await settle(table);
    for (const pi of [table.captains.red, table.captains.blue]) {
      expect(data(pi).mayEmote).toBe(true);
      await expectOk(emote(pi));
    }
  });

  test('come from spectators as well as players, and reach the screen', async () => {
    const table = await seatTable();
    await expectOk(table.spectator.send('room:emote', { emote: 'deadline' }));
    await expectOk(table.guessers.red.send('room:emote', { emote: 'waiting' }));
    await until(() => table.screen.emotes.length === 2, 'the screen hears both');
    expect(table.screen.emotes.map(({ playerId }) => playerId)).toEqual([table.spectator.me, table.guessers.red.me]);
  });
});

describe('seats during a game', () => {
  test('a captain who leaves can be replaced, and cannot come back as a guesser', async () => {
    const table = await seatTable();
    const ann = table.captains.red;
    await expectOk(ann.send('room:leave'));
    const eve = table.spectator;
    await eve.waitFor((state) => !state.players.some((player) => player.name === 'Ann'), 'Ann gone');
    expect(board(eve).cards.some((card) => !card.revealed && card.color)).toBe(false);

    await expectOk(eve.send('keywords:seat', { team: 'red', role: 'captain' }));
    expect(board(eve).cards.every((card) => card.color)).toBe(true);
    expect(await eve.send('keywords:seat', { team: 'red', role: 'guesser' })).toEqual({
      ok: false,
      error: 'key_viewer',
    });

    const back = await TestClient.connect(server.url, { token: ann.token });
    clients.push(back);
    expect(await back.send('room:join', { code: table.code, name: 'Ann' })).toMatchObject({ ok: true });
    await back.waitFor((state) => state.me !== null);
    expect(data(back).keyViewers).toContain(back.me);
    expect(await back.send('keywords:seat', { team: 'red', role: 'guesser' })).toEqual({
      ok: false,
      error: 'key_viewer',
    });
    // Leaving the room doesn't change the group a player belongs to in this game.
    expect(await back.send('keywords:seat', { team: 'blue', role: 'guesser' })).toEqual({
      ok: false,
      error: 'other_team',
    });
    await expectOk(back.send('keywords:seat', { team: null, role: 'spectator' }));
  });

  test('the chair can move a player to the spectators, and a captain who steps down loses the key view', async () => {
    const table = await seatTable();
    const ann = table.captains.red;
    const bob = table.guessers.red;
    await expectOk(ann.send('room:spectate', { playerId: bob.me }));
    await bob.waitFor((state) => (state.data as KeywordsRoomData).seats[bob.me]?.role === 'spectator');
    await expectOk(ann.send('keywords:seat', { team: null, role: 'spectator' }));
    expect(board(ann).cards.some((card) => !card.revealed && card.color)).toBe(false);
  });

  test('nobody changes groups in the middle of a game', async () => {
    const table = await seatTable();
    const bob = table.guessers.red;
    expect(data(bob).side).toBe('red');
    expect(data(table.spectator).side).toBeNull();
    expect(data(table.screen).side).toBeNull();
    expect(await bob.send('keywords:seat', { team: 'blue', role: 'guesser' })).toEqual({
      ok: false,
      error: 'other_team',
    });
    await expectOk(bob.send('keywords:seat', { team: null, role: 'spectator' }));
    expect(data(bob).side).toBe('red');
    expect(await bob.send('keywords:seat', { team: 'blue', role: 'captain' })).toEqual({
      ok: false,
      error: 'other_team',
    });
    await expectOk(bob.send('keywords:seat', { team: 'red', role: 'guesser' }));
    // Eve hasn't played in this game, so she may join either group.
    await expectOk(table.spectator.send('keywords:seat', { team: 'blue', role: 'guesser' }));
    expect(data(table.spectator).side).toBe('blue');
  });
});

describe('talking it over', () => {
  test('a guesser chooses cards for their group to see, and a reveal clears every choice', async () => {
    const table = await seatTable();
    const team = board(table.captains.red).team;
    const other = otherTeam(team);
    const captain = table.captains[team];
    const guesser = table.guessers[team];
    const choose = (client: TestClient, card: unknown) =>
      client.send('keywords:select', { ...moment(board(client)), card });

    expect(await choose(guesser, 0)).toEqual({ ok: false, error: 'wrong_phase' });
    await expectOk(captain.send('keywords:clue', { ...moment(board(captain)), word: 'Hint', count: 2 }));
    await settle(table);
    const own = board(captain).cards.findIndex((card) => card.color === team);
    const neutral = board(captain).cards.findIndex((card) => card.color === 'neutral');

    await expectOk(choose(guesser, neutral));
    await settle(table);
    for (const client of [captain, guesser]) {
      expect(board(client).selections).toEqual([{ player: guesser.me, card: neutral }]);
    }
    // The same choice again is granted, and changes nothing.
    const rev = guesser.state?.rev;
    await expectOk(choose(guesser, neutral));
    await guesser.send('sys:ping');
    expect(guesser.state?.rev).toBe(rev);
    for (const client of [table.captains[other], table.guessers[other], table.spectator, table.screen]) {
      expect(board(client)).not.toHaveProperty('selections');
    }

    expect(await choose(table.guessers[other], own)).toEqual({ ok: false, error: 'not_your_turn' });
    expect(await choose(table.spectator, own)).toEqual({ ok: false, error: 'not_your_turn' });
    expect(await choose(captain, own)).toEqual({ ok: false, error: 'not_guesser' });
    expect(await choose(guesser, 30)).toEqual({ ok: false, error: 'no_such_card' });
    expect(await choose(guesser, 'card')).toEqual({ ok: false, error: 'bad_request' });

    await expectOk(choose(guesser, null));
    expect(board(guesser).selections).toEqual([]);
    await expectOk(choose(guesser, neutral));
    await expectOk(guesser.send('keywords:reveal', { ...moment(board(guesser)), card: own }));
    expect(board(guesser).phase).toBe('guess');
    expect(board(guesser).selections).toEqual([]);
    await settle(table);
    expectGroupsApart(table);
  });

  test("a guesser marks cards for their group's guessers alone, in either turn, and a reveal clears them", async () => {
    const table = await seatTable();
    const team = board(table.captains.red).team;
    const other = otherTeam(team);
    const bob = table.guessers[team];
    const eve = table.spectator;
    await expectOk(eve.send('keywords:seat', { team, role: 'guesser' }));
    const { gameId } = board(bob);
    const mark = (client: TestClient, card: unknown, kind: unknown) =>
      client.send('keywords:mark', { gameId, card, mark: kind });

    // Before the clue, and the other group as well.
    await expectOk(mark(bob, 3, 'ours'));
    await expectOk(mark(table.guessers[other], 5, 'theirs'));
    await settle(table);
    for (const client of [bob, eve]) expect(board(client).marks).toEqual([{ card: 3, mark: 'ours' }]);
    expect(board(table.guessers[other]).marks).toEqual([{ card: 5, mark: 'theirs' }]);
    for (const client of [table.captains.red, table.captains.blue, table.screen]) {
      expect(board(client)).not.toHaveProperty('marks');
    }

    // Eve changes Bob's mark, and the last one stands; the same mark again changes nothing.
    await expectOk(mark(eve, 3, 'r2'));
    await settle(table);
    expect(board(bob).marks).toEqual([{ card: 3, mark: 'r2' }]);
    const rev = bob.state?.rev;
    await expectOk(mark(eve, 3, 'r2'));
    await bob.send('sys:ping');
    expect(bob.state?.rev).toBe(rev);

    expect(await mark(table.captains[team], 3, 'ours')).toEqual({ ok: false, error: 'not_guesser' });
    expect(await mark(bob, 30, 'ours')).toEqual({ ok: false, error: 'no_such_card' });
    expect(await mark(bob, 3, 'maybe')).toEqual({ ok: false, error: 'bad_request' });
    expect(await bob.send('keywords:mark', { gameId: 'other', card: 3, mark: null })).toEqual({
      ok: false,
      error: 'stale',
    });

    // Bob reconnects, and finds the group's marks as they were.
    bob.close();
    const back = await TestClient.connect(server.url, { token: bob.token, code: table.code });
    clients.push(back);
    await back.waitFor((state) => (state.data as KeywordsRoomData).game?.marks !== undefined, 'the marks back');
    expect(board(back).marks).toEqual([{ card: 3, mark: 'r2' }]);

    // A reveal takes the card's marks away, both groups', and leaves the others.
    const captain = table.captains[team];
    const own = board(captain).cards.findIndex((card, index) => card.color === team && index !== 3 && index !== 5);
    await expectOk(mark(back, own, 'ours'));
    await expectOk(mark(table.guessers[other], own, 'r2'));
    await expectOk(captain.send('keywords:clue', { ...moment(board(captain)), word: 'Hint', count: 1 }));
    await expectOk(back.send('keywords:reveal', { ...moment(board(captain)), card: own }));
    await back.waitFor((state) => (state.data as KeywordsRoomData).game?.cards[own]?.revealed === true, 'the reveal');
    expect(board(back).marks).toEqual([{ card: 3, mark: 'r2' }]);
    await table.guessers[other].waitFor(
      (state) => (state.data as KeywordsRoomData).game?.cards[own]?.revealed === true,
    );
    expect(board(table.guessers[other]).marks).toEqual([{ card: 5, mark: 'theirs' }]);
  });

  test('marking cards fast is slowed down like any message', async () => {
    const table = await seatTable();
    const bob = table.guessers.red;
    const { gameId } = board(bob);
    const replies = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        bob.send('keywords:mark', { gameId, card: index % 25, mark: index % 2 ? 'ours' : null }),
      ),
    );
    expect(replies.filter((reply) => !reply.ok).every((reply) => reply.error === 'rate_limited')).toBe(true);
    expect(replies.filter((reply) => !reply.ok).length).toBeGreaterThan(0);
  });

  test('a guesser who leaves their seat or the room takes their choice along', async () => {
    const table = await seatTable();
    const team = board(table.captains.red).team;
    const captain = table.captains[team];
    const bob = table.guessers[team];
    const eve = table.spectator;
    const choose = (client: TestClient, card: number) =>
      expectOk(client.send('keywords:select', { ...moment(board(client)), card }));
    const chosen = (count: number) =>
      captain.waitFor(
        (state) => (state.data as KeywordsRoomData).game?.selections?.length === count,
        `${count} chosen`,
      );

    await expectOk(eve.send('keywords:seat', { team, role: 'guesser' }));
    await expectOk(captain.send('keywords:clue', { ...moment(board(captain)), word: 'Hint', count: 1 }));
    await settle(table);
    await choose(bob, 0);
    await choose(eve, 1);
    await chosen(2);

    // Eve steps out to watch, comes back, and is moved to the spectators by the chair.
    await expectOk(eve.send('keywords:seat', { team: null, role: 'spectator' }));
    await chosen(1);
    await expectOk(eve.send('keywords:seat', { team, role: 'guesser' }));
    await choose(eve, 1);
    await chosen(2);
    await expectOk(table.captains.red.send('room:spectate', { playerId: eve.me }));
    await chosen(1);

    // She comes back once more, chooses, and leaves the room.
    await expectOk(eve.send('keywords:seat', { team, role: 'guesser' }));
    await choose(eve, 1);
    await chosen(2);
    await expectOk(eve.send('room:leave'));
    await chosen(1);
    expect(board(captain).selections).toEqual([{ player: bob.me, card: 0 }]);
  });

  test('guessers write to their group, captains only read it, and nobody else sees it', async () => {
    const table = await seatTable();
    const team = board(table.captains.red).team;
    const other = otherTeam(team);
    const { gameId } = board(table.captains.red);
    const say = (client: TestClient, text: unknown, game = gameId) =>
      client.send('keywords:say', { gameId: game, text });

    // Either group may talk in either group's turn.
    await expectOk(say(table.guessers[other], 'wait for their clue'));
    await expectOk(say(table.guessers[team], '  line one\nline two  '));
    await settle(table);
    const ours = [{ id: 1, player: table.guessers[team].me, turn: 1, text: 'line one line two' }];
    const theirs = [{ id: 1, player: table.guessers[other].me, turn: 1, text: 'wait for their clue' }];
    expect(board(table.captains[team]).chat).toEqual(ours);
    expect(board(table.guessers[team]).chat).toEqual(ours);
    expect(board(table.captains[other]).chat).toEqual(theirs);
    expect(board(table.spectator)).not.toHaveProperty('chat');
    expect(board(table.screen)).not.toHaveProperty('chat');

    expect(await say(table.captains[team], 'psst')).toEqual({ ok: false, error: 'not_guesser' });
    expect(await say(table.spectator, 'hello')).toEqual({ ok: false, error: 'not_guesser' });
    expect(await say(table.guessers[team], ' \n ')).toEqual({ ok: false, error: 'chat_empty' });
    for (const text of [
      'x'.repeat(MAX_CHAT_LENGTH + 1),
      'x'.repeat(MAX_CHAT_INPUT + 1),
      '\u{1f600}'.repeat(MAX_CHAT_INPUT / 2 + 1),
    ]) {
      expect(await say(table.guessers[team], text)).toEqual({ ok: false, error: 'chat_too_long' });
    }
    expect(await say(table.guessers[team], 42)).toEqual({ ok: false, error: 'bad_request' });
    expect(await say(table.guessers[team], 'hi', 'an-earlier-game')).toEqual({ ok: false, error: 'stale' });

    // Once the game is over, every color is shown, but the chat stays in its group.
    await expectOk(table.captains.red.send('room:end', { gameId }));
    await settle(table);
    expect(board(table.spectator).phase).toBe('over');
    expect(board(table.captains[team]).chat).toEqual(ours);
    expect(await say(table.guessers[team], 'gg')).toEqual({ ok: false, error: 'game_over' });
    expectGroupsApart(table);

    // The groups hold until the next game, also for whoever the chair moves to the spectators
    // now, since the chats are still there to read. "Play again" frees everyone.
    const bob = table.guessers[team];
    await expectOk(table.captains.red.send('room:spectate', { playerId: bob.me }));
    expect(await bob.send('keywords:seat', { team: other, role: 'guesser' })).toEqual({
      ok: false,
      error: 'other_team',
    });
    expect(await table.captains[team].send('keywords:seat', { team, role: 'guesser' })).toEqual({
      ok: false,
      error: 'key_viewer',
    });
    await expectOk(bob.send('keywords:seat', { team, role: 'guesser' }));
    expect(board(bob).chat).toEqual(ours);
    await expectOk(table.captains.red.send('room:again', { gameId }));
    await expectOk(bob.send('keywords:seat', { team: other, role: 'guesser' }));
  });
});

describe('a pause', () => {
  test('takes the board from everyone and stops the clock, until the chair resumes', async () => {
    const table = await seatTable(true, { firstClueTime: 30, clueTime: 10, guessTime: 20 });
    const ann = table.captains.red;
    const { gameId } = board(ann);
    server.advance(10_000);
    // Only the chair.
    expect(await table.guessers.red.send('keywords:pause', { gameId })).toEqual({ ok: false, error: 'not_chair' });
    await expectOk(ann.send('keywords:pause', { gameId }));
    await settle(table);
    for (const client of table.everyone) {
      expect(board(client)).toMatchObject({ paused: true, cards: [], clock: { left: 20_000, total: 30_000 } });
      expect(JSON.stringify(client.state)).not.toMatch(/general w/);
    }
    expect(server.timers()).toBe(0);
    // Nothing moves on, however long: no clue, no reveal, no turn that ends.
    server.advance(60_000);
    const captain = table.captains[board(ann).team];
    const guesser = table.guessers[board(ann).team];
    expect(await captain.send('keywords:clue', { ...moment(board(ann)), word: 'Hint', count: 1 })).toEqual({
      ok: false,
      error: 'paused',
    });
    expect(await guesser.send('keywords:extend', moment(board(ann)))).toEqual({ ok: false, error: 'paused' });
    expect(await ann.send('keywords:pause', { gameId })).toEqual({ ok: false, error: 'paused' });
    // The group chat goes on.
    await expectOk(guesser.send('keywords:say', { gameId, text: 'Tea break' }));
    await settle(table);
    expect(board(ann).turn).toBe(1);
    expect(board(ann).events).toEqual([{ turn: 1, kind: 'paused' }]);

    await expectOk(ann.send('keywords:resume', { gameId }));
    await settle(table);
    for (const client of table.everyone) {
      expect(board(client)).toMatchObject({ paused: false, clock: { left: 20_000, total: 30_000 } });
      expect(board(client).cards).toHaveLength(25);
    }
    expect(server.timers()).toBe(1);
    expect(await ann.send('keywords:resume', { gameId })).toEqual({ ok: false, error: 'not_paused' });
    // The clock goes on from where it stopped: the turn ends 20 seconds later.
    server.advance(19_000);
    expect(board(table.spectator).turn).toBe(1);
    server.advance(1_000);
    await table.spectator.waitFor((state) => ((state.data as KeywordsRoomData).game as KeywordsView).turn === 2);
    expect(board(table.spectator)).toMatchObject({ turn: 2, phase: 'clue' });
    expect(board(table.spectator).events).toEqual([
      { turn: 1, kind: 'paused' },
      { turn: 1, kind: 'resumed' },
      { turn: 1, kind: 'missed', team: 'red', player: ann.me },
    ]);
  });

  test('is resumed by whoever chairs the room after the chair has been away', async () => {
    const table = await seatTable(true, { firstClueTime: 30, clueTime: 10, guessTime: 20 });
    const ann = table.captains.red;
    const { gameId } = board(ann);
    await expectOk(ann.send('keywords:pause', { gameId }));
    await settle(table);
    ann.close();
    const bob = table.guessers.red;
    await bob.waitFor((state) => !(state.players.find((player) => player.id === ann.me)?.online ?? true));
    expect(await bob.send('keywords:resume', { gameId })).toEqual({ ok: false, error: 'not_chair' });
    server.advance(3 * 60_000);
    server.app.sockets.sweep();
    await bob.waitFor((state) => state.chairId === bob.me, 'the chair');
    await expectOk(bob.send('keywords:resume', { gameId }));
    await bob.waitFor((state) => !((state.data as KeywordsRoomData).game as KeywordsView).paused);
    expect(board(bob).clock).toEqual({ left: 30_000, total: 30_000 });
  });
});

describe('an extension', () => {
  test('gives the phase 30 seconds more, once a game for each group, when the room allows it', async () => {
    const table = await seatTable(true, { firstClueTime: 30, clueTime: 10, guessTime: 20, extensions: true });
    const ann = table.captains.red;
    const team = board(ann).team;
    const captain = table.captains[team];
    expect(data(ann).settings.extensions).toBe(true);
    server.advance(5_000);
    await expectOk(captain.send('keywords:extend', moment(board(ann))));
    await settle(table);
    expect(board(table.spectator).clock).toEqual({ left: 55_000, total: 60_000 });
    expect(board(table.spectator).extended).toEqual({ red: false, blue: false, [team]: true });
    expect(board(table.spectator).events).toEqual([{ turn: 1, kind: 'extended', team }]);
    expect(await captain.send('keywords:extend', moment(board(ann)))).toEqual({ ok: false, error: 'extension_used' });
    // The timer was moved along with the clock.
    server.advance(30_000);
    expect(board(table.spectator).turn).toBe(1);
    server.advance(25_000);
    await table.spectator.waitFor((state) => ((state.data as KeywordsRoomData).game as KeywordsView).turn === 2);
  });

  test('is refused where the room leaves it off', async () => {
    const table = await seatTable(true, { firstClueTime: 30 });
    const ann = table.captains.red;
    const captain = table.captains[board(ann).team];
    expect(await captain.send('keywords:extend', moment(board(ann)))).toEqual({ ok: false, error: 'no_extension' });
  });
});

describe('custom words', () => {
  // Twenty-five Chinese words that don't clash: a character and a number each.
  const chinese = Array.from({ length: 25 }, (_, i) => `\u8bcd${i}`);

  test("are the chair's to set in the waiting room, and the players hear only how many there are", async () => {
    const table = await seatTable(false);
    const ann = table.captains.red;
    const text = 'Alpha, Beta\u3001Gamma\nalpha\n\n Delta ';
    await expectOk(ann.send('room:settings', { words: text }));
    await table.screen.waitFor((state) => state.customWordCount === 4, 'the count');
    expect(ann.state?.customWords).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
    for (const client of table.everyone.filter((other) => other !== ann)) {
      expect(client.state?.customWordCount).toBe(4);
      expect(client.state).not.toHaveProperty('customWords');
      expect(JSON.stringify(client.state)).not.toMatch(/Alpha|Gamma/);
    }
    // Not for the players, and not during a game.
    expect(await table.guessers.red.send('room:settings', { words: 'Mine' })).toEqual({
      ok: false,
      error: 'not_chair',
    });
    // Words that don't fit on a card, or too many, are refused as a whole.
    expect(await ann.send('room:settings', { words: 'Fine\nFourteenletters' })).toEqual({
      ok: false,
      error: 'bad_words',
    });
    expect(await ann.send('room:settings', { words: `${'\u8bcd'.repeat(6)}` })).toEqual({
      ok: false,
      error: 'bad_words',
    });
    const many = Array.from({ length: 201 }, (_, i) => `w${i}`).join('\n');
    expect(await ann.send('room:settings', { words: many })).toEqual({ ok: false, error: 'bad_words' });
    // The same list again changes nothing; an empty text takes them away.
    const { rev } = ann.state as { rev: number };
    await expectOk(ann.send('room:settings', { words: text }));
    expect(ann.state?.rev).toBe(rev);
    await expectOk(ann.send('room:settings', { words: '' }));
    await ann.waitFor((state) => state.customWordCount === 0);
    expect(ann.state?.customWords).toEqual([]);
  });

  test('are dealt with the word lists, unused words first, and alone when there are enough of them', async () => {
    const table = await seatTable(false);
    const ann = table.captains.red;
    // Too few words of the chair's own to drop every list.
    expect(await ann.send('room:settings', { fields: [], words: chinese.slice(0, 24).join('\n') })).toEqual({
      ok: false,
      error: 'no_words',
    });
    await expectOk(ann.send('room:settings', { fields: [], words: chinese.join('\n') }));
    await ann.waitFor((state) => state.fields.length === 0 && state.customWordCount === 25);
    await expectOk(ann.send('room:start', { round: ann.state?.round }));
    await settle(table);
    const words = board(table.spectator).cards.map((card) => card.word);
    expect([...words].sort()).toEqual([...chinese].sort());
    // During the game the chair, who has nothing to edit, gets the count like everyone else.
    expect(ann.state).not.toHaveProperty('customWords');
    expect(ann.state?.customWordCount).toBe(25);
    // Every card has its pinyin, which everyone sees, and which no clue may be.
    expect(
      board(table.spectator)
        .cards.map((card) => card.pinyin)
        .every((pinyin) => /^ci \d+$/.test(pinyin ?? '')),
    ).toBe(true);
    const captain = table.captains[board(ann).team];
    const index = words.indexOf('\u8bcd7');
    expect(await captain.send('keywords:clue', { ...moment(board(ann)), word: 'ci7', count: 1 })).toEqual({
      ok: false,
      error: 'clue_on_board',
    });
    expect(index).toBeGreaterThanOrEqual(0);
    // The next game takes the words that haven't been played yet first: the one new word is on
    // the board, with 24 of the words played already.
    await expectOk(ann.send('room:end', { gameId: board(ann).gameId }));
    await expectOk(ann.send('room:again', { gameId: board(ann).gameId }));
    await expectOk(ann.send('room:settings', { words: [...chinese, 'Extra'].join('\n') }));
    await ann.waitFor((state) => state.customWordCount === 26);
    expect(ann.state?.customWords).toHaveLength(26);
    await expectOk(ann.send('room:start', { round: ann.state?.round }));
    await settle(table);
    const next = board(table.spectator).cards.map((card) => card.word);
    expect(next).toContain('Extra');
    expect(next.filter((word) => chinese.includes(word))).toHaveLength(24);
  });

  test('keep a room private', async () => {
    const ann = new Browser(server.url);
    expect((await ann.register('Ann')).body).toEqual({ ok: true });
    const chair = await ann.connect();
    clients.push(chair);
    const reply = await chair.send('room:create', {
      game: 'keywords',
      language: 'en',
      fields: ['general'],
      public: true,
    });
    expect(reply).toMatchObject({ ok: true });
    await chair.waitFor((state) => state.public);
    expect(await chair.send('room:settings', { words: 'Mine' })).toEqual({ ok: false, error: 'custom_words_private' });
    await expectOk(chair.send('room:public', { public: false }));
    await chair.waitFor((state) => !state.public);
    await expectOk(chair.send('room:settings', { words: 'Mine' }));
    await chair.waitFor((state) => state.customWordCount === 1);
    expect(await chair.send('room:public', { public: true })).toEqual({ ok: false, error: 'custom_words_private' });
    await expectOk(chair.send('room:settings', { words: '' }));
    await chair.waitFor((state) => state.customWordCount === 0);
    await expectOk(chair.send('room:public', { public: true }));
  });
});

describe('playing again', () => {
  test('keeps the seats and deals a new board', async () => {
    const table = await seatTable();
    const ann = table.captains.red;
    const firstWords = board(ann).cards.map((card) => card.word);
    const firstGame = board(ann).gameId;
    await expectOk(ann.send('room:end', { gameId: firstGame }));
    expect(board(ann).result).toEqual({ winner: null, reason: 'withdrawn' });
    await expectOk(ann.send('room:again', { gameId: firstGame }));
    expect(ann.state?.phase).toBe('lobby');
    expect(data(ann).game).toBeNull();
    expect(data(ann).seats[ann.me]).toEqual({ team: 'red', role: 'captain' });
    expect(data(ann).keyViewers).toEqual([]);
    expect(data(ann).side).toBeNull();
    await expectOk(ann.send('room:start', { round: ann.state?.round }));
    expect(board(ann).gameId).not.toBe(firstGame);
    expect(board(ann).cards.some((card) => firstWords.includes(card.word))).toBe(false);
    // An action for the first game is stale now, as it would be in the waiting room.
    expect(await ann.send('keywords:clue', { gameId: firstGame, turn: 1, word: 'Hint', count: 1 })).toEqual({
      ok: false,
      error: 'stale',
    });
    await expectOk(ann.send('room:end', { gameId: board(ann).gameId }));
    await expectOk(ann.send('room:again', { gameId: board(ann).gameId }));
    expect(await ann.send('keywords:clue', { gameId: firstGame, turn: 1, word: 'Hint', count: 1 })).toEqual({
      ok: false,
      error: 'stale',
    });
    expect(await ann.send('keywords:say', { gameId: firstGame, text: 'late' })).toEqual({ ok: false, error: 'stale' });
  });
});

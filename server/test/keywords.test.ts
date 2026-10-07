import {
  MAX_CHAT_INPUT,
  MAX_CHAT_LENGTH,
  MAX_CLUE_INPUT,
  otherTeam,
  SPECTATOR,
  TEAMS,
  type KeywordsRoomData,
  type KeywordsView,
  type RoomView,
  type Team,
} from '@reviewer2/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { GameContext, GameModule } from '../src/core/game';
import { seededRng } from '../src/core/random';
import { WordLibrary } from '../src/core/words';
import { keywordsGame } from '../src/games/keywords';
import { createRoom, joinRoom, startServer, TestClient, testWords, type Reply, type TestServer } from './helpers';

// The word guessing game over real sockets: seats, a whole game, the checks on every action, and
// above all that only captains ever receive the colors of unrevealed cards.

let server: TestServer;
let clients: TestClient[];

beforeEach(async () => {
  server = await startServer({ games: [keywordsGame as GameModule], words: bigLibrary() });
  clients = [];
});

afterEach(async () => {
  for (const client of clients) client.close();
  await server.close();
});

function bigLibrary(): WordLibrary {
  const general = testWords().pool(['general'], 'en');
  return new WordLibrary([
    {
      id: 'general',
      name: { zh: 'G', en: 'G' },
      terms: Array.from({ length: 60 }, (_, i) => ({ id: `w${i}`, en: general[i]?.word ?? `extra word ${i}` })),
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
async function seatTable(start = true): Promise<Table> {
  const { chair: ann, code } = await createRoom(server.url, 'Ann', { game: 'keywords' });
  const [bob, cat, dan, eve] = await Promise.all(
    ['Bob', 'Cat', 'Dan', 'Eve'].map((name) => joinRoom(server.url, code, name)),
  );
  const screen = await TestClient.connect(server.url);
  expect(await screen.send('room:watch', { code })).toMatchObject({ ok: true });
  const table: Table = {
    code,
    captains: { red: ann, blue: cat as TestClient },
    guessers: { red: bob as TestClient, blue: dan as TestClient },
    spectator: eve as TestClient,
    screen,
    everyone: [ann, bob, cat, dan, eve, screen] as TestClient[],
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
      continue;
    }
    expect(game.chat?.every((message) => group.includes(message.player))).toBe(true);
    if (game.team === team) expect(game.selections?.every((choice) => group.includes(choice.player))).toBe(true);
    else expect(game).not.toHaveProperty('selections');
  }
  expect(checked).toBeGreaterThan(0);
}

// Checks expectOwnGroupOnly for everyone at a table whose seats didn't change.
function expectGroupsApart(table: Table) {
  for (const team of ['red', 'blue'] as const) {
    const group = [table.captains[team].me, table.guessers[team].me];
    expectOwnGroupOnly(table.captains[team], team, group);
    expectOwnGroupOnly(table.guessers[team], team, group);
  }
  expectOwnGroupOnly(table.spectator, null);
  expectOwnGroupOnly(table.screen, null);
}

describe('the view', () => {
  test("shares nothing with the room's own state, and is built once for each seat", () => {
    const ctx: GameContext = {
      phase: 'playing',
      language: 'en',
      rng: seededRng(1),
      keyOf: (id) => id,
      isOnline: () => true,
      playerIds: () => ['ann', 'bob', 'cat'],
    };
    let data = keywordsGame.create();
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
    const other: Team = team === 'red' ? 'blue' : 'red';
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
    // The test words are phrases such as "general word 3", and a clue may not repeat part of one.
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

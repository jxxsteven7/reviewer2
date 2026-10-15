import {
  defaultSettings,
  TEAMS,
  type KeywordsSettings,
  type ReplayGroup,
  type ShownReplay,
  type Team,
} from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import { testWords } from '../../../test/helpers';
import type { GameLogData } from '../../core/gameLog';
import { pick, seededRng } from '../../core/random';
import type { Room } from '../../core/room';
import { Rooms } from '../../core/rooms';
import { keywordsGame, type KeywordsData } from './index';
import { shownReplay } from './replay';
import { seatOf } from './seats';
import { LAYOUT } from './testing';

// A kept game as an account watches it again (docs/architecture.md#replays): worked out, as it is
// opened, from how the game began and its log, with who everyone was.

const COLORS = { R: 'red', B: 'blue', N: 'neutral', X: 'reviewer2' } as const;
const cards = [...LAYOUT].map((letter, index) => ({
  word: `Word${index}`,
  color: COLORS[letter as keyof typeof COLORS],
}));
// Red starts, with 30 seconds for each clue and each turn's guesses.
const settings: KeywordsSettings = {
  ...defaultSettings('en'),
  guessRule: 'standard',
  firstClueTime: 30,
  clueTime: 30,
  guessTime: 30,
};
const setup = { language: 'en', settings, startingTeam: 'red', cards };
const shown = (log: GameLogData, accounts: [string, string][] = [], viewer: string[] = []) =>
  shownReplay({
    setup,
    log,
    accounts: new Map(accounts.map(([id, username]) => [id, { username, avatar: null, handle: `h-${id}` }])),
    viewer: new Set(viewer),
  });

// Ann and Cat are red's and blue's PIs, Bob and Dan their students, Eve watches. Ann and Cat have
// accounts, Bob is the room's second guest, Dan an AI player, and Eve's account was deleted since.
const start = {
  ann: { team: 'red', role: 'captain' },
  bob: { team: 'red', role: 'guesser' },
  eve: { team: null, role: 'spectator' },
  cat: { team: 'blue', role: 'captain' },
  dan: { team: 'blue', role: 'guesser' },
};
const log = (entries: GameLogData['entries'], more: Partial<GameLogData> = {}): GameLogData => ({
  v: 2,
  game: 'keywords',
  gameId: 'g1',
  start,
  agents: { dan: 'reviewer1' },
  guests: { bob: 2 },
  deleted: ['eve'],
  entries,
  ...more,
});

describe('a replay worked out from the log of the game', () => {
  test('has the board, the clues and the guesses, the result, and the groups as the game ended', () => {
    const replay = shown(
      log([
        { t: 1000, by: 'ann', type: 'keywords:clue', data: { turn: 1, word: 'Hint', count: 2, targets: [0, 1] } },
        { t: 2000, by: 'bob', type: 'keywords:reveal', data: { turn: 1, card: 0 } },
        { t: 2500, by: null, type: 'keywords:marks', data: { team: 'red', marks: [{ card: 3, mark: 'ours' }] } },
        { t: 3000, by: 'bob', type: 'keywords:say', said: 'Next one?' },
        { t: 4000, by: 'bob', type: 'keywords:reveal', data: { turn: 1, card: 17 } },
        // Blue's PI lets the time run out, a paper ends red's next turn, and blue's student finds
        // Reviewer 2.
        { t: 34_000, by: null, type: 'tick' },
        { t: 35_000, by: 'ann', type: 'keywords:clue', data: { turn: 3, word: 'Ink', count: 1 } },
        { t: 36_000, by: 'bob', type: 'keywords:reveal', data: { turn: 3, card: 18 } },
        { t: 37_000, by: 'cat', type: 'keywords:clue', data: { turn: 4, word: 'Tea', count: 1 } },
        { t: 38_000, by: 'dan', type: 'keywords:reveal', data: { turn: 4, card: 24 }, agent: 'reviewer1' },
        { t: 38_000, by: null, type: 'end' },
        // What the groups said after the end changes nothing.
        { t: 40_000, by: 'cat', type: 'keywords:say', said: 'Oops' },
      ]),
      [
        ['ann', 'Ann'],
        ['cat', 'Cat'],
      ],
      ['cat'],
    ) as ShownReplay;
    expect(replay).toMatchObject({ gameId: 'g1', language: 'en', startingTeam: 'red', cards, me: 'cat' });
    expect(replay.result).toEqual({ winner: 'red', reason: 'reviewer2' });
    expect(replay.history).toEqual([
      {
        turn: 1,
        team: 'red',
        word: 'Hint',
        count: 2,
        captain: 'ann',
        targets: [0, 1],
        at: 1000,
        guesses: [
          { card: 0, color: 'red', player: 'bob', at: 2000 },
          { card: 17, color: 'neutral', player: 'bob', at: 4000 },
        ],
      },
      { turn: 2, team: 'blue', word: null, count: null, guesses: [], timedOut: true, captain: 'cat', at: 34_000 },
      {
        turn: 3,
        team: 'red',
        word: 'Ink',
        count: 1,
        captain: 'ann',
        at: 35_000,
        guesses: [{ card: 18, color: 'neutral', player: 'bob', at: 36_000 }],
      },
      {
        turn: 4,
        team: 'blue',
        word: 'Tea',
        count: 1,
        captain: 'cat',
        at: 37_000,
        guesses: [{ card: 24, color: 'reviewer2', player: 'dan', at: 38_000 }],
      },
    ]);
    expect(replay.groups).toEqual([
      { team: 'red', captain: 'ann', guessers: ['bob'] },
      { team: 'blue', captain: 'cat', guessers: ['dan'] },
    ]);
    expect(replay.people).toEqual({
      ann: { name: 'Ann', handle: 'h-ann' },
      bob: { guest: 2 },
      cat: { name: 'Cat', handle: 'h-cat' },
      dan: { agent: 'reviewer1' },
    });
  });

  test('follows every seat taken, changed or left, and blames a missed clue on the PI who left the seat', () => {
    const replay = shown(
      log(
        [
          // Fay comes and sits as red's student; Eve, deleted since, sits as blue's.
          { t: 100, by: 'fay', type: 'join', data: { play: true, seat: { team: 'red', role: 'guesser' } } },
          { t: 200, by: 'eve', type: 'keywords:seat', data: { team: 'blue', role: 'guesser' } },
          // Ann steps down as red's PI; the time for the clue runs out, which costs her.
          { t: 300, by: 'ann', type: 'keywords:seat', data: { team: null, role: 'spectator' } },
          { t: 30_000, by: null, type: 'tick', data: { offline: [] } },
          // The chair, Ann, benches Cat, which costs Cat nothing: blue's missed clue is nobody's.
          { t: 30_100, by: 'ann', type: 'bench', data: { player: 'cat' } },
          { t: 60_000, by: null, type: 'tick' },
          // Bob takes red's PI seat, Fay leaves, and Dan, removed, leaves too.
          { t: 60_100, by: 'bob', type: 'keywords:seat', data: { team: 'red', role: 'captain' } },
          { t: 60_200, by: 'fay', type: 'leave' },
          { t: 60_300, by: 'ann', type: 'remove', data: { player: 'dan' } },
          { t: 60_300, by: 'dan', type: 'leave' },
          { t: 61_000, by: 'bob', type: 'keywords:clue', data: { turn: 3, word: 'Hint', count: 1 } },
          { t: 62_000, by: 'gus', type: 'join', data: { play: true, seat: { team: 'red', role: 'guesser' } } },
          { t: 63_000, by: 'gus', type: 'keywords:reveal', data: { turn: 3, card: 24 } },
          { t: 63_000, by: null, type: 'end' },
        ],
        { guests: { bob: 2, gus: 3 } },
      ),
      [['ann', 'Ann']],
    ) as ShownReplay;
    expect(replay.history.map(({ turn, captain, word }) => [turn, captain, word])).toEqual([
      [1, 'ann', null],
      [2, undefined, null],
      [3, 'bob', 'Hint'],
    ]);
    expect(replay.result).toEqual({ winner: 'blue', reason: 'reviewer2' });
    expect(replay.groups).toEqual([
      { team: 'red', captain: 'bob', guessers: ['gus'] },
      { team: 'blue', captain: null, guessers: ['eve'] },
    ]);
    // Ann, who left the groups, is there for the clue that the time ran out on; Eve is a deleted
    // account, and Gus, a guest who came during the game, has the number that the log gives.
    expect(replay.people).toEqual({
      bob: { guest: 2 },
      gus: { guest: 3 },
      eve: { deleted: true },
      ann: { name: 'Ann', handle: 'h-ann' },
    });
  });

  test('times the clock as the game did, with its pauses and extensions', () => {
    const replay = shown(
      log([
        // Paused for a minute with 20 seconds left, then extended by 30: the time for the clue ends
        // 2 minutes after the start.
        { t: 10_000, by: 'ann', type: 'keywords:pause' },
        { t: 70_000, by: 'ann', type: 'keywords:resume' },
        { t: 71_000, by: 'ann', type: 'keywords:extend', data: { turn: 1 } },
        { t: 117_500, by: 'ann', type: 'keywords:clue', data: { turn: 1, word: 'Late', count: 1 } },
        { t: 118_000, by: 'bob', type: 'keywords:reveal', data: { turn: 1, card: 24 } },
        { t: 118_000, by: null, type: 'end' },
      ]),
    ) as ShownReplay;
    // The clue came in the last seconds of its time, as the game counted it.
    expect(replay.history[0]).toMatchObject({ word: 'Late', at: 117_500, lastSeconds: true });
  });

  test('is none for a game that did not finish', () => {
    expect(shown(log([{ t: 5, by: null, type: 'end', data: { ending: 'withdrawn' } }]))).toBeNull();
    expect(shown(log([{ t: 5, by: null, type: 'end', data: { ending: 'abandoned', why: 'empty' } }]))).toBeNull();
    expect(shown(log([]))).toBeNull();
  });
});

// Random games in a room, with players who come, sit, change seats, are benched or removed, leave
// and come back, guests who log in, time that runs out and a chair who pauses: the replay worked
// out from each game's log is the game as it was played, with the groups as it ended.

const letters = (n: number): string =>
  (n < 26 ? '' : letters(Math.floor(n / 26) - 1)) + String.fromCharCode(97 + (n % 26));

function play(seed: number) {
  const rng = seededRng(seed);
  const clock = { now: 0 };
  const rooms = new Rooms(testWords(), seededRng(seed + 1000), () => clock.now);
  const account = (id: number) => ({
    username: `User${id}`,
    account: { id, handle: `handle${id}`, avatar: null, rank: 'undergraduate' as const, agents: false },
  });
  const created = rooms.create({
    game: keywordsGame,
    language: 'en',
    fields: ['general'],
    key: 'k0',
    play: true,
    as: account(1),
  });
  if (!created.ok) throw new Error(created.error);
  const room: Room = created.room;
  let socket = 0;
  let logins = 0;
  const attach = (id: string) => {
    const member = room.members.get(id);
    if (member) room.attach(member, `s${(socket += 1)}`);
  };
  attach(created.member.id);
  const timed = rng.int(3) > 0;
  const changed = room.setSettings({
    settings: {
      ...defaultSettings('en'),
      guessRule: pick(['standard', 'free'], rng),
      firstClueTime: timed ? 60 : 0,
      clueTime: timed ? 40 : 0,
      guessTime: timed ? 30 : 0,
      extensions: rng.int(2) === 0,
    },
  });
  if (!changed.ok) throw new Error(changed.error);
  // Who is who, by member key: half the newcomers have accounts.
  const keys = ['k0'];
  const join = (key: string, playing: boolean) => {
    const id = Number(key.slice(1));
    const joined = room.join(key, playing, id % 2 === 0 ? null : account(id + 1));
    if (joined.ok) attach(joined.member.id);
  };
  for (let n = 1; n <= 5; n += 1) {
    keys.push(`k${n}`);
    join(`k${n}`, false);
  }
  const ids = () => [...room.members.keys()];
  const seat = (id: string, team: string | null, role: string) => room.act(id, 'keywords:seat', { team, role });
  const [ann, bob, cat, dan, ...rest] = ids() as [string, string, string, string, ...string[]];
  seat(ann, 'red', 'captain');
  seat(bob, 'red', 'guesser');
  seat(cat, 'blue', 'captain');
  seat(dan, 'blue', 'guesser');
  for (const id of rest) seat(id, pick(TEAMS, rng), 'guesser');
  const started = room.start(room.round);
  if (!started.ok) throw new Error(started.error);

  const data = () => room.data as KeywordsData;
  const gameId = room.gameId as string;
  for (let step = 0; step < 1000 && room.phase === 'playing'; step += 1) {
    const game = data().game;
    if (!game) break;
    const everyone = ids();
    const anyone = () => pick(everyone, rng);
    const inSeat = (role: string) =>
      everyone.filter((id) => {
        const where = seatOf(data().seating, id);
        return where.team === game.team && where.role === role;
      });
    const moment = { gameId, turn: rng.int(12) === 0 ? game.turn - 1 : game.turn };
    const roll = rng.int(100);
    if (roll < 25) {
      // A group without a PI finds one, and goes on.
      const pi = inSeat('captain')[0];
      if (pi === undefined) {
        seat(anyone(), game.team, 'captain');
        continue;
      }
      const own = game.cards.flatMap((card, index) => (card.color === game.team && !card.revealed ? [index] : []));
      room.act(pi, 'keywords:clue', {
        ...moment,
        word: `Zq${letters(step)}`,
        count: pick([0, 1, 2, 3, 'unlimited'], rng),
        ...(rng.int(2) === 0 ? { targets: own.slice(0, rng.int(3)) } : {}),
      });
    } else if (roll < 55) {
      if (inSeat('guesser').length === 0) seat(anyone(), game.team, 'guesser');
      const student = pick([...inSeat('guesser'), anyone()], rng);
      room.act(student, 'keywords:reveal', { ...moment, card: rng.int(26) });
    } else if (roll < 60) {
      room.act(pick(inSeat('guesser').concat(anyone()), rng), 'keywords:pass', moment);
    } else if (roll < 70) {
      clock.now += rng.int(70_000);
      room.expire();
    } else if (roll < 75) {
      seat(anyone(), pick([...TEAMS, null], rng), pick(['captain', 'guesser', 'spectator'], rng));
    } else if (roll < 77) {
      room.bench(anyone());
    } else if (roll < 79) {
      const id = anyone();
      if (id !== room.chairId) room.remove(id);
    } else if (roll < 82) {
      const id = anyone();
      if (everyone.length > 2) room.drop(id);
    } else if (roll < 84) {
      // Someone new, or someone coming back with the key they had.
      const key = rng.int(2) === 0 ? `k${keys.length}` : pick(keys, rng);
      if (!keys.includes(key)) keys.push(key);
      if (!room.memberByKey(key)) join(key, rng.int(2) === 0);
    } else if (roll < 86) {
      // A guest logs in.
      const guests = everyone.filter((id) => room.members.get(id)?.guest !== null);
      if (guests.length > 0) {
        logins += 1;
        const id = 100 + logins;
        room.adopt(pick(guests, rng), `a${id}`, `User${id}`, account(id).account);
      }
    } else if (roll < 90) {
      room.act(room.chairId ?? anyone(), pick(['keywords:pause', 'keywords:resume'], rng), { gameId });
    } else if (roll < 92) {
      room.act(anyone(), 'keywords:extend', moment);
    } else if (roll < 96) {
      room.act(anyone(), 'keywords:say', { gameId, text: `Line ${step}` });
    } else {
      room.act(anyone(), 'keywords:select', { ...moment, card: rng.int(25) });
    }
  }
  // What the groups say after the end goes into the log after it.
  if (room.phase === 'ended') {
    for (const id of ids()) room.act(id, 'keywords:say', { gameId, text: 'Well played' });
  }
  return { room, data: data(), rng };
}

describe('the replay of a random game', () => {
  test('is the game as it was played, for every game that finished, and none for the others', () => {
    let finished = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const { room, data } = play(seed);
      if (room.phase === 'playing') room.withdraw(room.gameId as string);
      const record = room.record();
      if (!record?.log) throw new Error(`game ${seed} kept no log`);
      // Everyone the room knows, by player ID, as the record shows them, with their accounts as
      // the record links them.
      const accounts = new Map(record.accounts.map(({ playerId, accountId }) => [playerId, accountId]));
      const replay = shownReplay({
        setup: record.setup,
        log: record.log,
        accounts: new Map(
          [...accounts].map(([id, number]) => [
            id,
            { username: `User${number}`, avatar: null, handle: `handle${number}` },
          ]),
        ),
        viewer: new Set(),
      });
      const game = data.game;
      if (record.ending !== 'finished' || !game) {
        expect(replay, `game ${seed}`).toBeNull();
        continue;
      }
      finished += 1;
      if (!replay) throw new Error(`game ${seed} has no replay`);
      expect(replay.history, `game ${seed}`).toEqual(game.history);
      expect(replay.result, `game ${seed}`).toEqual(game.result);
      expect(replay.cards).toEqual(game.cards.map(({ word, color }) => ({ word, color })));
      // The groups as the game ended, in the order of the room.
      const members = [...room.members.keys()];
      const groups = TEAMS.map((team): ReplayGroup => {
        const inSeat = (role: string) =>
          members.filter((id) => {
            const where = seatOf(data.seating, id);
            return where.team === team && where.role === role;
          });
        return { team, captain: inSeat('captain')[0] ?? null, guessers: inSeat('guesser') };
      });
      expect(replay.groups, `game ${seed}`).toEqual(groups);
      // Everyone in the groups and the record is someone: an account, or a guest by their number
      // in the room.
      const shownIds = new Set([
        ...groups.flatMap(({ captain, guessers }) => [...(captain ? [captain] : []), ...guessers]),
        ...game.history.flatMap((record) => [
          ...(record.captain ? [record.captain] : []),
          ...record.guesses.map(({ player }) => player),
        ]),
      ]);
      for (const id of shownIds) {
        const member = room.members.get(id);
        const person = replay.people[id];
        if (accounts.has(id)) expect(person?.name).toBe(`User${accounts.get(id)}`);
        else if (member) expect(person, `game ${seed}, ${id}`).toEqual({ guest: member.guest });
        else expect(person?.guest, `game ${seed}, ${id}`).toBeGreaterThan(0);
      }
    }
    // Enough of the games finished for this to say something.
    expect(finished).toBeGreaterThan(40);
  });
});

// A guest who leaves during the game and comes back with the same browser has their number again,
// and keeps it for what they did before leaving once they log in: the record of the game numbers
// both IDs they had as a guest, and the account they have since is theirs from then on.
describe('the replay of a game in which a guest logged in', () => {
  test('shows what they did as a guest by their number, and what they did since as the account', () => {
    const clock = { now: 0 };
    const rooms = new Rooms(testWords(), seededRng(7), () => clock.now);
    const account = (id: number) => ({
      username: `User${id}`,
      account: { id, handle: `handle${id}`, avatar: null, rank: 'undergraduate' as const, agents: false },
    });
    const created = rooms.create({
      game: keywordsGame,
      language: 'en',
      fields: ['general'],
      key: 'k1',
      play: true,
      as: account(1),
    });
    if (!created.ok) throw new Error(created.error);
    const room: Room = created.room;
    room.attach(created.member, 's1');
    const changed = room.setSettings({
      settings: { ...defaultSettings('en'), firstClueTime: 0, clueTime: 0, guessTime: 0 },
    });
    if (!changed.ok) throw new Error(changed.error);
    const join = (key: string, as: ReturnType<typeof account> | null = null) => {
      const joined = room.join(key, true, as);
      if (!joined.ok) throw new Error(joined.error);
      room.attach(joined.member, `s-${joined.member.id}`);
      return joined.member.id;
    };
    const ann = created.member.id;
    const bob = join('k2', account(2));
    const cat = join('k3', account(3));
    const guest = join('kg');
    const seat = (id: string, team: Team, role: 'captain' | 'guesser') => room.act(id, 'keywords:seat', { team, role });
    seat(ann, 'red', 'captain');
    seat(guest, 'red', 'guesser');
    seat(bob, 'blue', 'captain');
    seat(cat, 'blue', 'guesser');
    expect(room.start(room.round)).toMatchObject({ ok: true });
    const game = () => (room.data as KeywordsData).game as NonNullable<KeywordsData['game']>;
    const gameId = room.gameId as string;
    const moment = () => ({ gameId, turn: game().turn });
    const own = (team: Team) => game().cards.findIndex((card) => card.color === team && !card.revealed);
    // Blue plays its turn first when the deal gave it the first turn.
    if (game().team === 'blue') {
      expect(room.act(bob, 'keywords:clue', { ...moment(), word: 'Zqa', count: 1 })).toMatchObject({ ok: true });
      expect(room.act(cat, 'keywords:reveal', { ...moment(), card: own('blue') })).toMatchObject({ ok: true });
      expect(room.act(cat, 'keywords:pass', moment())).toMatchObject({ ok: true });
    }
    expect(room.act(ann, 'keywords:clue', { ...moment(), word: 'Zqb', count: 2 })).toMatchObject({ ok: true });
    expect(room.act(guest, 'keywords:reveal', { ...moment(), card: own('red') })).toMatchObject({ ok: true });
    // The guest leaves, comes back with the same browser, which gives them their number again, logs
    // in, and reveals Reviewer 2, which ends the game.
    room.drop(guest);
    const back = join('kg');
    expect(room.members.get(back)?.guest).toBe(1);
    seat(back, 'red', 'guesser');
    expect(room.adopt(back, 'k9', 'User9', account(9).account)).toBe(true);
    const reviewer2 = game().cards.findIndex((card) => card.color === 'reviewer2');
    expect(room.act(back, 'keywords:reveal', { ...moment(), card: reviewer2 })).toMatchObject({ ok: true });
    expect(room.phase).toBe('ended');

    const record = room.record();
    if (!record?.log) throw new Error('no record');
    expect(record.log.guests).toEqual({ [guest]: 1 });
    expect(record.accounts).toContainEqual({ playerId: back, accountId: 9 });
    expect(record.counts).toEqual({ accounts: 4, guests: 0, agents: 0 });
    const replay = shownReplay({
      setup: record.setup,
      log: record.log,
      accounts: new Map(
        record.accounts.map(({ playerId, accountId }) => [
          playerId,
          { username: `User${accountId}`, avatar: null, handle: `handle${accountId}` },
        ]),
      ),
      viewer: new Set(),
    });
    expect(replay?.groups).toEqual([
      { team: 'red', captain: ann, guessers: [back] },
      { team: 'blue', captain: bob, guessers: [cat] },
    ]);
    expect(replay?.people[guest]).toEqual({ guest: 1 });
    expect(replay?.people[back]).toMatchObject({ name: 'User9' });
  });
});

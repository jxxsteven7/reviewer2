import { SPECTATOR, type MatchRules, type RoomPhase, type Seat, type Team } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import type { GameContext } from '../../core/game';
import { seededRng, type Rng } from '../../core/random';
import { keywordsGame, type KeywordsData } from './index';
import { arrangeFixed, lineupOf, newMatchSeating, scoreGame, type MatchSeating } from './match';
import { captainOf, seatOf, type Seating } from './seats';
import type { KeywordsState } from './state';
import { gameState } from './testing';

// The game's part of a match: how each player scores, and how the groups are made from one game to
// the next (docs/games/keywords.md#matches).

const keyOf = (id: string) => `key-${id}`;
const red: Seat = { team: 'red', role: 'guesser' };
const blue: Seat = { team: 'blue', role: 'guesser' };
const redPI: Seat = { team: 'red', role: 'captain' };
const bluePI: Seat = { team: 'blue', role: 'captain' };

function context(ids: string[], options: { offline?: string[]; phase?: RoomPhase; rng?: Rng } = {}): GameContext {
  const { offline = [], phase = 'lobby', rng = seededRng(1) } = options;
  return {
    phase,
    language: 'en',
    rng,
    now: () => 0,
    keyOf,
    isOnline: (id) => !offline.includes(id),
    playerIds: () => ids,
  };
}

const sides = (teams: Record<string, Team>) => new Map(Object.entries(teams).map(([id, team]) => [keyOf(id), team]));

// A game in which red revealed two of its cards and one of blue's, blue one of its own and an
// irrelevant paper, and then red revealed Reviewer 2, so blue won.
function played(): KeywordsState {
  const guess = (card: number, color: KeywordsState['cards'][number]['color'], player: string) => ({
    card,
    color,
    player,
  });
  return gameState({
    phase: 'over',
    result: { winner: 'blue', reason: 'reviewer2' },
    history: [
      {
        turn: 1,
        team: 'red',
        word: 'One',
        count: 3,
        guesses: [guess(0, 'red', 'ron'), guess(1, 'red', 'ron'), guess(9, 'blue', 'ron')],
      },
      {
        turn: 2,
        team: 'blue',
        word: 'Two',
        count: 2,
        guesses: [guess(10, 'blue', 'bea'), guess(17, 'neutral', 'bea')],
      },
      { turn: 3, team: 'red', word: 'Three', count: 1, guesses: [guess(24, 'reviewer2', 'rae')] },
    ],
  });
}

const PLAYERS = { rex: 'red', ron: 'red', rae: 'red', bo: 'blue', bea: 'blue' } as const;

const pointsOf = (scores: ReturnType<typeof scoreGame>) =>
  Object.fromEntries((scores ?? []).map(({ key, points }) => [key.replace('key-', ''), points]));

describe('the score of a game', () => {
  test('gives a group a point for each of its own cards it found, and 3 for winning', () => {
    // Red found 2 cards, blue 1: the blue card that red revealed doesn't count for blue.
    expect(pointsOf(scoreGame(played(), sides(PLAYERS), keyOf))).toEqual({
      rex: 2,
      ron: 2 - 1,
      rae: 2 - 3,
      bo: 1 + 3,
      bea: 1 + 3,
    });
  });

  test('says where the points came from', () => {
    const scores = scoreGame(played(), sides(PLAYERS), keyOf) ?? [];
    expect(scores.find(({ key }) => key === 'key-ron')?.detail).toEqual({
      found: 2,
      won: false,
      wrong: 1,
      reviewer2: 0,
    });
    expect(scores.find(({ key }) => key === 'key-rae')?.detail).toEqual({
      found: 2,
      won: false,
      wrong: 0,
      reviewer2: 1,
    });
    expect(scores.find(({ key }) => key === 'key-bo')?.detail).toEqual({ found: 1, won: true, wrong: 0, reviewer2: 0 });
  });

  test('of a game in progress has no winner yet', () => {
    const game = { ...played(), phase: 'guess' as const, result: null };
    expect(pointsOf(scoreGame(game, sides(PLAYERS), keyOf))).toMatchObject({ bo: 1, bea: 1, rae: -1 });
  });

  test('of a game that the chair withdrew is none', () => {
    const game = { ...played(), result: { winner: null, reason: 'withdrawn' as const } };
    expect(scoreGame(game, sides(PLAYERS), keyOf)).toBeNull();
  });

  test('counts what a player revealed under the key they had, also after they left', () => {
    // ron has left the room; the room still knows his key.
    const gone = (id: string) => (id === 'ron' ? 'key-ron' : keyOf(id));
    expect(pointsOf(scoreGame(played(), sides(PLAYERS), gone)).ron).toBe(1);
  });
});

describe('the lineup of the waiting room', () => {
  const rules = (teams: MatchRules['teams'], grouping: MatchRules['grouping']): MatchSeating =>
    newMatchSeating({ games: 3, teams, grouping });

  test('is free outside a match, and when the players choose', () => {
    expect(lineupOf(null)).toBe('free');
    expect(lineupOf(rules('fixed', 'choose'))).toBe('free');
    expect(lineupOf(rules('switch', 'choose'))).toBe('free');
  });

  test('is drawn for every game when groups change at random, and for the first when they are fixed', () => {
    expect(lineupOf(rules('switch', 'random'))).toBe('draw');
    expect(lineupOf(rules('fixed', 'random'))).toBe('draw');
    const locked = { ...rules('fixed', 'random'), locked: new Map([['key-ann', 'red' as Team]]) };
    expect(lineupOf(locked)).toBe('fixed');
    expect(lineupOf({ ...rules('fixed', 'choose'), locked: locked.locked })).toBe('fixed');
    expect(lineupOf({ ...rules('switch', 'random'), locked: locked.locked })).toBe('draw');
  });
});

describe('the PI of a fixed group', () => {
  const seating = (seats: Record<string, Seat>): Seating => ({
    seats: new Map(Object.entries(seats)),
    keyViewers: new Set(),
    sides: new Map(),
  });
  const members = (ids: string[]) => ids.map((id) => ({ id, key: keyOf(id) }));
  const match = (captained: Record<string, number>, locked: Record<string, Team>): MatchSeating => ({
    ...newMatchSeating({ games: 3, teams: 'fixed', grouping: 'choose' }),
    captained: new Map(Object.entries(captained).map(([id, times]) => [keyOf(id), times])),
    locked: sides(locked),
  });

  test('is whoever has been one the fewest times, online first', () => {
    const before = seating({ ann: redPI, bob: red, cat: red, dee: bluePI, eve: blue });
    const after = arrangeFixed(
      before,
      members(['ann', 'bob', 'cat', 'dee', 'eve']),
      match({ ann: 1, dee: 1 }, { ann: 'red', bob: 'red', cat: 'red', dee: 'blue', eve: 'blue' }),
      new Set(['ann', 'bob', 'dee', 'eve']),
      seededRng(4),
    );
    // cat hasn't been a PI either, but is offline.
    expect(captainOf(after, 'red')).toBe('bob');
    expect(captainOf(after, 'blue')).toBe('eve');
    expect(seatOf(after, 'ann')).toEqual(red);
    expect(seatOf(after, 'cat')).toEqual(red);
  });

  test('goes to one of those who have been one as often, at random', () => {
    const chosen = new Set<string | null>();
    for (let seed = 0; seed < 20; seed += 1) {
      const after = arrangeFixed(
        seating({ ann: redPI, bob: red, cat: red, dee: bluePI, eve: blue }),
        members(['ann', 'bob', 'cat', 'dee', 'eve']),
        match({ ann: 1 }, { ann: 'red', bob: 'red', cat: 'red', dee: 'blue', eve: 'blue' }),
        new Set(['ann', 'bob', 'cat', 'dee', 'eve']),
        seededRng(seed),
      );
      chosen.add(captainOf(after, 'red'));
    }
    expect(chosen).toEqual(new Set(['bob', 'cat']));
  });

  test('puts everyone in their own group, newcomers in the smaller one, and leaves spectators be', () => {
    const before = seating({ ann: blue, bob: red, cat: red, dee: red, new: red, eve: SPECTATOR });
    const after = arrangeFixed(
      before,
      members(['ann', 'bob', 'cat', 'dee', 'new', 'eve']),
      match({}, { ann: 'red', bob: 'red', cat: 'blue', dee: 'blue', eve: 'red' }),
      new Set(['ann', 'bob', 'cat', 'dee', 'new', 'eve']),
      seededRng(1),
    );
    expect(seatOf(after, 'ann').team).toBe('red');
    expect(seatOf(after, 'cat').team).toBe('blue');
    // Two in each group, and the newcomer anywhere.
    expect(['red', 'blue']).toContain(seatOf(after, 'new').team);
    expect(seatOf(after, 'eve')).toEqual(SPECTATOR);
  });
});

// The module itself, as the room drives it.
describe('a match of the game', () => {
  const WORDS = Array.from({ length: 25 }, (_, i) => `Word${i}`);
  const ids = ['ann', 'bob', 'cat', 'dee', 'eve'];

  function withMatch(rules: Omit<MatchRules, 'games'>, seats: Record<string, Seat> = {}): KeywordsData {
    const data = keywordsGame.match?.setup(keywordsGame.create('en'), context(ids), { games: 3, ...rules });
    if (!data) throw new Error('no match');
    return { ...data, seating: { ...data.seating, seats: new Map(Object.entries(seats)) } };
  }

  const start = (data: KeywordsData, ctx = context(ids)) => keywordsGame.start(data, ctx, WORDS, 'game-1');
  const end = (data: KeywordsData, winner: Team | null): KeywordsData => ({
    ...data,
    game: data.game && {
      ...data.game,
      phase: 'over',
      result: winner ? { winner, reason: 'found' } : { winner: null, reason: 'withdrawn' },
    },
  });
  const seat = (data: KeywordsData, id: string, wanted: Seat, phase: RoomPhase = 'lobby') =>
    keywordsGame.handle(data, context(ids, { phase }), id, 'keywords:seat', wanted);
  const teams = (data: KeywordsData) =>
    Object.fromEntries(ids.map((id) => [id, seatOf(data.seating, id).team]).filter(([, team]) => team !== null));

  const chosen = { ann: redPI, bob: red, cat: bluePI, dee: blue };

  test('with fixed groups keeps them from the first scored game on, and passes the PI on', () => {
    const first = start(withMatch({ teams: 'fixed', grouping: 'choose' }, chosen));
    const next = keywordsGame.again(end(first, 'red'), context(ids));
    expect(teams(next)).toEqual({ ann: 'red', bob: 'red', cat: 'blue', dee: 'blue' });
    expect(captainOf(next.seating, 'red')).toBe('bob');
    expect(captainOf(next.seating, 'blue')).toBe('dee');
    const view = keywordsGame.views(next, context(ids))({ playerId: 'ann' });
    expect(view).toMatchObject({ lineup: 'fixed', side: 'red' });
    // Nobody can move to the other group, nor shuffle them.
    expect(seat(next, 'ann', blue)).toEqual({ ok: false, error: 'other_team' });
    expect(seat(next, 'ann', SPECTATOR).ok).toBe(true);
    expect(keywordsGame.shuffle(next, context(ids))).toBe(next);
  });

  test('with fixed groups lets the players choose again after a first game that was withdrawn', () => {
    const first = start(withMatch({ teams: 'fixed', grouping: 'choose' }, chosen));
    const next = keywordsGame.again(end(first, null), context(ids));
    expect(next.seating.seats).toEqual(first.seating.seats);
    expect(keywordsGame.views(next, context(ids))({ playerId: 'ann' })).toMatchObject({ lineup: 'free', side: null });
    expect(seat(next, 'ann', bluePI)).toEqual({ ok: false, error: 'seat_taken' });
    expect(seat(next, 'ann', blue).ok).toBe(true);
  });

  test('with groups drawn at random needs four players online, and draws them when it starts', () => {
    let data = withMatch({ teams: 'switch', grouping: 'random' }, { ann: red, bob: red, cat: red, dee: red });
    expect(keywordsGame.canStart(data, context(ids, { offline: ['dee'] }))).toBe(false);
    expect(keywordsGame.views(data, context(ids, { offline: ['dee'] }))({ playerId: 'ann' }).startProblems).toEqual([
      { problem: 'needs_players', missing: 1 },
    ]);
    expect(keywordsGame.canStart(data, context(ids))).toBe(true);
    expect(keywordsGame.shuffle(data, context(ids))).toBe(data);
    data = start(data);
    const seats = [...data.seating.seats.values()];
    expect(seats.filter(({ role }) => role === 'captain').map(({ team }) => team)).toEqual(
      expect.arrayContaining(['red', 'blue']),
    );
    expect(seats.filter(({ team }) => team === 'red')).toHaveLength(2);
  });

  test('lets a newcomer watch the game that is on, and seats them for the next one', () => {
    let data = start(withMatch({ teams: 'fixed', grouping: 'choose' }, chosen));
    const ctx = context(ids, { phase: 'playing' });
    data = keywordsGame.join(data, ctx, 'eve', true);
    expect(seatOf(data.seating, 'eve')).toEqual(SPECTATOR);
    expect(keywordsGame.views(data, ctx)({ playerId: 'eve' })).toMatchObject({ joinsNext: true });
    expect(seat(data, 'eve', red, 'playing')).toEqual({ ok: false, error: 'between_games' });
    data = keywordsGame.again(end(data, 'blue'), context(ids));
    expect(seatOf(data.seating, 'eve').team).not.toBeNull();
    expect(keywordsGame.views(data, context(ids))({ playerId: 'eve' })).toMatchObject({ joinsNext: false });
  });

  test('lets a newcomer who changes their mind watch the next game too', () => {
    let data = start(withMatch({ teams: 'switch', grouping: 'choose' }, chosen));
    data = keywordsGame.join(data, context(ids, { phase: 'playing' }), 'eve', true);
    const watching = seat(data, 'eve', SPECTATOR, 'playing');
    if (!watching.ok) throw new Error(watching.error);
    data = keywordsGame.again(end(watching.data, 'blue'), context(ids));
    expect(seatOf(data.seating, 'eve')).toEqual(SPECTATOR);
  });

  test('lets whoever played for a group in the game come back to it while it is on', () => {
    let data = start(withMatch({ teams: 'switch', grouping: 'choose' }, chosen));
    const out = seat(data, 'bob', SPECTATOR, 'playing');
    if (!out.ok) throw new Error(out.error);
    data = out.data;
    expect(seat(data, 'bob', red, 'playing').ok).toBe(true);
  });

  test('with groups that may change keeps nobody in a group after a game', () => {
    const first = start(withMatch({ teams: 'switch', grouping: 'choose' }, chosen));
    const next = keywordsGame.again(end(first, 'red'), context(ids));
    expect(next.seating.seats).toEqual(first.seating.seats);
    expect(seat(next, 'ann', blue).ok).toBe(true);
  });

  test("remembers a guest's group and PI turns under their account", () => {
    const first = start(withMatch({ teams: 'fixed', grouping: 'choose' }, chosen));
    const next = keywordsGame.again(end(first, 'red'), context(ids));
    const moved = keywordsGame.rekey?.(next, 'key-bob', 'key-account');
    expect(moved?.match?.locked.get('key-account')).toBe('red');
    expect(moved?.match?.locked.has('key-bob')).toBe(false);
  });

  test('ends with the room going back to an ordinary one', () => {
    const data = withMatch({ teams: 'fixed', grouping: 'random' });
    const ordinary = keywordsGame.match?.setup(data, context(ids), null);
    expect(ordinary?.match).toBeNull();
    expect(keywordsGame.match?.lineup(start({ ...data, seating: { ...data.seating, seats: new Map() } }))).toEqual([]);
  });
});

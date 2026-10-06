import { SPECTATOR, type Seat } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import { seededRng } from '../../core/random';
import {
  captainOf,
  changeSeat,
  emptySeating,
  removeSeat,
  seatOf,
  shuffleGroups,
  startGame,
  startProblems,
  type Seating,
} from './seats';

const member = (id: string) => ({ id, key: `key-${id}` });
const redCaptain: Seat = { team: 'red', role: 'captain' };
const blueCaptain: Seat = { team: 'blue', role: 'captain' };
const redGuesser: Seat = { team: 'red', role: 'guesser' };
const blueGuesser: Seat = { team: 'blue', role: 'guesser' };

function seated(seats: Record<string, Seat>, keyViewers: string[] = []): Seating {
  return { seats: new Map(Object.entries(seats)), keyViewers: new Set(keyViewers) };
}

function moved(seating: Seating, id: string, seat: Seat, playing = false): Seating {
  const change = changeSeat(seating, member(id), seat, playing);
  if (!change.ok) throw new Error(change.error);
  return change.seating;
}

const refusal = (seating: Seating, id: string, seat: Seat, playing = false) => {
  const change = changeSeat(seating, member(id), seat, playing);
  return change.ok ? null : change.error;
};

describe('seats in the waiting room', () => {
  test('everyone starts as a spectator', () => {
    expect(seatOf(emptySeating(), 'ann')).toEqual(SPECTATOR);
  });

  test('each team has one captain seat', () => {
    const seating = moved(emptySeating(), 'ann', redCaptain);
    expect(captainOf(seating, 'red')).toBe('ann');
    expect(refusal(seating, 'bob', redCaptain)).toBe('seat_taken');
    expect(refusal(seating, 'ann', redCaptain)).toBeNull();
    expect(captainOf(moved(seating, 'ann', blueCaptain), 'red')).toBeNull();
  });

  test('refuses seats that make no sense', () => {
    expect(refusal(emptySeating(), 'ann', { team: 'green', role: 'guesser' } as unknown as Seat)).toBe('bad_seat');
    expect(refusal(emptySeating(), 'ann', { team: 'red', role: 'spectator' } as unknown as Seat)).toBe('bad_seat');
  });

  test('changes nothing in the waiting room for key viewers', () => {
    const seating = moved(seated({ ann: redCaptain }, ['key-ann']), 'ann', redGuesser);
    expect(seatOf(seating, 'ann')).toEqual(redGuesser);
  });
});

describe('seats during a game', () => {
  test('a captain who takes over sees the key, and so cannot be a guesser again', () => {
    let seating = seated({ ann: redGuesser });
    seating = moved(seating, 'ann', redCaptain, true);
    expect(seating.keyViewers.has('key-ann')).toBe(true);
    expect(refusal(seating, 'ann', redGuesser, true)).toBe('key_viewer');
    expect(refusal(seating, 'ann', blueGuesser, true)).toBe('key_viewer');
    expect(refusal(seating, 'ann', SPECTATOR, true)).toBeNull();
  });

  test('guessers and spectators may swap freely', () => {
    let seating = seated({ ann: redGuesser, bob: SPECTATOR });
    seating = moved(seating, 'ann', blueGuesser, true);
    seating = moved(seating, 'bob', redGuesser, true);
    expect(seatOf(seating, 'ann')).toEqual(blueGuesser);
    expect(seatOf(seating, 'bob')).toEqual(redGuesser);
  });

  test('a key viewer who leaves and comes back with a new ID is still one', () => {
    let seating = startGame(seated({ ann: redCaptain }), (id) => `key-${id}`);
    seating = removeSeat(seating, 'ann');
    const returning = { id: 'ann-again', key: 'key-ann' };
    const change = changeSeat(seating, returning, redGuesser, true);
    expect(change).toEqual({ ok: false, error: 'key_viewer' });
  });
});

describe('starting a game', () => {
  const ready = seated({ ann: redCaptain, bob: redGuesser, cat: blueCaptain, dan: blueGuesser });
  const everyone = new Set(['ann', 'bob', 'cat', 'dan']);

  test('needs a captain and a guesser in each team, all online', () => {
    expect(startProblems(ready, everyone)).toEqual([]);
    expect(startProblems(emptySeating(), new Set())).toEqual([
      { problem: 'needs_captain', team: 'red' },
      { problem: 'needs_guesser', team: 'red' },
      { problem: 'needs_captain', team: 'blue' },
      { problem: 'needs_guesser', team: 'blue' },
    ]);
    expect(startProblems(ready, new Set(['bob', 'cat', 'dan']))).toEqual([{ problem: 'captain_offline', team: 'red' }]);
    expect(startProblems(ready, new Set(['ann', 'cat', 'dan']))).toEqual([{ problem: 'needs_guesser', team: 'red' }]);
  });

  test('makes exactly the two captains the key viewers', () => {
    const seating = startGame({ ...ready, keyViewers: new Set(['key-old']) }, (id) => `key-${id}`);
    expect(seating.keyViewers).toEqual(new Set(['key-ann', 'key-cat']));
  });
});

describe('shuffling the groups', () => {
  test('deals the seated players into two even groups with a captain each, and leaves spectators', () => {
    const seating = seated({
      ann: redCaptain,
      bob: redGuesser,
      cat: redGuesser,
      dan: blueGuesser,
      eve: blueGuesser,
      fay: SPECTATOR,
    });
    const shuffled = shuffleGroups(seating, seededRng(5));
    expect(seatOf(shuffled, 'fay')).toEqual(SPECTATOR);
    const teams = ['red', 'blue'].map((team) => [...shuffled.seats.values()].filter((seat) => seat.team === team));
    expect(teams.map((members) => members.length).sort()).toEqual([2, 3]);
    for (const members of teams) expect(members.filter((seat) => seat.role === 'captain')).toHaveLength(1);
  });

  test('is repeatable with the same seed and varies with others', () => {
    const seating = seated({ a: redGuesser, b: redGuesser, c: blueGuesser, d: blueGuesser });
    expect(shuffleGroups(seating, seededRng(1))).toEqual(shuffleGroups(seating, seededRng(1)));
    const outcomes = new Set(
      Array.from({ length: 20 }, (_, seed) => JSON.stringify([...shuffleGroups(seating, seededRng(seed)).seats])),
    );
    expect(outcomes.size).toBeGreaterThan(3);
  });
});

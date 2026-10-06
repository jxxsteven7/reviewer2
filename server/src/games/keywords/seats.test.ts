import { SPECTATOR, type Seat } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import { seededRng } from '../../core/random';
import {
  captainOf,
  changeSeat,
  emptySeating,
  endGame,
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
  return { seats: new Map(Object.entries(seats)), keyViewers: new Set(keyViewers), sides: new Map() };
}

// The same seats once a game has started.
const started = (seats: Record<string, Seat>) => startGame(seated(seats), (id) => `key-${id}`);

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
    for (const seat of [
      { team: 'green', role: 'guesser' },
      { team: 'red', role: 'spectator' },
      { team: null, role: 'guesser' },
      { team: 'red', role: 'chair' },
      { team: 'red' },
      { role: 'captain' },
      null,
      'red',
    ]) {
      expect(refusal(emptySeating(), 'ann', seat as unknown as Seat), JSON.stringify(seat)).toBe('bad_seat');
    }
  });

  test('keeps a seat of its own, not the one it was given', () => {
    const given = { team: 'red', role: 'guesser', extra: 'kept?' } as unknown as Seat;
    const seat = seatOf(moved(emptySeating(), 'ann', given), 'ann');
    expect(seat).toEqual(redGuesser);
    expect(seat).not.toBe(given);
    expect(Object.isFrozen(SPECTATOR)).toBe(true);
    expect(seatOf(moved(emptySeating(), 'ann', { team: null, role: 'spectator' }), 'ann')).toBe(SPECTATOR);
  });

  test('is free for key viewers and for players of either group', () => {
    const before = startGame(seated({ ann: redCaptain, bob: redGuesser }), (id) => `key-${id}`);
    let seating = moved(before, 'ann', redGuesser);
    seating = moved(seating, 'bob', blueCaptain);
    expect(seatOf(seating, 'ann')).toEqual(redGuesser);
    expect(seatOf(seating, 'bob')).toEqual(blueCaptain);
    // Only a game adds key viewers and sides.
    expect(seating.keyViewers).toEqual(before.keyViewers);
    expect(seating.sides).toEqual(before.sides);
  });
});

describe('seats during a game', () => {
  test('a captain who takes over sees the key, and so cannot be a guesser again', () => {
    let seating = started({ ann: redGuesser });
    seating = moved(seating, 'ann', redCaptain, true);
    expect(seating.keyViewers.has('key-ann')).toBe(true);
    expect(refusal(seating, 'ann', redGuesser, true)).toBe('key_viewer');
    expect(refusal(seating, 'ann', SPECTATOR, true)).toBeNull();
  });

  test('spectators may join either group, and whoever plays may step out and come back', () => {
    let seating = started({ ann: redGuesser, bob: SPECTATOR, cat: SPECTATOR });
    seating = moved(seating, 'bob', redGuesser, true);
    seating = moved(seating, 'cat', blueGuesser, true);
    seating = moved(seating, 'ann', SPECTATOR, true);
    seating = moved(seating, 'ann', redGuesser, true);
    expect(seatOf(seating, 'ann')).toEqual(redGuesser);
    expect(seatOf(seating, 'bob')).toEqual(redGuesser);
    expect(seatOf(seating, 'cat')).toEqual(blueGuesser);
  });

  test('nobody changes groups: a seat in the other group is refused until the next game', () => {
    let seating = started({ ann: redGuesser, bob: SPECTATOR });
    expect(refusal(seating, 'ann', blueGuesser, true)).toBe('other_team');
    expect(refusal(seating, 'ann', blueCaptain, true)).toBe('other_team');
    // Stepping out to watch doesn't free a player from their group.
    seating = moved(seating, 'ann', SPECTATOR, true);
    expect(refusal(seating, 'ann', blueGuesser, true)).toBe('other_team');
    // A latecomer belongs to the group they join first.
    seating = moved(seating, 'bob', blueGuesser, true);
    expect(refusal(seating, 'bob', redGuesser, true)).toBe('other_team');
    expect(refusal(seating, 'bob', redCaptain, true)).toBe('other_team');
    expect(refusal(seating, 'bob', blueCaptain, true)).toBeNull();

    const next = endGame(seating);
    expect(seatOf(next, 'bob')).toEqual(blueGuesser);
    expect(
      refusal(
        startGame(next, (id) => `key-${id}`),
        'ann',
        blueGuesser,
        true,
      ),
    ).toBeNull();
  });

  test('whoever leaves and comes back with a new ID keeps their group and what they have seen', () => {
    let seating = started({ ann: redCaptain, bob: blueGuesser });
    seating = removeSeat(removeSeat(seating, 'ann'), 'bob');
    expect(changeSeat(seating, { id: 'ann-again', key: 'key-ann' }, redGuesser, true)).toEqual({
      ok: false,
      error: 'key_viewer',
    });
    expect(changeSeat(seating, { id: 'bob-again', key: 'key-bob' }, redGuesser, true)).toEqual({
      ok: false,
      error: 'other_team',
    });
    expect(changeSeat(seating, { id: 'bob-again', key: 'key-bob' }, blueGuesser, true).ok).toBe(true);
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

  test('makes exactly the two captains the key viewers, and ties everyone seated to their group', () => {
    const before: Seating = {
      seats: new Map([...ready.seats, ['eve', SPECTATOR]]),
      keyViewers: new Set(['key-old']),
      sides: new Map([['key-old', 'blue']]),
    };
    const seating = startGame(before, (id) => `key-${id}`);
    expect(seating.keyViewers).toEqual(new Set(['key-ann', 'key-cat']));
    expect([...seating.sides]).toEqual([
      ['key-ann', 'red'],
      ['key-bob', 'red'],
      ['key-cat', 'blue'],
      ['key-dan', 'blue'],
    ]);
  });

  test('ending it frees everyone again, in their seats', () => {
    const seating = endGame(startGame(ready, (id) => `key-${id}`));
    expect(seating.seats).toEqual(ready.seats);
    expect(seating.keyViewers.size).toBe(0);
    expect(seating.sides.size).toBe(0);
  });
});

describe('shuffling the groups', () => {
  const six = seated({
    ann: redCaptain,
    bob: redGuesser,
    cat: redGuesser,
    dan: blueGuesser,
    eve: blueGuesser,
    fay: SPECTATOR,
  });
  const teamsOf = (seating: Seating) =>
    ['red', 'blue'].map((team) => [...seating.seats].filter(([, seat]) => seat.team === team));

  test('deals the seated players into two even groups with a captain each, and leaves spectators', () => {
    const shuffled = shuffleGroups(six, seededRng(5), new Set(six.seats.keys()));
    expect(seatOf(shuffled, 'fay')).toEqual(SPECTATOR);
    const teams = teamsOf(shuffled);
    expect(teams.map((members) => members.length).sort()).toEqual([2, 3]);
    for (const members of teams) expect(members.filter(([, seat]) => seat.role === 'captain')).toHaveLength(1);
  });

  test('is repeatable with the same seed and varies with others', () => {
    const seating = seated({ a: redGuesser, b: redGuesser, c: blueGuesser, d: blueGuesser });
    const online = new Set(['a', 'b', 'c', 'd']);
    expect(shuffleGroups(seating, seededRng(1), online)).toEqual(shuffleGroups(seating, seededRng(1), online));
    const outcomes = new Set(
      Array.from({ length: 20 }, (_, seed) =>
        JSON.stringify([...shuffleGroups(seating, seededRng(seed), online).seats]),
      ),
    );
    expect(outcomes.size).toBeGreaterThan(3);
  });

  test('gives the seats a game needs to players who are online, while there are enough of them', () => {
    const online = new Set(['ann', 'bob', 'cat', 'dan']); // eve is away, and still gets a seat
    const captains = new Set<string>();
    for (let seed = 0; seed < 200; seed += 1) {
      const shuffled = shuffleGroups(six, seededRng(seed), online);
      expect(startProblems(shuffled, online), `seed ${seed}`).toEqual([]);
      expect(seatOf(shuffled, 'eve').role).toBe('guesser');
      expect(
        teamsOf(shuffled)
          .map((members) => members.length)
          .sort(),
      ).toEqual([2, 3]);
      for (const team of ['red', 'blue'] as const) captains.add(captainOf(shuffled, team) ?? '');
    }
    expect(captains).toEqual(online);
  });

  test('still deals everyone when too few players are online', () => {
    const online = new Set(['ann']);
    for (let seed = 0; seed < 50; seed += 1) {
      const shuffled = shuffleGroups(six, seededRng(seed), online);
      expect(
        teamsOf(shuffled)
          .map((members) => members.length)
          .sort(),
      ).toEqual([2, 3]);
      expect(seatOf(shuffled, 'ann').role).toBe('captain');
    }
  });
});

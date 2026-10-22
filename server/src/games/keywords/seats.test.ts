import { SPECTATOR, type Seat } from '@reviewer2/shared/keywords';
import { describe, expect, test } from 'vitest';
import { seededRng, type Rng } from '../../core/random';
import {
  autoSeat,
  captainOf,
  changeSeat,
  emptySeating,
  endGame,
  removeSeat,
  seatOf,
  shuffleGroups,
  startGame,
  startProblems,
  type GameStage,
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

function moved(seating: Seating, id: string, seat: Seat, stage: GameStage = 'none'): Seating {
  const change = changeSeat(seating, member(id), seat, stage);
  if (!change.ok) throw new Error(change.error);
  return change.seating;
}

const refusal = (seating: Seating, id: string, seat: Seat, stage: GameStage = 'none') => {
  const change = changeSeat(seating, member(id), seat, stage);
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

  test('gives the seating back as it is to whoever asks for the seat they are in', () => {
    const seating = moved(emptySeating(), 'ann', redCaptain);
    expect(moved(seating, 'ann', redCaptain)).toBe(seating);
    expect(moved(seating, 'bob', { team: null, role: 'spectator' })).toBe(seating);
    const playing = started({ ann: redCaptain, bob: redGuesser });
    expect(moved(playing, 'bob', redGuesser, 'on')).toBe(playing);
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
    seating = moved(seating, 'ann', redCaptain, 'on');
    expect(seating.keyViewers.has('key-ann')).toBe(true);
    expect(refusal(seating, 'ann', redGuesser, 'on')).toBe('key_viewer');
    expect(refusal(seating, 'ann', SPECTATOR, 'on')).toBeNull();
  });

  test('spectators may join either group, and whoever plays may step out and come back', () => {
    let seating = started({ ann: redGuesser, bob: SPECTATOR, cat: SPECTATOR });
    seating = moved(seating, 'bob', redGuesser, 'on');
    seating = moved(seating, 'cat', blueGuesser, 'on');
    seating = moved(seating, 'ann', SPECTATOR, 'on');
    seating = moved(seating, 'ann', redGuesser, 'on');
    expect(seatOf(seating, 'ann')).toEqual(redGuesser);
    expect(seatOf(seating, 'bob')).toEqual(redGuesser);
    expect(seatOf(seating, 'cat')).toEqual(blueGuesser);
  });

  test('nobody changes groups: a seat in the other group is refused until the next game', () => {
    let seating = started({ ann: redGuesser, bob: SPECTATOR });
    expect(refusal(seating, 'ann', blueGuesser, 'on')).toBe('other_team');
    expect(refusal(seating, 'ann', blueCaptain, 'on')).toBe('other_team');
    // Stepping out to watch doesn't free a player from their group.
    seating = moved(seating, 'ann', SPECTATOR, 'on');
    expect(refusal(seating, 'ann', blueGuesser, 'on')).toBe('other_team');
    // A latecomer belongs to the group they join first.
    seating = moved(seating, 'bob', blueGuesser, 'on');
    expect(refusal(seating, 'bob', redGuesser, 'on')).toBe('other_team');
    expect(refusal(seating, 'bob', redCaptain, 'on')).toBe('other_team');
    expect(refusal(seating, 'bob', blueCaptain, 'on')).toBeNull();

    const next = endGame(seating);
    expect(seatOf(next, 'bob')).toEqual(blueGuesser);
    expect(
      refusal(
        startGame(next, (id) => `key-${id}`),
        'ann',
        blueGuesser,
        'on',
      ),
    ).toBeNull();
  });

  test('once the game is over, the groups and the key still bind, but a seat taken then joins no group', () => {
    const seating = started({ ann: redCaptain, bob: redGuesser, cat: blueGuesser, eve: SPECTATOR });
    expect(refusal(seating, 'bob', blueGuesser, 'over')).toBe('other_team');
    expect(refusal(seating, 'ann', redGuesser, 'over')).toBe('key_viewer');
    // Eve watched the whole game and sits down for the next one: no player of this one, and free
    // to sit anywhere.
    let after = moved(seating, 'eve', redGuesser, 'over');
    expect(seatOf(after, 'eve')).toEqual(redGuesser);
    expect(after.sides.has('key-eve')).toBe(false);
    after = moved(after, 'eve', blueCaptain, 'over');
    expect(seatOf(after, 'eve')).toEqual(blueCaptain);
    expect(after.keyViewers.has('key-eve')).toBe(false);
    expect(after.sides).toEqual(seating.sides);
  });

  test('whoever leaves and comes back with a new ID keeps their group and what they have seen', () => {
    let seating = started({ ann: redCaptain, bob: blueGuesser });
    seating = removeSeat(removeSeat(seating, 'ann'), 'bob');
    expect(changeSeat(seating, { id: 'ann-again', key: 'key-ann' }, redGuesser, 'on')).toEqual({
      ok: false,
      error: 'key_viewer',
    });
    expect(changeSeat(seating, { id: 'bob-again', key: 'key-bob' }, redGuesser, 'on')).toEqual({
      ok: false,
      error: 'other_team',
    });
    expect(changeSeat(seating, { id: 'bob-again', key: 'key-bob' }, blueGuesser, 'on').ok).toBe(true);
  });
});

describe('seating a newcomer who has come to play', () => {
  const join = (seating: Seating, id: string, seed = 1, stage: GameStage = 'none') =>
    autoSeat(seating, member(id), seededRng(seed), stage);

  test('makes them a guesser in the group with fewer players, captains and players who are away counted', () => {
    expect(seatOf(join(seated({ ann: redCaptain, bob: redGuesser, cat: blueGuesser }), 'dan'), 'dan')).toEqual(
      blueGuesser,
    );
    expect(seatOf(join(seated({ ann: blueCaptain, fay: SPECTATOR }), 'dan'), 'dan')).toEqual(redGuesser);
  });

  test('picks either group at random when both have as many, and never a captain', () => {
    const outcomes = new Set<string>();
    for (let seed = 0; seed < 20; seed += 1) {
      for (const seating of [emptySeating(), seated({ ann: redCaptain, bob: blueGuesser })]) {
        const seat = seatOf(join(seating, 'dan', seed), 'dan');
        expect(seat.role).toBe('guesser');
        outcomes.add(seat.team ?? 'none');
      }
    }
    expect(outcomes).toEqual(new Set(['red', 'blue']));
    expect(join(emptySeating(), 'dan', 3)).toEqual(join(emptySeating(), 'dan', 3));
  });

  test('during a game, ties them to the group, and sends whoever has played for a group back to it', () => {
    let seating = started({ ann: redCaptain, bob: blueCaptain, cat: blueGuesser, dan: blueGuesser });
    seating = join(seating, 'eve', 1, 'on');
    expect(seatOf(seating, 'eve')).toEqual(redGuesser);
    expect(seating.sides.get('key-eve')).toBe('red');
    // Dan leaves the bigger group and comes back with a new ID: to the same group all the same.
    seating = removeSeat(seating, 'dan');
    seating = autoSeat(seating, { id: 'dan-again', key: 'key-dan' }, seededRng(1), 'on');
    expect(seatOf(seating, 'dan-again')).toEqual(blueGuesser);
  });

  test('leaves someone who has seen the key in this game a spectator', () => {
    const before = removeSeat(started({ ann: redCaptain, bob: blueGuesser }), 'ann');
    const after = autoSeat(before, { id: 'ann-again', key: 'key-ann' }, seededRng(1), 'on');
    expect(after).toBe(before);
    expect(seatOf(after, 'ann-again')).toEqual(SPECTATOR);
  });

  test('after the game has ended, seats them for the next one without making them a player of this one', () => {
    const after = join(started({ ann: redCaptain, bob: redGuesser, cat: blueCaptain }), 'fay', 1, 'over');
    expect(seatOf(after, 'fay')).toEqual(blueGuesser);
    expect(after.sides.has('key-fay')).toBe(false);
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

  // A generator that gives the answers in the list, in order, and fails on any other question.
  function scripted(answers: number[]) {
    const left = [...answers];
    const rng: Rng = {
      int(below) {
        const answer = left.shift();
        if (answer === undefined || answer >= below) throw new Error(`unexpected draw below ${below}`);
        return answer;
      },
    };
    return { rng, left: () => left.length };
  }
  const four = seated({ a: redCaptain, b: redGuesser, c: blueCaptain, d: blueGuesser });
  const everyone = new Set(['a', 'b', 'c', 'd']);
  // Who sits with whom, whatever the colors.
  const groupsOf = (seating: Seating) =>
    teamsOf(seating)
      .map((members) =>
        members
          .map(([id]) => id)
          .sort()
          .join(''),
      )
      .sort()
      .join(' ');

  test('deals again once when a deal keeps the same people together', () => {
    // The first deal is a, c, b, d: a and b red, c and d blue, as they sat. The second is a, b, c, d.
    const { rng, left } = scripted([0, 3, 1, 1, 0, 3, 2, 1]);
    const shuffled = shuffleGroups(four, rng, everyone);
    expect(groupsOf(shuffled)).toBe('ac bd');
    expect(seatOf(shuffled, 'a')).toEqual(redCaptain);
    expect(seatOf(shuffled, 'b')).toEqual(blueCaptain);
    expect(left()).toBe(0);
  });

  test('keeps a first deal that changes the groups', () => {
    const { rng, left } = scripted([0, 3, 2, 1]);
    expect(groupsOf(shuffleGroups(four, rng, everyone))).toBe('ac bd');
    expect(left()).toBe(0);
  });

  test('keeps the second deal even when it repeats the groups again, as two players must', () => {
    const two = seated({ a: redGuesser, b: blueGuesser });
    const { rng, left } = scripted([0, 1, 1, 0]);
    const shuffled = shuffleGroups(two, rng, new Set(['a', 'b']));
    expect(seatOf(shuffled, 'a')).toEqual(redCaptain);
    expect(seatOf(shuffled, 'b')).toEqual(blueCaptain);
    expect(left()).toBe(0);
  });

  test('keeps four players together about one time in nine, and splits them the other two ways alike', () => {
    const counts = new Map<string, number>();
    for (let seed = 0; seed < 3000; seed += 1) {
      const groups = groupsOf(shuffleGroups(four, seededRng(seed), everyone));
      counts.set(groups, (counts.get(groups) ?? 0) + 1);
    }
    // One in nine of 3000 is 333; the other two ways take about 1333 each.
    expect(counts.get('ab cd')).toBeGreaterThan(250);
    expect(counts.get('ab cd')).toBeLessThan(430);
    for (const groups of ['ac bd', 'ad bc']) {
      expect(counts.get(groups)).toBeGreaterThan(1150);
      expect(counts.get(groups)).toBeLessThan(1520);
    }
  });

  test('keeps six players together about one time in a hundred', () => {
    const online = new Set(['ann', 'bob', 'cat', 'dan', 'eve', 'fay']);
    const all = seated({
      ann: redCaptain,
      bob: redGuesser,
      cat: redGuesser,
      dan: blueCaptain,
      eve: blueGuesser,
      fay: blueGuesser,
    });
    let kept = 0;
    for (let seed = 0; seed < 3000; seed += 1) {
      if (groupsOf(shuffleGroups(all, seededRng(seed), online)) === groupsOf(all)) kept += 1;
    }
    expect(kept).toBeLessThan(90);
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

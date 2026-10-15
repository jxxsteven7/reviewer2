import { describe, expect, test } from 'vitest';
import { actionsOf, replaySteps } from './replay';

describe('the steps of a replay', () => {
  test('start with nothing revealed, and bring a step for each clue and each guess', () => {
    const steps = replaySteps({
      history: [
        {
          turn: 1,
          team: 'red',
          word: 'Gradient',
          count: 2,
          guesses: [
            { card: 3, color: 'red', player: 'bob' },
            { card: 9, color: 'blue', player: 'bob' },
          ],
        },
        { turn: 2, team: 'blue', word: null, count: null, guesses: [], timedOut: true },
        {
          turn: 3,
          team: 'red',
          word: 'Loss',
          count: 1,
          guesses: [{ card: 4, color: 'red', player: 'cat' }],
          timedOut: true,
        },
      ],
    });
    const clue = { word: 'Gradient', count: 2 };
    expect(steps).toEqual([
      { turn: null, team: null, clue: null, guess: null, timedOut: false, revealed: [] },
      { turn: 1, team: 'red', clue, guess: null, timedOut: false, revealed: [] },
      {
        turn: 1,
        team: 'red',
        clue,
        guess: { card: 3, color: 'red', player: 'bob', right: true },
        timedOut: false,
        revealed: [3],
      },
      {
        turn: 1,
        team: 'red',
        clue,
        guess: { card: 9, color: 'blue', player: 'bob', right: false },
        timedOut: false,
        revealed: [3, 9],
      },
      { turn: 2, team: 'blue', clue: null, guess: null, timedOut: true, revealed: [3, 9] },
      { turn: 3, team: 'red', clue: { word: 'Loss', count: 1 }, guess: null, timedOut: false, revealed: [3, 9] },
      {
        turn: 3,
        team: 'red',
        clue: { word: 'Loss', count: 1 },
        guess: { card: 4, color: 'red', player: 'cat', right: true },
        timedOut: false,
        revealed: [3, 9, 4],
      },
      { turn: 3, team: 'red', clue: { word: 'Loss', count: 1 }, guess: null, timedOut: true, revealed: [3, 9, 4] },
    ]);
  });
});

describe('what one player did in a game', () => {
  const history = [
    {
      turn: 1,
      team: 'red' as const,
      word: 'Gradient',
      count: 2 as const,
      captain: 'ann',
      targets: [3, 4],
      guesses: [
        { card: 3, color: 'red' as const, player: 'bob' },
        { card: 9, color: 'blue' as const, player: 'cat' },
      ],
    },
    { turn: 2, team: 'blue' as const, word: null, count: null, guesses: [], timedOut: true as const, captain: 'dan' },
    {
      turn: 3,
      team: 'red' as const,
      word: 'Loss',
      count: 1 as const,
      captain: 'ann',
      guesses: [{ card: 4, color: 'red' as const, player: 'bob' }],
      timedOut: true as const,
    },
  ];
  const steps = replaySteps({ history });

  test("lists a PI's clues, with what they meant and how many of the group's own were found", () => {
    expect(actionsOf({ history }, 'ann')).toEqual([
      {
        kind: 'clue',
        step: 1,
        turn: 1,
        team: 'red',
        word: 'Gradient',
        count: 2,
        targets: [3, 4],
        found: 1,
        guesses: 2,
        stopped: { card: 9, color: 'blue' },
        timedOut: false,
      },
      {
        kind: 'clue',
        step: 5,
        turn: 3,
        team: 'red',
        word: 'Loss',
        count: 1,
        targets: [],
        found: 1,
        guesses: 1,
        stopped: null,
        timedOut: true,
      },
    ]);
    // A PI who let the time run out before a clue has that turn too.
    expect(actionsOf({ history }, 'dan')).toEqual([
      {
        kind: 'clue',
        step: 4,
        turn: 2,
        team: 'blue',
        word: null,
        count: null,
        targets: [],
        found: 0,
        guesses: 0,
        stopped: null,
        timedOut: true,
      },
    ]);
  });

  test("lists a student's guesses, right or wrong, at the steps of the replay", () => {
    const bob = actionsOf({ history }, 'bob');
    expect(bob).toEqual([
      { kind: 'guess', step: 2, turn: 1, team: 'red', card: 3, color: 'red', right: true },
      { kind: 'guess', step: 6, turn: 3, team: 'red', card: 4, color: 'red', right: true },
    ]);
    expect(actionsOf({ history }, 'cat')).toEqual([
      { kind: 'guess', step: 3, turn: 1, team: 'red', card: 9, color: 'blue', right: false },
    ]);
    // Each action's step is the one the replay shows it at.
    for (const action of bob) expect(steps[action.step]?.guess?.card).toBe(action.kind === 'guess' && action.card);
    expect(actionsOf({ history }, 'nobody')).toEqual([]);
  });
});

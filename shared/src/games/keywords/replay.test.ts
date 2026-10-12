import { describe, expect, test } from 'vitest';
import { replaySteps } from './replay';

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

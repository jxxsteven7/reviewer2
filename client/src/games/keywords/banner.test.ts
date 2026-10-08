import { SPECTATOR, type KeywordsView, type Seat } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import { bannerFor } from './banner';

const game = (team: 'red' | 'blue', phase: KeywordsView['phase'], over = false) =>
  ({ team, phase, result: over ? { winner: 'red', reason: 'found' } : null }) as KeywordsView;

const redPi: Seat = { team: 'red', role: 'captain' };
const redStudent: Seat = { team: 'red', role: 'guesser' };

describe('the banner', () => {
  test('tells a PI and a student what their group is doing, and when it is their move', () => {
    expect(bannerFor(redPi, game('red', 'clue'))).toEqual({ line: 'yourClue', group: null, urgent: true });
    expect(bannerFor(redPi, game('red', 'guess'))).toEqual({ line: 'studentsGuessing', group: null, urgent: false });
    expect(bannerFor(redStudent, game('red', 'clue'))).toEqual({ line: 'piThinking', group: null, urgent: false });
    expect(bannerFor(redStudent, game('red', 'guess'))).toEqual({ line: 'yourGuess', group: null, urgent: true });
  });

  test('tells either of them what the other group is doing in its turn', () => {
    for (const seat of [redPi, redStudent]) {
      expect(bannerFor(seat, game('blue', 'clue'))).toEqual({ line: 'otherClue', group: null, urgent: false });
      expect(bannerFor(seat, game('blue', 'guess'))).toEqual({ line: 'otherGuess', group: null, urgent: false });
    }
  });

  test('tells a spectator who is doing what', () => {
    expect(bannerFor(SPECTATOR, game('blue', 'clue'))).toEqual({ line: 'watchClue', group: 'blue', urgent: false });
    expect(bannerFor(SPECTATOR, game('red', 'guess'))).toEqual({ line: 'watchGuess', group: 'red', urgent: false });
  });

  test('says the same to everyone in the waiting room and after the game', () => {
    for (const seat of [redPi, redStudent, SPECTATOR]) {
      expect(bannerFor(seat, null)).toEqual({ line: 'lobby', group: null, urgent: false });
      expect(bannerFor(seat, null, true)).toEqual({ line: 'lobbyChair', group: null, urgent: false });
      expect(bannerFor(seat, game('red', 'guess', true))).toEqual({ line: 'over', group: null, urgent: false });
      expect(bannerFor(seat, game('red', 'over'), true)).toEqual({ line: 'over', group: null, urgent: false });
    }
  });
});

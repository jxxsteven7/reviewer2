import type { GameResult, Seat } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import type { GameContext } from '../../core/game';
import { keywordsGame, type KeywordsData } from './index';
import { gameState, LAYOUT, STANDARD } from './testing';

// What the game says of each player when it ends, for the records of players with accounts.

const seats: Record<string, Seat> = {
  ann: { team: 'red', role: 'captain' },
  bob: { team: 'red', role: 'guesser' },
  cat: { team: 'blue', role: 'captain' },
  dee: { team: 'blue', role: 'guesser' },
  eve: { team: null, role: 'spectator' },
};

// A game that has ended as `result` says, with `found` of the blue cards revealed.
function ended(result: GameResult | null, found = 0): KeywordsData {
  const game = gameState({ phase: 'over', result });
  const cards = game.cards.map((card, index) => ({ ...card, revealed: LAYOUT[index] === 'B' && index < 9 + found }));
  return {
    settings: STANDARD,
    seating: { seats: new Map(Object.entries(seats)), keyViewers: new Set(), sides: new Map() },
    game: { ...game, cards },
    match: null,
  };
}

const results = (data: KeywordsData) => keywordsGame.results?.(data, {} as GameContext);

describe('the results of a game', () => {
  test('give everyone in a seat their group, their role, whether they won and their letter', () => {
    // Red found all its cards while blue had 3 of 8 left: a spotlight for red, a reject for blue.
    expect(results(ended({ winner: 'red', reason: 'found' }, 5))).toEqual([
      { playerId: 'ann', side: 'red', role: 'captain', winner: 'red', won: true, verdict: 'spotlight' },
      { playerId: 'bob', side: 'red', role: 'guesser', winner: 'red', won: true, verdict: 'spotlight' },
      { playerId: 'cat', side: 'blue', role: 'captain', winner: 'red', won: false, verdict: 'reject' },
      { playerId: 'dee', side: 'blue', role: 'guesser', winner: 'red', won: false, verdict: 'reject' },
    ]);
  });

  test('desk reject the group that revealed Reviewer 2', () => {
    const verdicts = results(ended({ winner: 'red', reason: 'reviewer2' }))?.map(({ verdict }) => verdict);
    expect(verdicts).toEqual(['oral', 'oral', 'deskReject', 'deskReject']);
  });

  test('are none for a game that was withdrawn, or that has not ended', () => {
    expect(results(ended({ winner: null, reason: 'withdrawn' }))).toBeNull();
    expect(results({ ...ended(null), game: gameState() })).toBeNull();
    expect(results({ ...ended(null), game: null })).toBeNull();
  });
});

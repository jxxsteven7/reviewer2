import type { CardColor, ClueRecord, GameResult, Seat } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import type { GameContext } from '../../core/game';
import { keywordsGame, type KeywordsData } from './index';
import type { KeywordsState } from './state';
import { gameState, LAYOUT, STANDARD } from './testing';

// What the game says of each player when it ends, for the records of players with accounts, with
// the titles that it brought them (docs/games/keywords.md#titles).

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

// Ann came back to the room as `ann-2`, with the same member key.
const keyOf = (id: string) => (id === 'ann-2' ? 'key-ann' : `key-${id}`);
const results = (data: KeywordsData) => keywordsGame.results?.(data, { keyOf } as GameContext);

describe('the results of a game', () => {
  test('give everyone in a seat their group, their role, whether they won and their letter', () => {
    // Red found all its cards while blue had 3 of 8 left: a spotlight for red, a reject for blue.
    expect(results(ended({ winner: 'red', reason: 'found' }, 5))).toEqual([
      { playerId: 'ann', side: 'red', role: 'captain', winner: 'red', won: true, verdict: 'spotlight', titles: [] },
      { playerId: 'bob', side: 'red', role: 'guesser', winner: 'red', won: true, verdict: 'spotlight', titles: [] },
      { playerId: 'cat', side: 'blue', role: 'captain', winner: 'red', won: false, verdict: 'reject', titles: [] },
      { playerId: 'dee', side: 'blue', role: 'guesser', winner: 'red', won: false, verdict: 'reject', titles: [] },
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

describe('the titles of a game', () => {
  const guess = (card: number, color: CardColor) => ({ card, color, player: 'bob' });
  const missed = (turn: number, team: 'red' | 'blue', captain?: string): ClueRecord => ({
    turn,
    team,
    word: null,
    count: null,
    guesses: [],
    timedOut: true,
    ...(captain ? { captain } : {}),
  });
  const titles = (data: KeywordsData) =>
    Object.fromEntries((results(data) ?? []).map(({ playerId, titles }) => [playerId, titles]));
  const played = (history: ClueRecord[], result: GameResult): KeywordsData => {
    const data = ended(result);
    return { ...data, game: { ...(data.game as KeywordsState), history } };
  };

  test('give a PI Forgot to Submit for each turn their time ran out, under whichever ID they had', () => {
    const history = [
      missed(1, 'red', 'ann'),
      missed(2, 'blue', 'cat'),
      missed(3, 'red', 'ann-2'),
      // A turn whose captain's seat was empty blames nobody.
      missed(4, 'blue'),
      { turn: 5, team: 'red' as const, word: 'Late', count: 1, guesses: [guess(24, 'reviewer2')], captain: 'ann' },
    ];
    expect(titles(played(history, { winner: 'blue', reason: 'reviewer2' }))).toEqual({
      ann: [
        { title: 'missed_deadline', turn: 1 },
        { title: 'missed_deadline', turn: 3 },
      ],
      bob: [],
      cat: [{ title: 'missed_deadline', turn: 2 }],
      dee: [],
    });
  });

  test('give everyone in a group the opening record and the heavenly hand of its first clue', () => {
    // Red's PI ran out of time first, so red's first clue is that of turn 3: 9 cards at once.
    const all = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((card) => guess(card, 'red'));
    const history = [
      missed(1, 'red', 'ann'),
      { turn: 2, team: 'blue' as const, word: 'Two', count: 1, guesses: [guess(17, 'neutral')], captain: 'cat' },
      { turn: 3, team: 'red' as const, word: 'All', count: 'unlimited' as const, guesses: all, captain: 'ann' },
    ];
    // "Unlimited" names no number: a heavenly hand without the opening record.
    expect(titles(played(history, { winner: 'red', reason: 'found' }))).toEqual({
      ann: [
        { title: 'missed_deadline', turn: 1 },
        { title: 'heavenly_hand', turn: 3 },
      ],
      bob: [{ title: 'heavenly_hand', turn: 3 }],
      cat: [],
      dee: [],
    });
    const numbered = history.map((record) => (record.turn === 3 ? { ...record, count: 9 } : record));
    expect(titles(played(numbered, { winner: 'red', reason: 'found' }))).toMatchObject({
      ann: [
        { title: 'missed_deadline', turn: 1 },
        { title: 'opening_record', turn: 3 },
        { title: 'heavenly_hand', turn: 3 },
      ],
      bob: [
        { title: 'opening_record', turn: 3 },
        { title: 'heavenly_hand', turn: 3 },
      ],
      cat: [],
      dee: [],
    });
  });

  test('are none for a game that was withdrawn', () => {
    const data = played([missed(1, 'red', 'ann')], { winner: null, reason: 'withdrawn' });
    expect(results(data)).toBeNull();
  });
});

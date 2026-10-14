import {
  defaultSettings,
  type ClueRecord,
  type GamePoints,
  type KeywordsRoomData,
  type KeywordsScoreDetail,
  type KeywordsView,
} from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import { endFloats, endsBetween, revealedBetween, revealFloats, signed } from './floats';

// The points that rise as a game goes (docs/games/keywords.md#points-as-they-come): what a card
// revealed in front of the viewer does to each player's points, and what the end adds.

const card = (revealed: boolean, color?: KeywordsView['cards'][number]['color']) => ({
  word: 'Word',
  revealed,
  ...(color ? { color } : {}),
});

function view(overrides: Partial<KeywordsView> = {}): KeywordsView {
  return {
    gameId: 'g1',
    turn: 1,
    team: 'red',
    phase: 'guess',
    startingTeam: 'red',
    cards: [card(false), card(false), card(false)],
    paused: false,
    remaining: { red: 9, blue: 8 },
    clue: { word: 'Hint', count: 2 },
    guessesMade: 0,
    guessesLeft: null,
    clock: null,
    history: [],
    events: [],
    extended: { red: false, blue: false },
    result: null,
    ...overrides,
  };
}

const record = (team: 'red' | 'blue', guesses: ClueRecord['guesses']): ClueRecord => ({
  turn: 1,
  team,
  word: 'Hint',
  count: 2,
  guesses,
});

// Ann is red's PI, Bob red's student, Cat blue's PI, Dan blue's student; Eve watches.
function data(side: KeywordsRoomData['side']): KeywordsRoomData {
  return {
    settings: defaultSettings('en'),
    seats: {
      ann: { team: 'red', role: 'captain' },
      bob: { team: 'red', role: 'guesser' },
      cat: { team: 'blue', role: 'captain' },
      dan: { team: 'blue', role: 'guesser' },
      eve: { team: null, role: 'spectator' },
    },
    keyViewers: ['ann', 'cat'],
    side,
    lineup: 'free',
    joinsNext: false,
    startProblems: [],
    mayEmote: true,
    game: null,
  };
}

describe('a card revealed between two snapshots', () => {
  const before = view();
  const one = view({
    cards: [card(true, 'blue'), card(false), card(false)],
    history: [record('red', [{ card: 0, color: 'blue', player: 'bob' }])],
  });

  test('is the one card turned face up, with its color and the group whose students revealed it', () => {
    expect(revealedBetween(before, one)).toEqual({ card: 0, color: 'blue', by: 'red' });
  });

  test('is none when none or several were, across a pause and in another game', () => {
    expect(revealedBetween(one, one)).toBeNull();
    const two = view({
      cards: [card(true, 'blue'), card(true, 'red'), card(false)],
      history: [
        record('red', [
          { card: 0, color: 'blue', player: 'bob' },
          { card: 1, color: 'red', player: 'bob' },
        ]),
      ],
    });
    expect(revealedBetween(before, two)).toBeNull();
    expect(revealedBetween(view({ paused: true, cards: [] }), one)).toBeNull();
    expect(revealedBetween(before, { ...one, gameId: 'g2' })).toBeNull();
  });

  test('changes the points of the group that revealed it, by role, and nobody else', () => {
    const reveal = { color: 'neutral' as const, by: 'red' as const };
    const forBob = revealFloats(data('red'), 'bob', reveal);
    expect(forBob.mine).toEqual({ text: '\u22121', team: 'red' });
    expect(Object.fromEntries(forBob.players)).toEqual({
      ann: { text: '\u22122', team: 'red' },
      bob: { text: '\u22121', team: 'red' },
    });
    expect(revealFloats(data('red'), 'ann', reveal).mine).toEqual({ text: '\u22122', team: 'red' });
    // The other group, and a spectator, see nothing on the card.
    expect(revealFloats(data('blue'), 'dan', reveal).mine).toBeNull();
    expect(revealFloats(data(null), 'eve', reveal).mine).toBeNull();
    // A card of the group's own is +1 for everyone in it, the PI too.
    const found = revealFloats(data('blue'), 'cat', { color: 'blue', by: 'blue' });
    expect(found.mine).toEqual({ text: '+1', team: 'blue' });
    expect([...found.players.keys()]).toEqual(['cat', 'dan']);
  });
});

describe('the end of a game', () => {
  test('is the snapshot that first has a result with a winner', () => {
    const over = view({ phase: 'over', result: { winner: 'blue', reason: 'reviewer2' } });
    expect(endsBetween(view(), over)).toBe(true);
    expect(endsBetween(over, over)).toBe(false);
    expect(endsBetween(view(), { ...over, result: { winner: null, reason: 'withdrawn' } })).toBe(false);
    expect(endsBetween(view(), { ...over, gameId: 'g2' })).toBe(false);
  });

  test('adds the win and the bonuses as the server scored them, for those who have any', () => {
    const detail = (role: 'captain' | 'guesser', won: boolean, more: Partial<KeywordsScoreDetail> = {}) => ({
      role,
      found: 5,
      won,
      irrelevant: 1,
      wrong: 0,
      reviewer2: 0,
      ...more,
    });
    const points: GamePoints[] = [
      { playerId: 'ann', points: 0, detail: detail('captain', true, { bigClues: 1 }) },
      { playerId: 'bob', points: 0, detail: detail('guesser', true) },
      { playerId: 'cat', points: 0, detail: detail('captain', false) },
      { playerId: 'dan', points: 0, detail: detail('guesser', false) },
    ];
    const forAnn = endFloats(data('red'), 'ann', points);
    expect(forAnn.mine).toEqual({ text: '+5', team: 'red' });
    expect(Object.fromEntries(forAnn.players)).toEqual({
      ann: { text: '+5', team: 'red' },
      bob: { text: '+3', team: 'red' },
    });
    expect(endFloats(data('blue'), 'dan', points).mine).toBeNull();
    expect(endFloats(data(null), 'eve', points).mine).toBeNull();
    expect(endFloats(data('red'), 'ann', []).players.size).toBe(0);
  });

  test('writes a number with its sign and a true minus', () => {
    expect([3, 1, -2].map(signed)).toEqual(['+3', '+1', '\u22122']);
  });
});

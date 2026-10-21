import { type GamePoints } from '@reviewer2/shared';
import {
  defaultSettings,
  type ClueRecord,
  type KeywordsRoomData,
  type KeywordsScoreDetail,
  type KeywordsView,
} from '@reviewer2/shared/keywords';
import { describe, expect, test } from 'vitest';
import { endFloats, endsBetween, revealedBetween, revealFloats, signed, turnedBetween } from './floats';

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

// Ann gives red's clues, Cat blue's.
const record = (team: 'red' | 'blue', guesses: ClueRecord['guesses']): ClueRecord => ({
  turn: 1,
  team,
  at: 0,
  word: 'Hint',
  count: 2,
  captain: team === 'red' ? 'ann' : 'cat',
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
    titles: {},
    game: null,
  };
}

describe('the card turned between two boards', () => {
  const board = (revealed: number[]) => [0, 1, 2].map((index) => card(revealed.includes(index), 'red'));

  test('is the one card that has come face up, and none for none, several, one turned back or another board', () => {
    expect(turnedBetween(board([]), board([1]))).toBe(1);
    expect(turnedBetween(board([0]), board([0, 2]))).toBe(2);
    expect(turnedBetween(board([1]), board([1]))).toBeNull();
    expect(turnedBetween(board([]), board([0, 1]))).toBeNull();
    expect(turnedBetween(board([1]), board([]))).toBeNull();
    expect(turnedBetween(board([]).slice(0, 2), board([1]))).toBeNull();
  });
});

describe('a card revealed between two snapshots', () => {
  const before = view();
  const one = view({
    cards: [card(true, 'blue'), card(false), card(false)],
    history: [record('red', [{ card: 0, color: 'blue', player: 'bob', at: 0 }])],
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
          { card: 0, color: 'blue', player: 'bob', at: 0 },
          { card: 1, color: 'red', player: 'bob', at: 0 },
        ]),
      ],
    });
    expect(revealedBetween(before, two)).toBeNull();
    expect(revealedBetween(view({ paused: true, cards: [] }), one)).toBeNull();
    expect(revealedBetween(before, { ...one, gameId: 'g2' })).toBeNull();
  });

  test('changes the points of the group that revealed it, by role, and nobody else', () => {
    const reveal = { color: 'neutral' as const, by: 'red' as const };
    const neutral = view({ history: [record('red', [{ card: 0, color: 'neutral', player: 'bob', at: 0 }])] });
    const forBob = revealFloats(data('red'), 'bob', reveal, before, neutral);
    expect(forBob.mine).toEqual({ text: '-1', tint: 'red' });
    expect(Object.fromEntries(forBob.players)).toEqual({
      ann: { text: '-2', tint: 'red' },
      bob: { text: '-1', tint: 'red' },
    });
    expect(revealFloats(data('red'), 'ann', reveal, before, neutral).mine).toEqual({ text: '-2', tint: 'red' });
    // The other group, and a spectator, see nothing on the card.
    expect(revealFloats(data('blue'), 'dan', reveal, before, neutral).mine).toBeNull();
    expect(revealFloats(data(null), 'eve', reveal, before, neutral).mine).toBeNull();
    // A card of the group's own is +1 for everyone in it, the PI too.
    const own = view({ history: [record('blue', [{ card: 0, color: 'blue', player: 'dan', at: 0 }])] });
    const found = revealFloats(data('blue'), 'cat', { color: 'blue', by: 'blue' }, before, own);
    expect(found.mine).toEqual({ text: '+1', tint: 'blue' });
    expect([...found.players.keys()]).toEqual(['cat', 'dan']);
  });

  test('brings the bonus of the card with it: the big clue for the PI, the opening record for the students', () => {
    // Blue's first clue names 4; its students find the four cards one by one.
    const guesses = (found: number) =>
      Array.from({ length: found }, (_, card) => ({ card, color: 'blue' as const, player: 'dan', at: 0 }));
    const step = (found: number) => view({ history: [{ ...record('blue', guesses(found)), count: 4 }] });
    const reveal = { color: 'blue' as const, by: 'blue' as const };
    // The third card: a point each. The fourth: the PI's big clue and the students' opening record,
    // a point more each, as one number.
    const third = revealFloats(data('blue'), 'dan', reveal, step(2), step(3));
    expect(Object.fromEntries(third.players)).toEqual({
      cat: { text: '+1', tint: 'blue' },
      dan: { text: '+1', tint: 'blue' },
    });
    const fourth = revealFloats(data('blue'), 'dan', reveal, step(3), step(4));
    expect(fourth.mine).toEqual({ text: '+2', tint: 'blue' });
    expect(Object.fromEntries(fourth.players)).toEqual({
      cat: { text: '+2', tint: 'blue' },
      dan: { text: '+2', tint: 'blue' },
    });
    // The fifth, with a clue of 5: the PI's big clue again, and nothing more for the students.
    const five = (found: number) => view({ history: [{ ...record('blue', guesses(found)), count: 5 }] });
    const fifth = revealFloats(data('blue'), 'cat', reveal, five(4), five(5));
    expect(fifth.mine).toEqual({ text: '+2', tint: 'blue' });
    expect(Object.fromEntries(fifth.players)).toEqual({
      cat: { text: '+2', tint: 'blue' },
      dan: { text: '+2', tint: 'blue' },
    });
    // The big clue is the clue-giver's: a PI who took the seat over from one who left has only the
    // card's point.
    const left = (found: number) =>
      view({ history: [{ ...record('blue', guesses(found)), count: 5, captain: 'gone' }] });
    const taken = revealFloats(data('blue'), 'cat', reveal, left(4), left(5));
    expect(taken.mine).toEqual({ text: '+1', tint: 'blue' });
    expect(Object.fromEntries(taken.players)).toEqual({
      cat: { text: '+1', tint: 'blue' },
      dan: { text: '+2', tint: 'blue' },
    });
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

  test('adds the win and the heavenly hand as the server scored them, for those who have any, the big clues having risen already', () => {
    const detail = (role: 'captain' | 'guesser', won: boolean, more: Partial<KeywordsScoreDetail> = {}) => ({
      role,
      found: 5,
      won,
      irrelevant: 1,
      wrong: 0,
      reviewer2: 0,
      bigClues: 0,
      missed: 0,
      openingRecord: false,
      heavenlyHand: false,
      ...more,
    });
    const points: GamePoints[] = [
      { playerId: 'ann', points: 0, detail: detail('captain', true, { bigClues: 1 }) },
      { playerId: 'bob', points: 0, detail: detail('guesser', true, { openingRecord: true }) },
      { playerId: 'cat', points: 0, detail: detail('captain', false) },
      { playerId: 'dan', points: 0, detail: detail('guesser', false) },
    ];
    const forAnn = endFloats(data('red'), 'ann', points);
    expect(forAnn.mine).toEqual({ text: '+4', tint: 'red' });
    expect(Object.fromEntries(forAnn.players)).toEqual({
      ann: { text: '+4', tint: 'red' },
      bob: { text: '+3', tint: 'red' },
    });
    const heavenly: GamePoints[] = [
      { playerId: 'ann', points: 0, detail: detail('captain', true, { bigClues: 6, heavenlyHand: true }) },
      { playerId: 'bob', points: 0, detail: detail('guesser', true, { heavenlyHand: true }) },
    ];
    expect(Object.fromEntries(endFloats(data('red'), 'ann', heavenly).players)).toEqual({
      ann: { text: '+7', tint: 'red' },
      bob: { text: '+4', tint: 'red' },
    });
    // Red's opening record rose with its card, and the heavenly hand outdid it by the end: Bob's
    // number is that point less, and the PI's, who had none for it, as it was.
    const outdone = endFloats(data('red'), 'bob', heavenly, new Set(['red']));
    expect(outdone.mine).toEqual({ text: '+3', tint: 'red' });
    expect(Object.fromEntries(outdone.players)).toEqual({
      ann: { text: '+7', tint: 'red' },
      bob: { text: '+3', tint: 'red' },
    });
    expect(Object.fromEntries(endFloats(data('red'), 'bob', heavenly, new Set(['blue'])).players)).toEqual({
      ann: { text: '+7', tint: 'red' },
      bob: { text: '+4', tint: 'red' },
    });
    expect(endFloats(data('blue'), 'dan', points).mine).toBeNull();
    expect(endFloats(data(null), 'eve', points).mine).toBeNull();
    expect(endFloats(data('red'), 'ann', []).players.size).toBe(0);
  });

  test('writes a number with its sign and a true minus', () => {
    expect([3, 1, -2].map(signed)).toEqual(['+3', '+1', '-2']);
  });
});

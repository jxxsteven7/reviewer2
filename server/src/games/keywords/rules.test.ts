import { describe, expect, test } from 'vitest';
import { seededRng } from '../../core/random';
import { giveClue, newGame, pass, reveal, withdraw } from './rules';
import { guessesLeft, remaining, type KeywordsState } from './state';
import { accepted, captain, gameState, guesser, now, refused, spectator } from './testing';

const WORDS = Array.from({ length: 25 }, (_, i) => `Term${i}`);

// Red's captain gives a clue on the default board, where red has cards 0-8.
const clued = (count: number | 'unlimited' = 2, state = gameState()) =>
  accepted(giveClue(state, captain('red'), { ...now(state), word: 'Gradient', count }));

const revealAll = (state: KeywordsState, cards: number[]) =>
  cards.reduce((current, card) => accepted(reveal(current, guesser(current.team), { ...now(current), card })), state);

describe('a new game', () => {
  test('starts with the starting team giving a clue', () => {
    const state = newGame(WORDS, seededRng(7), 'g');
    expect(state).toMatchObject({ gameId: 'g', turn: 1, phase: 'clue', team: state.startingTeam, guessesMade: 0 });
    expect(state.cards).toHaveLength(25);
    expect(remaining(state.cards, state.startingTeam)).toBe(9);
    expect(state.history).toEqual([]);
    expect(state.result).toBeNull();
  });
});

describe('giving a clue', () => {
  test("moves the team's guessers on to guessing and records the clue", () => {
    const state = clued(2);
    expect(state.phase).toBe('guess');
    expect(state.clue).toEqual({ word: 'Gradient', count: 2 });
    expect(state.history).toEqual([{ turn: 1, team: 'red', word: 'Gradient', count: 2, guesses: [] }]);
    expect(guessesLeft(state)).toBe(3);
  });

  test("keeps the captain's spelling, without stray spaces", () => {
    const state = gameState();
    const next = accepted(giveClue(state, captain('red'), { ...now(state), word: '  Self-Attention ', count: 1 }));
    expect(next.clue?.word).toBe('Self-Attention');
    expect(next.history[0]?.word).toBe('Self-Attention');
  });

  test('records the clue as it was typed, without invisible characters', () => {
    const state = gameState();
    const typed = (word: string) => accepted(giveClue(state, captain('red'), { ...now(state), word, count: 1 })).clue;
    // A superscript two and full-width letters stay what they are, although the check folds them.
    expect(typed('R\u00b2')?.word).toBe('R\u00b2');
    expect(typed('\uff27\uff30\uff35')?.word).toBe('\uff27\uff30\uff35');
    // A soft hyphen and a zero-width space.
    expect(typed('Gra\u00addi\u200bent')?.word).toBe('Gradient');
  });

  test("is only for the current team's captain", () => {
    const state = gameState();
    const clue = { ...now(state), word: 'Gradient', count: 1 };
    expect(refused(giveClue(state, captain('blue'), clue))).toBe('not_your_turn');
    expect(refused(giveClue(state, guesser('red'), clue))).toBe('not_captain');
    expect(refused(giveClue(state, spectator, clue))).toBe('not_your_turn');
  });

  test('is refused for another game or another turn', () => {
    const state = gameState();
    expect(refused(giveClue(state, captain('red'), { gameId: 'other', turn: 1, word: 'Gradient', count: 1 }))).toBe(
      'stale',
    );
    expect(refused(giveClue(state, captain('red'), { gameId: 'game-1', turn: 2, word: 'Gradient', count: 1 }))).toBe(
      'stale',
    );
  });

  test('is refused while the guessers are guessing, and after the game', () => {
    const guessing = clued();
    expect(refused(giveClue(guessing, captain('red'), { ...now(guessing), word: 'Loss', count: 1 }))).toBe(
      'wrong_phase',
    );
    const over = withdraw(gameState());
    expect(refused(giveClue(over, captain('red'), { ...now(over), word: 'Loss', count: 1 }))).toBe('game_over');
  });

  test('needs a number from 0 to 9, or unlimited', () => {
    const state = gameState();
    for (const count of [-1, 10, 1.5, Number.NaN]) {
      expect(refused(giveClue(state, captain('red'), { ...now(state), word: 'Gradient', count })), String(count)).toBe(
        'bad_count',
      );
    }
    for (const count of [0, 1, 9, 'unlimited'] as const) {
      expect(refused(giveClue(state, captain('red'), { ...now(state), word: 'Gradient', count }))).toBeNull();
    }
  });

  test('refuses a clue that breaks the clue rules', () => {
    const state = gameState();
    const word = (clue: string) => refused(giveClue(state, captain('red'), { ...now(state), word: clue, count: 1 }));
    expect(word('')).toBe('clue_empty');
    expect(word('two words')).toBe('clue_not_one_word');
    expect(word('x'.repeat(30))).toBe('clue_too_long');
    expect(word('word3')).toBe('clue_on_board');
  });

  test('may repeat a word that has been covered', () => {
    const state = gameState();
    const entropy = (revealed: boolean) =>
      state.cards.map((card, i) => (i === 3 ? { ...card, word: 'Entropy', revealed } : card));
    const open = { ...state, cards: entropy(false) };
    expect(refused(giveClue(open, captain('red'), { ...now(open), word: 'entropy', count: 1 }))).toBe('clue_on_board');
    const covered = { ...state, cards: entropy(true) };
    expect(refused(giveClue(covered, captain('red'), { ...now(covered), word: 'entropy', count: 1 }))).toBeNull();
  });
});

describe('revealing a card', () => {
  test("is only for the current team's guessers, after the clue", () => {
    const before = gameState();
    expect(refused(reveal(before, guesser('red'), { ...now(before), card: 0 }))).toBe('wrong_phase');
    const state = clued();
    expect(refused(reveal(state, guesser('blue'), { ...now(state), card: 0 }))).toBe('not_your_turn');
    expect(refused(reveal(state, captain('red'), { ...now(state), card: 0 }))).toBe('not_guesser');
    expect(refused(reveal(state, spectator, { ...now(state), card: 0 }))).toBe('not_your_turn');
    expect(refused(reveal(state, guesser('red'), { gameId: 'game-1', turn: 2, card: 0 }))).toBe('stale');
  });

  test('needs a card that exists and has not been revealed', () => {
    const state = clued();
    for (const card of [-1, 25, 1.5]) {
      expect(refused(reveal(state, guesser('red'), { ...now(state), card })), String(card)).toBe('no_such_card');
    }
    const once = accepted(reveal(state, guesser('red'), { ...now(state), card: 0 }));
    expect(refused(reveal(once, guesser('red'), { ...now(once), card: 0 }))).toBe('card_revealed');
  });

  test("of the team's own lets it go on, up to the number plus one", () => {
    let state = revealAll(clued(2), [0]);
    expect(state).toMatchObject({ team: 'red', phase: 'guess', guessesMade: 1 });
    expect(guessesLeft(state)).toBe(2);
    state = revealAll(state, [1]);
    expect(guessesLeft(state)).toBe(1);
    state = revealAll(state, [2]);
    expect(state).toMatchObject({ team: 'blue', turn: 2, phase: 'clue', clue: null, guessesMade: 0 });
    expect(state.history[0]?.guesses).toEqual([
      { card: 0, color: 'red' },
      { card: 1, color: 'red' },
      { card: 2, color: 'red' },
    ]);
  });

  test('is recorded under the clue of its own turn', () => {
    let state = revealAll(clued(2), [0, 17]);
    state = accepted(giveClue(state, captain('blue'), { ...now(state), word: 'Loss', count: 1 }));
    state = revealAll(state, [9, 10]);
    state = accepted(giveClue(state, captain('red'), { ...now(state), word: 'Epoch', count: 'unlimited' }));
    state = revealAll(state, [1]);
    expect(state.history).toEqual([
      {
        turn: 1,
        team: 'red',
        word: 'Gradient',
        count: 2,
        guesses: [
          { card: 0, color: 'red' },
          { card: 17, color: 'neutral' },
        ],
      },
      {
        turn: 2,
        team: 'blue',
        word: 'Loss',
        count: 1,
        guesses: [
          { card: 9, color: 'blue' },
          { card: 10, color: 'blue' },
        ],
      },
      { turn: 3, team: 'red', word: 'Epoch', count: 'unlimited', guesses: [{ card: 1, color: 'red' }] },
    ]);
  });

  test('with a clue of 0 or unlimited allows any number of guesses', () => {
    for (const count of [0, 'unlimited'] as const) {
      const state = revealAll(clued(count), [0, 1, 2, 3, 4, 5]);
      expect(state, String(count)).toMatchObject({ team: 'red', phase: 'guess', guessesMade: 6 });
      expect(guessesLeft(state)).toBeNull();
    }
  });

  test('of an irrelevant paper ends the turn', () => {
    const state = revealAll(clued(3), [0, 17]);
    expect(state).toMatchObject({ team: 'blue', turn: 2, phase: 'clue' });
    expect(state.history[0]?.guesses.at(-1)).toEqual({ card: 17, color: 'neutral' });
  });

  test("of the other team's ends the turn and counts for them", () => {
    const state = revealAll(clued(3), [9]);
    expect(state).toMatchObject({ team: 'blue', phase: 'clue' });
    expect(remaining(state.cards, 'blue')).toBe(7);
  });

  test('of Reviewer 2 loses the game for the team that reveals it', () => {
    const state = revealAll(clued(3), [0, 24]);
    expect(state.phase).toBe('over');
    expect(state.result).toEqual({ winner: 'blue', reason: 'reviewer2' });
  });

  test("wins the game when it is the last of a team's cards, even the other team's", () => {
    const almost = gameState();
    almost.cards = almost.cards.map((card, i) => ({ ...card, revealed: i <= 7 || (i >= 9 && i <= 15) }));
    const redWins = revealAll(clued('unlimited', almost), [8]);
    expect(redWins.result).toEqual({ winner: 'red', reason: 'found' });

    const blueWins = revealAll(clued('unlimited', almost), [16]);
    expect(blueWins.result).toEqual({ winner: 'blue', reason: 'found' });
  });
});

describe('passing', () => {
  test('needs at least one guess first', () => {
    const state = clued();
    expect(refused(pass(state, guesser('red'), now(state)))).toBe('must_guess_first');
    const after = revealAll(state, [0]);
    expect(accepted(pass(after, guesser('red'), now(after)))).toMatchObject({ team: 'blue', turn: 2, phase: 'clue' });
  });

  test("is only for the current team's guessers", () => {
    const state = revealAll(clued(), [0]);
    expect(refused(pass(state, captain('red'), now(state)))).toBe('not_guesser');
    expect(refused(pass(state, guesser('blue'), now(state)))).toBe('not_your_turn');
    expect(refused(pass(gameState(), guesser('red'), now(gameState())))).toBe('wrong_phase');
  });

  test('from an earlier turn is stale', () => {
    const state = revealAll(clued(), [0]);
    const moment = now(state);
    const next = accepted(pass(state, guesser('red'), moment));
    expect(refused(pass(next, guesser('red'), moment))).toBe('stale');
  });
});

describe('withdrawing', () => {
  test('ends the game without a winner, once', () => {
    const over = withdraw(clued());
    expect(over.phase).toBe('over');
    expect(over.result).toEqual({ winner: null, reason: 'withdrawn' });
    const finished = revealAll(clued(), [24]);
    expect(withdraw(finished)).toBe(finished);
  });
});

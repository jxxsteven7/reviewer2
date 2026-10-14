import {
  CHAT_KEPT,
  EVENTS_KEPT,
  MAX_CHAT_LENGTH,
  otherTeam,
  type CardColor,
  type ClueCount,
  type ClueRecord,
  type Team,
} from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import { seededRng } from '../../core/random';
import {
  dropSelection,
  expire,
  extend,
  giveClue,
  heroesOf,
  mark,
  newGame,
  pass,
  pause,
  resume,
  reveal,
  say,
  select,
  withdraw,
  type Actor,
} from './rules';
import { guessesLeft, remaining, type KeywordsState } from './state';
import { accepted, captain, gameState, guesser, now, refused, setup, spectator, STANDARD } from './testing';

const WORDS = Array.from({ length: 25 }, (_, i) => `Term${i}`);

// Red's captain gives a clue on the default board, where red has cards 0-8.
const clued = (count: number | 'unlimited' = 2, state = gameState()) =>
  accepted(giveClue(state, captain('red'), { ...now(state), word: 'Gradient', count }, 0));

const revealAll = (state: KeywordsState, cards: number[]) =>
  cards.reduce(
    (current, card) => accepted(reveal(current, guesser(current.team), { ...now(current), card }, 0)),
    state,
  );

describe('a new game', () => {
  test('starts with the starting team giving a clue', () => {
    const state = newGame(WORDS, seededRng(7), setup('g'), 0);
    expect(state).toMatchObject({ gameId: 'g', turn: 1, phase: 'clue', team: state.startingTeam, guessesMade: 0 });
    expect(state.cards).toHaveLength(25);
    expect(remaining(state.cards, state.startingTeam)).toBe(9);
    expect(state.history).toEqual([]);
    expect(state.result).toBeNull();
    expect(state.selections).toEqual([]);
    expect(state.chat).toEqual({ red: [], blue: [] });
  });
});

describe('giving a clue', () => {
  test("moves the team's guessers on to guessing and records the clue", () => {
    const state = clued(2);
    expect(state.phase).toBe('guess');
    expect(state.clue).toEqual({ word: 'Gradient', count: 2 });
    expect(state.history).toEqual([
      { turn: 1, team: 'red', word: 'Gradient', count: 2, guesses: [], captain: 'red-captain', at: 0 },
    ]);
    expect(guessesLeft(state)).toBe(3);
  });

  test("keeps the captain's spelling, without stray spaces", () => {
    const state = gameState();
    const next = accepted(giveClue(state, captain('red'), { ...now(state), word: '  Self-Attention ', count: 1 }, 0));
    expect(next.clue?.word).toBe('Self-Attention');
    expect(next.history[0]?.word).toBe('Self-Attention');
    const pasted = accepted(
      giveClue(state, captain('red'), { ...now(state), word: 'Gra\u00addi\u00adent', count: 1 }, 0),
    );
    expect(pasted.clue?.word).toBe('Gradient');
  });

  test('records the clue as it was typed, without invisible characters', () => {
    // Cards without digits, which a clue with a digit would have a character in common with.
    const state = gameState({
      cards: gameState().cards.map((card, index) => ({ ...card, word: `Card${String.fromCharCode(65 + index)}` })),
    });
    const typed = (word: string) =>
      accepted(giveClue(state, captain('red'), { ...now(state), word, count: 1 }, 0)).clue;
    // A superscript two and full-width letters stay what they are, although the check folds them.
    expect(typed('R\u00b2')?.word).toBe('R\u00b2');
    expect(typed('\uff27\uff30\uff35')?.word).toBe('\uff27\uff30\uff35');
    // A soft hyphen and a zero-width space.
    expect(typed('Gra\u00addi\u200bent')?.word).toBe('Gradient');
  });

  test("is only for the current team's captain", () => {
    const state = gameState();
    const clue = { ...now(state), word: 'Gradient', count: 1 };
    expect(refused(giveClue(state, captain('blue'), clue, 0))).toBe('not_your_turn');
    expect(refused(giveClue(state, guesser('red'), clue, 0))).toBe('not_captain');
    expect(refused(giveClue(state, spectator, clue, 0))).toBe('not_your_turn');
  });

  test('is refused for another game or another turn', () => {
    const state = gameState();
    expect(refused(giveClue(state, captain('red'), { gameId: 'other', turn: 1, word: 'Gradient', count: 1 }, 0))).toBe(
      'stale',
    );
    expect(refused(giveClue(state, captain('red'), { gameId: 'game-1', turn: 2, word: 'Gradient', count: 1 }, 0))).toBe(
      'stale',
    );
  });

  test('is refused while the guessers are guessing, and after the game', () => {
    const guessing = clued();
    expect(refused(giveClue(guessing, captain('red'), { ...now(guessing), word: 'Loss', count: 1 }, 0))).toBe(
      'wrong_phase',
    );
    const over = accepted(withdraw(gameState(), now(gameState())));
    expect(refused(giveClue(over, captain('red'), { ...now(over), word: 'Loss', count: 1 }, 0))).toBe('game_over');
  });

  test('needs a number from 0 to 9, or unlimited', () => {
    const state = gameState();
    for (const count of [-1, 10, 1.5, Number.NaN]) {
      expect(
        refused(giveClue(state, captain('red'), { ...now(state), word: 'Gradient', count }, 0)),
        String(count),
      ).toBe('bad_count');
    }
    for (const count of [0, 1, 9, 'unlimited'] as const) {
      expect(refused(giveClue(state, captain('red'), { ...now(state), word: 'Gradient', count }, 0))).toBeNull();
    }
  });

  test('refuses a clue that breaks the clue rules', () => {
    const state = gameState();
    const word = (clue: string) => refused(giveClue(state, captain('red'), { ...now(state), word: clue, count: 1 }, 0));
    expect(word('')).toBe('clue_empty');
    expect(word('two words')).toBe('clue_not_one_word');
    expect(word('x'.repeat(30))).toBe('clue_too_long');
    expect(word('word3')).toBe('clue_on_board');
    expect(word(42 as unknown as string)).toBe('clue_empty');
  });

  test("refuses a card's translation as a clue", () => {
    const state = gameState();
    const cards = state.cards.map((card, i) => (i === 3 ? { ...card, translations: ['Entropie'] } : card));
    const translated = { ...state, cards };
    const clue = { ...now(state), word: 'entropie', count: 1 };
    expect(refused(giveClue(translated, captain('red'), clue, 0))).toBe('clue_on_board');
    expect(refused(giveClue(state, captain('red'), clue, 0))).toBeNull();
  });

  test('may repeat a word that has been covered', () => {
    const state = gameState();
    const entropy = (revealed: boolean) =>
      state.cards.map((card, i) => (i === 3 ? { ...card, word: 'Entropy', revealed } : card));
    const open = { ...state, cards: entropy(false) };
    expect(refused(giveClue(open, captain('red'), { ...now(open), word: 'entropy', count: 1 }, 0))).toBe(
      'clue_on_board',
    );
    const covered = { ...state, cards: entropy(true) };
    expect(refused(giveClue(covered, captain('red'), { ...now(covered), word: 'entropy', count: 1 }, 0))).toBeNull();
  });
});

describe('the cards a captain marks with a clue', () => {
  const give = (state: KeywordsState, targets: number[] | undefined, word = 'Gradient', count: ClueCount = 2) =>
    giveClue(state, captain('red'), { ...now(state), word, count, ...(targets ? { targets } : {}) }, 0);

  test('are recorded with the clue, in the order they were marked', () => {
    const state = accepted(give(gameState(), [5, 2, 7]));
    expect(state.history[0]).toMatchObject({ word: 'Gradient', captain: 'red-captain', targets: [5, 2, 7] });
  });

  test('may be none at all, and then the record has none', () => {
    for (const targets of [undefined, []]) {
      const record = accepted(give(gameState(), targets)).history[0];
      expect(record && 'targets' in record, JSON.stringify(targets)).toBe(false);
    }
  });

  test("don't have to match the number", () => {
    expect(accepted(give(gameState(), [0, 1, 2], 'Gradient', 1)).history[0]?.targets).toEqual([0, 1, 2]);
    expect(accepted(give(gameState(), [0], 'Gradient', 'unlimited')).history[0]?.targets).toEqual([0]);
  });

  test("must be the group's own cards that are still to be found, each once", () => {
    // Red has cards 0-8, of which 0 is revealed; blue has 9-16, papers are 17-23, Reviewer 2 is 24.
    const base = gameState();
    const state = {
      ...base,
      cards: base.cards.map((card, index) => (index === 0 ? { ...card, revealed: true } : card)),
    };
    expect(refused(give(state, [1, 8]))).toBeNull();
    for (const targets of [[0], [9], [17], [24], [1, 1], [25], [-1], [1.5], [1, 9]]) {
      expect(refused(give(state, targets)), JSON.stringify(targets)).toBe('bad_targets');
    }
  });

  test('are judged after the clue itself, so that a bad clue is refused for what it is', () => {
    const state = gameState();
    expect(refused(give(state, [24], 'Word3'))).toBe('clue_on_board');
    expect(refused(give(state, [24], 'Gradient', 12))).toBe('bad_count');
    expect(refused(giveClue(state, captain('blue'), { ...now(state), word: 'Loss', count: 1, targets: [24] }, 0))).toBe(
      'not_your_turn',
    );
  });

  test('come with the time of the clue, from the start of the game', () => {
    const started = newGame(WORDS, seededRng(3), setup('timed'), 1000);
    const team = started.team;
    const state = accepted(giveClue(started, captain(team), { ...now(started), word: 'Gradient', count: 1 }, 5000));
    expect(state.history[0]).toMatchObject({ captain: `${team}-captain`, at: 4000 });
  });
});

describe('revealing a card', () => {
  test("is only for the current team's guessers, after the clue", () => {
    const before = gameState();
    expect(refused(reveal(before, guesser('red'), { ...now(before), card: 0 }, 0))).toBe('wrong_phase');
    const state = clued();
    expect(refused(reveal(state, guesser('blue'), { ...now(state), card: 0 }, 0))).toBe('not_your_turn');
    expect(refused(reveal(state, captain('red'), { ...now(state), card: 0 }, 0))).toBe('not_guesser');
    expect(refused(reveal(state, spectator, { ...now(state), card: 0 }, 0))).toBe('not_your_turn');
    expect(refused(reveal(state, guesser('red'), { gameId: 'game-1', turn: 2, card: 0 }, 0))).toBe('stale');
  });

  test('needs a card that exists and has not been revealed', () => {
    const state = clued();
    for (const card of [-1, 25, 1.5]) {
      expect(refused(reveal(state, guesser('red'), { ...now(state), card }, 0)), String(card)).toBe('no_such_card');
    }
    const once = accepted(reveal(state, guesser('red'), { ...now(state), card: 0 }, 0));
    expect(refused(reveal(once, guesser('red'), { ...now(once), card: 0 }, 0))).toBe('card_revealed');
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
      { card: 0, color: 'red', player: 'red-guesser', at: 0 },
      { card: 1, color: 'red', player: 'red-guesser', at: 0 },
      { card: 2, color: 'red', player: 'red-guesser', at: 0 },
    ]);
  });

  test('is recorded under the clue of its own turn', () => {
    let state = revealAll(clued(2), [0, 17]);
    state = accepted(giveClue(state, captain('blue'), { ...now(state), word: 'Loss', count: 1 }, 0));
    state = revealAll(state, [9, 10]);
    state = accepted(giveClue(state, captain('red'), { ...now(state), word: 'Epoch', count: 'unlimited' }, 0));
    state = revealAll(state, [1]);
    expect(state.history).toEqual([
      {
        turn: 1,
        team: 'red',
        word: 'Gradient',
        count: 2,
        guesses: [
          { card: 0, color: 'red', player: 'red-guesser', at: 0 },
          { card: 17, color: 'neutral', player: 'red-guesser', at: 0 },
        ],
        captain: 'red-captain',
        at: 0,
      },
      {
        turn: 2,
        team: 'blue',
        word: 'Loss',
        count: 1,
        guesses: [
          { card: 9, color: 'blue', player: 'blue-guesser', at: 0 },
          { card: 10, color: 'blue', player: 'blue-guesser', at: 0 },
        ],
        captain: 'blue-captain',
        at: 0,
      },
      {
        turn: 3,
        team: 'red',
        word: 'Epoch',
        count: 'unlimited',
        guesses: [{ card: 1, color: 'red', player: 'red-guesser', at: 0 }],
        captain: 'red-captain',
        at: 0,
      },
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
    expect(state.history[0]?.guesses.at(-1)).toEqual({ card: 17, color: 'neutral', player: 'red-guesser', at: 0 });
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

describe('choosing a card', () => {
  const ann = guesser('red', 'ann');
  const bob = guesser('red', 'bob');

  test('shows the choice of each guesser, one card each', () => {
    let state = clued();
    state = accepted(select(state, ann, { ...now(state), card: 3 }));
    state = accepted(select(state, bob, { ...now(state), card: 17 }));
    expect(state.selections).toEqual([
      { player: 'ann', card: 3 },
      { player: 'bob', card: 17 },
    ]);
    // Choosing again replaces the choice, and two guessers may choose the same card.
    state = accepted(select(state, ann, { ...now(state), card: 17 }));
    expect(state.selections).toEqual([
      { player: 'bob', card: 17 },
      { player: 'ann', card: 17 },
    ]);
    expect(state).toMatchObject({ phase: 'guess', guessesMade: 0, team: 'red', turn: 1 });
    expect(state.cards.every((card) => !card.revealed)).toBe(true);
  });

  test('can be taken back', () => {
    let state = clued();
    state = accepted(select(state, ann, { ...now(state), card: 3 }));
    state = accepted(select(state, bob, { ...now(state), card: 4 }));
    state = accepted(select(state, ann, { ...now(state), card: null }));
    expect(state.selections).toEqual([{ player: 'bob', card: 4 }]);
    // Taking back nothing is fine too, and changes nothing, like choosing the same card again.
    expect(accepted(select(state, ann, { ...now(state), card: null }))).toBe(state);
    expect(accepted(select(state, bob, { ...now(state), card: 4 }))).toBe(state);
  });

  test("is only for the current team's guessers, after the clue", () => {
    const before = gameState();
    expect(refused(select(before, ann, { ...now(before), card: 0 }))).toBe('wrong_phase');
    const state = clued();
    expect(refused(select(state, guesser('blue'), { ...now(state), card: 0 }))).toBe('not_your_turn');
    expect(refused(select(state, captain('red'), { ...now(state), card: 0 }))).toBe('not_guesser');
    expect(refused(select(state, spectator, { ...now(state), card: 0 }))).toBe('not_your_turn');
    expect(refused(select(state, ann, { gameId: 'game-1', turn: 2, card: 0 }))).toBe('stale');
    expect(refused(select(state, ann, { gameId: 'other', turn: 1, card: null }))).toBe('stale');
    const over = accepted(withdraw(state, now(state)));
    expect(refused(select(over, ann, { ...now(over), card: 0 }))).toBe('game_over');
  });

  test('needs a card that exists and has not been revealed', () => {
    const state = revealAll(clued(), [0]);
    for (const card of [-1, 25, 1.5, Number.NaN]) {
      expect(refused(select(state, ann, { ...now(state), card })), String(card)).toBe('no_such_card');
    }
    expect(refused(select(state, ann, { ...now(state), card: 0 }))).toBe('card_revealed');
  });

  test('is cleared for everyone when a card is revealed, and when the turn or the game ends', () => {
    let state = clued(3);
    const choose = (current: KeywordsState) => {
      const one = accepted(select(current, ann, { ...now(current), card: 5 }));
      return accepted(select(one, bob, { ...now(one), card: 6 }));
    };
    state = revealAll(choose(state), [0]);
    expect(state).toMatchObject({ phase: 'guess', selections: [] });
    expect(accepted(pass(choose(state), ann, now(state), 0))).toMatchObject({ phase: 'clue', selections: [] });
    expect(revealAll(choose(state), [17])).toMatchObject({ phase: 'clue', selections: [] });
    expect(revealAll(choose(state), [24])).toMatchObject({ phase: 'over', selections: [] });
    expect(accepted(withdraw(choose(state), now(state)))).toMatchObject({ phase: 'over', selections: [] });
  });

  test('goes with a guesser who leaves their seat', () => {
    let state = clued();
    state = accepted(select(state, ann, { ...now(state), card: 3 }));
    state = accepted(select(state, bob, { ...now(state), card: 4 }));
    expect(dropSelection(state, 'ann').selections).toEqual([{ player: 'bob', card: 4 }]);
    // Nothing changes for a player who has chosen nothing.
    expect(dropSelection(state, 'cat')).toBe(state);
  });
});

describe('marking cards', () => {
  const ann = guesser('red', 'ann');
  const bob = guesser('red', 'bob');
  const dan = guesser('blue', 'dan');
  const game = (state: KeywordsState) => ({ gameId: state.gameId });

  test('keeps one mark a card for each group, set and changed by any of its guessers', () => {
    let state = clued();
    state = accepted(mark(state, ann, { ...game(state), card: 3, mark: 'ours' }));
    state = accepted(mark(state, bob, { ...game(state), card: 17, mark: 'theirs' }));
    state = accepted(mark(state, dan, { ...game(state), card: 3, mark: 'r2' }));
    expect(state.marks).toEqual({
      red: [
        { card: 3, mark: 'ours' },
        { card: 17, mark: 'theirs' },
      ],
      blue: [{ card: 3, mark: 'r2' }],
    });
    // Bob changes Ann's mark: the last one stands.
    state = accepted(mark(state, bob, { ...game(state), card: 3, mark: 'r2' }));
    expect(state.marks.red).toEqual([
      { card: 17, mark: 'theirs' },
      { card: 3, mark: 'r2' },
    ]);
    // Nothing else changes, not even the choices.
    expect(state).toMatchObject({ phase: 'guess', guessesMade: 0, selections: [] });
  });

  test('can be cleared, and changes nothing when it is there already', () => {
    let state = clued();
    state = accepted(mark(state, ann, { ...game(state), card: 3, mark: 'ours' }));
    expect(accepted(mark(state, bob, { ...game(state), card: 3, mark: 'ours' }))).toBe(state);
    expect(accepted(mark(state, bob, { ...game(state), card: 4, mark: null }))).toBe(state);
    state = accepted(mark(state, bob, { ...game(state), card: 3, mark: null }));
    expect(state.marks.red).toEqual([]);
  });

  test("comes in either group's turn and phase, but not from a captain or a spectator", () => {
    const before = gameState();
    expect(accepted(mark(before, dan, { ...game(before), card: 0, mark: 'theirs' })).marks.blue).toHaveLength(1);
    const state = clued();
    expect(accepted(mark(state, dan, { ...game(state), card: 0, mark: 'theirs' })).marks.blue).toHaveLength(1);
    expect(refused(mark(state, captain('red'), { ...game(state), card: 0, mark: 'ours' }))).toBe('not_guesser');
    expect(refused(mark(state, spectator, { ...game(state), card: 0, mark: 'ours' }))).toBe('not_guesser');
  });

  test('checks the game, its end and a pause before the player, and the card last', () => {
    const state = revealAll(clued(), [0]);
    expect(refused(mark(state, captain('red'), { gameId: 'other', card: 99, mark: 'ours' }))).toBe('stale');
    const paused = accepted(pause(state, true, game(state), 0));
    expect(refused(mark(paused, captain('red'), { ...game(paused), card: 99, mark: 'ours' }))).toBe('paused');
    const over = accepted(withdraw(state, now(state)));
    expect(refused(mark(over, captain('red'), { ...game(over), card: 99, mark: 'ours' }))).toBe('game_over');
    for (const card of [-1, 25, 1.5, Number.NaN]) {
      expect(refused(mark(state, ann, { ...game(state), card, mark: 'ours' })), String(card)).toBe('no_such_card');
    }
    expect(refused(mark(state, ann, { ...game(state), card: 0, mark: 'ours' }))).toBe('card_revealed');
  });

  test("goes from a card once it is revealed, both groups' marks, and stays on the others", () => {
    let state = clued(3);
    state = accepted(mark(state, ann, { ...game(state), card: 0, mark: 'ours' }));
    state = accepted(mark(state, ann, { ...game(state), card: 5, mark: 'theirs' }));
    state = accepted(mark(state, dan, { ...game(state), card: 0, mark: 'theirs' }));
    state = revealAll(state, [0]);
    expect(state.marks).toEqual({ red: [{ card: 5, mark: 'theirs' }], blue: [] });
    // A turn that ends leaves them be.
    state = accepted(pass(state, ann, now(state), 0));
    expect(state).toMatchObject({ phase: 'clue', team: 'blue', marks: { red: [{ card: 5, mark: 'theirs' }] } });
  });
});

describe('the group chat', () => {
  const ann = guesser('red', 'ann');
  const dan = guesser('blue', 'dan');
  const said = (state: KeywordsState, actor = ann, text = 'Hello') => say(state, actor, { gameId: state.gameId, text });

  test("keeps each group's messages apart, in order, with the turn they were written in", () => {
    let state = gameState();
    state = accepted(said(state, ann, '  Is it  the\nthird one? '));
    state = accepted(said(state, dan, 'They are stuck.'));
    state = revealAll(clued(1, state), [17]);
    state = accepted(said(state, guesser('red', 'bob'), 'Sorry!'));
    expect(state.chat).toEqual({
      red: [
        { id: 1, player: 'ann', turn: 1, text: 'Is it the third one?' },
        { id: 2, player: 'bob', turn: 2, text: 'Sorry!' },
      ],
      blue: [{ id: 1, player: 'dan', turn: 1, text: 'They are stuck.' }],
    });
  });

  test("is open to guessers in either team's turn and in either phase", () => {
    const guessing = clued();
    for (const state of [gameState(), guessing]) {
      expect(refused(said(state, ann))).toBeNull();
      expect(refused(said(state, dan))).toBeNull();
    }
  });

  test('is closed to captains and spectators: a captain may only give the clue', () => {
    const state = gameState();
    expect(refused(said(state, captain('red')))).toBe('not_guesser');
    expect(refused(said(state, captain('blue')))).toBe('not_guesser');
    expect(refused(said(state, spectator))).toBe('not_guesser');
  });

  test('refuses a message for another game', () => {
    const state = gameState();
    expect(refused(say(state, ann, { gameId: 'other', text: 'Hello' }))).toBe('stale');
    const over = accepted(withdraw(state, now(state)));
    expect(refused(say(over, ann, { gameId: 'other', text: 'Hello' }, 'red'))).toBe('stale');
  });

  test('stays open once the game is over to whoever played for the group, its PI too, marked as after it', () => {
    let over = accepted(withdraw(accepted(said(gameState())), now(gameState())));
    const after = (actor: Actor, side: Team | null, text = 'gg') =>
      say(over, actor, { gameId: over.gameId, text }, side);
    over = accepted(after(ann, 'red'));
    over = accepted(after(captain('red'), 'red', 'Well played'));
    expect(over.chat.red).toEqual([
      { id: 1, player: 'ann', turn: 1, text: 'Hello' },
      { id: 2, player: 'ann', turn: 1, text: 'gg', after: true },
      { id: 3, player: 'red-captain', turn: 1, text: 'Well played', after: true },
    ]);
    // Nobody who didn't play for the group, such as someone who sat down in it after the end, nor
    // anyone who only watched.
    expect(refused(after(ann, null))).toBe('game_over');
    expect(refused(after(guesser('red', 'eve'), 'blue'))).toBe('game_over');
    expect(refused(after(spectator, null))).toBe('game_over');
    expect(refused(after(ann, 'red', ' '))).toBe('chat_empty');
  });

  test('refuses empty and overlong messages, after the checks on the player', () => {
    const state = gameState();
    expect(refused(said(state, ann, ' \n '))).toBe('chat_empty');
    expect(refused(said(state, ann, 'x'.repeat(MAX_CHAT_LENGTH + 1)))).toBe('chat_too_long');
    expect(refused(said(state, ann, 'x'.repeat(MAX_CHAT_LENGTH)))).toBeNull();
    expect(refused(said(state, captain('red'), ''))).toBe('not_guesser');
    expect(refused(said(state, ann, null as unknown as string))).toBe('chat_empty');
  });

  test('keeps only the latest messages of a group, and goes on counting', () => {
    let state = gameState();
    for (let i = 1; i <= CHAT_KEPT + 5; i += 1) state = accepted(said(state, ann, `Message ${i}`));
    expect(state.chat.red).toHaveLength(CHAT_KEPT);
    expect(state.chat.red[0]).toMatchObject({ id: 6, text: 'Message 6' });
    expect(state.chat.red.at(-1)).toMatchObject({ id: CHAT_KEPT + 5, text: `Message ${CHAT_KEPT + 5}` });
    expect(state.chat.blue).toEqual([]);
  });

  test('survives the turns of a game, and starts empty in the next one', () => {
    let state = accepted(said(gameState()));
    state = revealAll(clued(1, state), [17]);
    expect(state.chat.red).toHaveLength(1);
    expect(newGame(WORDS, seededRng(1), setup('next'), 0).chat).toEqual({ red: [], blue: [] });
  });
});

describe('passing', () => {
  test('needs at least one guess first', () => {
    const state = clued();
    expect(refused(pass(state, guesser('red'), now(state), 0))).toBe('must_guess_first');
    const after = revealAll(state, [0]);
    expect(accepted(pass(after, guesser('red'), now(after), 0))).toMatchObject({
      team: 'blue',
      turn: 2,
      phase: 'clue',
    });
  });

  test("is only for the current team's guessers", () => {
    const state = revealAll(clued(), [0]);
    expect(refused(pass(state, captain('red'), now(state), 0))).toBe('not_guesser');
    expect(refused(pass(state, guesser('blue'), now(state), 0))).toBe('not_your_turn');
    expect(refused(pass(gameState(), guesser('red'), now(gameState()), 0))).toBe('wrong_phase');
  });

  test('from an earlier turn is stale', () => {
    const state = revealAll(clued(), [0]);
    const moment = now(state);
    const next = accepted(pass(state, guesser('red'), moment, 0));
    expect(refused(pass(next, guesser('red'), moment, 0))).toBe('stale');
  });
});

describe('withdrawing', () => {
  test('ends the game without a winner, in any phase and whatever the turn', () => {
    for (const state of [gameState(), clued(), revealAll(clued(), [17])]) {
      const over = accepted(withdraw(state, { gameId: state.gameId }));
      expect(over.phase).toBe('over');
      expect(over.clue).toBeNull();
      expect(over.result).toEqual({ winner: null, reason: 'withdrawn' });
    }
  });

  test('is refused once the game is over', () => {
    const finished = revealAll(clued(), [24]);
    expect(refused(withdraw(finished, now(finished)))).toBe('game_over');
    const withdrawn = accepted(withdraw(clued(), now(clued())));
    expect(refused(withdraw(withdrawn, now(withdrawn)))).toBe('game_over');
  });

  test('meant for another game is stale', () => {
    const next = gameState({ gameId: 'game-2' });
    expect(refused(withdraw(next, { gameId: 'game-1' }))).toBe('stale');
    expect(refused(withdraw(revealAll(clued(), [24]), { gameId: 'game-0' }))).toBe('stale');
  });
});

describe('the free guess rule', () => {
  const free = (overrides: Partial<KeywordsState> = {}) =>
    gameState({ settings: { ...STANDARD, guessRule: 'free' }, ...overrides });

  test('takes a number from 1 to the cards the group has left, and nothing else', () => {
    const state = free();
    const count = (value: ClueCount) =>
      refused(giveClue(state, captain('red'), { ...now(state), word: 'Gradient', count: value }, 0));
    for (const value of [1, 5, 9] as const) expect(count(value), String(value)).toBeNull();
    for (const value of [0, 10, 1.5, 'unlimited'] as const) expect(count(value), String(value)).toBe('bad_count');
    // With three red cards left, 3 is the most.
    const fewer = free({ cards: state.cards.map((card, i) => ({ ...card, revealed: i < 6 })) });
    const late = (value: number) =>
      refused(giveClue(fewer, captain('red'), { ...now(fewer), word: 'Gradient', count: value }, 0));
    expect(late(3)).toBeNull();
    expect(late(4)).toBe('bad_count');
  });

  test('lets the group go on for as long as it finds its own cards, whatever the number', () => {
    let state = clued(1, free());
    expect(guessesLeft(state)).toBeNull();
    state = revealAll(state, [0, 1, 2, 3, 4]);
    expect(state).toMatchObject({ team: 'red', phase: 'guess', guessesMade: 5 });
    expect(guessesLeft(state)).toBeNull();
    expect(revealAll(state, [17])).toMatchObject({ team: 'blue', phase: 'clue' });
    expect(revealAll(state, [9])).toMatchObject({ team: 'blue', phase: 'clue' });
    expect(revealAll(state, [24]).result).toEqual({ winner: 'blue', reason: 'reviewer2' });
    expect(revealAll(state, [5, 6, 7, 8]).result).toEqual({ winner: 'red', reason: 'found' });
  });

  test('still needs a card revealed before the group may end its turn', () => {
    const state = clued(2, free());
    expect(refused(pass(state, guesser('red'), now(state), 0))).toBe('must_guess_first');
    const after = revealAll(state, [0]);
    expect(accepted(pass(after, guesser('red'), now(after), 0))).toMatchObject({ team: 'blue', phase: 'clue' });
  });
});

describe('the clock', () => {
  const TIMED = { ...STANDARD, firstClueTime: 90, clueTime: 60, guessTime: 30 };
  const timed = (at = 1000) => newGame(WORDS, seededRng(3), setup('timed', TIMED), at);
  const team = (state: KeywordsState) => state.team;
  const clue = (state: KeywordsState, at: number) =>
    accepted(giveClue(state, captain(team(state)), { ...now(state), word: 'Gradient', count: 'unlimited' }, at));

  test('gives the first clue of a game its own time, and every later clue and guess phase theirs', () => {
    let state = timed(1000);
    expect(state.clock).toEqual({ ends: 91_000, length: 90_000 });
    state = clue(state, 5000);
    expect(state.clock).toEqual({ ends: 35_000, length: 30_000 });
    const own = state.cards.findIndex((card) => card.color === state.team);
    state = accepted(reveal(state, guesser(state.team), { ...now(state), card: own }, 6000));
    // Revealing a card of one's own doesn't give the group more time.
    expect(state.clock).toEqual({ ends: 35_000, length: 30_000 });
    state = accepted(pass(state, guesser(state.team), now(state), 7000));
    expect(state.clock).toEqual({ ends: 67_000, length: 60_000 });
  });

  test('has no time limit where the settings say 0', () => {
    const state = newGame(WORDS, seededRng(3), setup('untimed', { ...TIMED, firstClueTime: 0, guessTime: 0 }), 0);
    expect(state.clock).toBeNull();
    const guessing = clue(state, 10);
    expect(guessing.clock).toBeNull();
    expect(expire(guessing, Number.MAX_SAFE_INTEGER)).toBe(guessing);
  });

  test('stops when the game ends', () => {
    const state = timed();
    expect(accepted(withdraw(state, now(state))).clock).toBeNull();
    const guessing = clue(state, 2000);
    const r2 = guessing.cards.findIndex((card) => card.color === 'reviewer2');
    expect(accepted(reveal(guessing, guesser(guessing.team), { ...now(guessing), card: r2 }, 3000)).clock).toBeNull();
  });

  test('changes nothing before its time', () => {
    const state = timed(1000);
    expect(expire(state, 90_999)).toBe(state);
  });

  test('ends a clue phase whose time has run out, with a turn without a clue on record', () => {
    const state = timed(1000);
    const next = expire(state, 91_000);
    expect(next).toMatchObject({ turn: 2, team: otherTeam(state.team), phase: 'clue', clue: null });
    expect(next.clock).toEqual({ ends: 151_000, length: 60_000 });
    // The time is counted from the start of the game.
    expect(next.history).toEqual([
      { turn: 1, team: state.team, word: null, count: null, guesses: [], timedOut: true, at: 90_000 },
    ]);
  });

  test('ends a guess phase whose time has run out, also when nothing was revealed', () => {
    let state = clue(timed(), 2000);
    const choice = state.cards.findIndex((card) => card.color === state.team);
    state = accepted(select(state, guesser(state.team), { ...now(state), card: choice }));
    const next = expire(state, 32_000);
    expect(next).toMatchObject({ turn: 2, team: otherTeam(state.team), phase: 'clue', guessesMade: 0, selections: [] });
    expect(next.history).toEqual([
      {
        turn: 1,
        team: state.team,
        word: 'Gradient',
        count: 'unlimited',
        guesses: [],
        timedOut: true,
        captain: `${state.team}-captain`,
        at: 1000,
      },
    ]);
  });

  test('makes an action meant for the turn that ran out stale', () => {
    const state = clue(timed(), 2000);
    const moment = now(state);
    const next = expire(state, 40_000);
    const own = state.cards.findIndex((card) => card.color === state.team);
    expect(refused(reveal(next, guesser(state.team), { ...moment, card: own }, 40_000))).toBe('stale');
    expect(refused(pass(next, guesser(state.team), moment, 40_000))).toBe('stale');
  });

  test('is left alone once the game is over', () => {
    const over = accepted(withdraw(timed(), { gameId: 'timed' }));
    expect(expire(over, Number.MAX_SAFE_INTEGER)).toBe(over);
  });
});

describe('deadline heroes', () => {
  const TIMED = { ...STANDARD, firstClueTime: 90, clueTime: 60, guessTime: 30 };
  // A game that starts at 0: the first clue is due at 90 s, and the guesses 30 s after the clue.
  const timed = (settings = TIMED) => newGame(WORDS, seededRng(3), setup('timed', settings), 0);
  const clue = (state: KeywordsState, at: number) =>
    accepted(giveClue(state, captain(state.team), { ...now(state), word: 'Gradient', count: 'unlimited' }, at));
  const flip = (
    state: KeywordsState,
    color: CardColor,
    at: number,
    who = guesser(state.team),
    heroes?: (playerId: string) => number | null,
  ) => {
    const card = state.cards.findIndex((found) => found.color === color && !found.revealed);
    return accepted(reveal(state, who, { ...now(state), card }, at, heroes));
  };
  const hailed = (state: KeywordsState) => state.events.filter(({ kind }) => kind === 'hero');

  test('come from a clue or a guess in the last 3 seconds of its time, and from none without a time limit', () => {
    let state = clue(timed(), 87_000);
    expect(state.history[0]?.lastSeconds).toBe(true);
    expect(clue(timed(), 86_999).history[0]).not.toHaveProperty('lastSeconds');
    // The guesses are due at 117 s.
    state = flip(state, state.team, 113_999);
    state = flip(state, state.team, 114_000);
    expect(state.history[0]?.guesses.map((guess) => guess.lastSeconds)).toEqual([undefined, true]);
    const untimed = timed({ ...TIMED, firstClueTime: 0, guessTime: 0 });
    const record = flip(clue(untimed, 1_000_000), untimed.team, 2_000_000).history[0];
    expect(record).not.toHaveProperty('lastSeconds');
    expect(record?.guesses[0]).not.toHaveProperty('lastSeconds');
  });

  test("make the PI one with the first of the group's cards that a last-second clue finds, once a turn", () => {
    let state = clue(timed(), 88_000);
    const team = state.team;
    const before = new Map([[`${team}-captain`, 2]]);
    state = flip(state, team, 100_000, guesser(team), (player) => before.get(player) ?? null);
    expect(hailed(state)).toEqual([{ turn: 1, kind: 'hero', team, player: `${team}-captain`, count: 3 }]);
    state = flip(state, team, 101_000);
    expect(hailed(state)).toHaveLength(1);
    expect(heroesOf(state.history[0] as ClueRecord)).toEqual(new Set([`${team}-captain`]));
    // A last-second clue that finds nothing of the group's makes nobody a hero; nor does a clue in time.
    const wrong = flip(clue(timed(), 88_000), otherTeam(team), 100_000);
    expect(hailed(wrong)).toEqual([]);
    expect(heroesOf(wrong.history[0] as ClueRecord).size).toBe(0);
    expect(hailed(flip(clue(timed(), 80_000), team, 100_000))).toEqual([]);
  });

  test("make a student one with a card of the group's in the last seconds of the guesses, once a turn", () => {
    let state = clue(timed(), 10_000);
    const team = state.team;
    // The guesses are due at 40 s. A guest, or anyone in a game that counts no titles, has no count.
    state = flip(state, team, 37_500, guesser(team, 'ann'));
    expect(hailed(state)).toEqual([{ turn: 1, kind: 'hero', team, player: 'ann' }]);
    state = flip(state, team, 38_000, guesser(team, 'ann'));
    state = flip(state, team, 39_000, guesser(team, 'bob'), () => 0);
    expect(hailed(state)).toEqual([
      { turn: 1, kind: 'hero', team, player: 'ann' },
      { turn: 1, kind: 'hero', team, player: 'bob', count: 1 },
    ]);
    // A card of the other group's in the last seconds makes nobody a hero, and ends the turn.
    const other = flip(clue(timed(), 10_000), otherTeam(team), 39_000);
    expect(hailed(other)).toEqual([]);
  });
});

describe('a pause', () => {
  const TIMED = { ...STANDARD, firstClueTime: 90, clueTime: 60, guessTime: 30 };
  const timed = (at = 1000) => newGame(WORDS, seededRng(3), setup('timed', TIMED), at);
  const game = (state: KeywordsState) => ({ gameId: state.gameId });
  const own = (state: KeywordsState) => state.cards.findIndex((card) => card.color === state.team);

  test('stops the clock with the time the phase has left, and notes itself in the log', () => {
    const state = timed(1000);
    const paused = accepted(pause(state, true, game(state), 31_000));
    expect(paused.pause).toEqual({ left: 60_000 });
    expect(paused.events).toEqual([{ turn: 1, kind: 'paused' }]);
    // Time passes; nothing ends.
    expect(expire(paused, 200_000)).toBe(paused);
    const resumed = accepted(resume(paused, true, game(paused), 500_000));
    expect(resumed.pause).toBeNull();
    expect(resumed.clock).toEqual({ ends: 560_000, length: 90_000 });
    expect(resumed.events).toEqual([
      { turn: 1, kind: 'paused' },
      { turn: 1, kind: 'resumed' },
    ]);
    expect(expire(resumed, 559_999)).toBe(resumed);
    expect(expire(resumed, 560_000).turn).toBe(2);
  });

  test('leaves a phase without a time limit without one', () => {
    const state = gameState();
    const paused = accepted(pause(state, true, game(state), 5));
    expect(paused.pause).toEqual({ left: null });
    expect(accepted(resume(paused, true, game(paused), 9)).clock).toBeNull();
  });

  test('refuses every action but the chat, in the order of the checks', () => {
    let state = clued(2);
    state = accepted(select(state, guesser('red'), { ...now(state), card: 3 }));
    const paused = accepted(pause(state, true, game(state), 0));
    // The choices stay as they were.
    expect(paused.selections).toEqual([{ player: 'red-guesser', card: 3 }]);
    expect(refused(reveal(paused, guesser('red'), { ...now(paused), card: 0 }, 0))).toBe('paused');
    expect(refused(select(paused, guesser('red'), { ...now(paused), card: 1 }))).toBe('paused');
    expect(refused(select(paused, guesser('red'), { ...now(paused), card: null }))).toBe('paused');
    expect(refused(pass(paused, guesser('red'), now(paused), 0))).toBe('paused');
    expect(refused(giveClue(paused, captain('blue'), { ...now(paused), word: 'Loss', count: 1 }, 0))).toBe('paused');
    expect(refused(extend(paused, guesser('red'), now(paused)))).toBe('paused');
    // A stale action is stale first; a message to the group goes through.
    expect(refused(reveal(paused, guesser('red'), { gameId: 'other', turn: 1, card: 0 }, 0))).toBe('stale');
    expect(refused(say(paused, guesser('red'), { gameId: paused.gameId, text: 'Tea?' }))).toBeNull();
    // Once resumed, the turn goes on as it was.
    const resumed = accepted(resume(paused, true, game(paused), 0));
    expect(resumed.selections).toEqual([{ player: 'red-guesser', card: 3 }]);
    expect(refused(reveal(resumed, guesser('red'), { ...now(resumed), card: 0 }, 0))).toBeNull();
  });

  test('is for the chair alone, once at a time, and for a game that is on', () => {
    const state = gameState();
    expect(refused(pause(state, false, game(state), 0))).toBe('not_chair');
    expect(refused(pause(state, true, { gameId: 'other' }, 0))).toBe('stale');
    expect(refused(resume(state, true, game(state), 0))).toBe('not_paused');
    const paused = accepted(pause(state, true, game(state), 0));
    expect(refused(pause(paused, true, game(paused), 0))).toBe('paused');
    expect(refused(resume(paused, false, game(paused), 0))).toBe('not_chair');
    const over = accepted(withdraw(state, game(state)));
    expect(refused(pause(over, true, game(over), 0))).toBe('game_over');
    // The chair may withdraw a paused game, which ends the pause with the game.
    const withdrawn = accepted(withdraw(paused, game(paused)));
    expect(withdrawn.result).toEqual({ winner: null, reason: 'withdrawn' });
    expect(withdrawn.pause).toBeNull();
  });

  test('keeps the last events only, however often the chair pauses and resumes', () => {
    let state = gameState();
    for (let i = 0; i < EVENTS_KEPT; i += 1) {
      state = accepted(pause(state, true, game(state), i));
      state = accepted(resume(state, true, game(state), i));
    }
    expect(state.events).toHaveLength(EVENTS_KEPT);
    expect(state.events.at(-1)).toEqual({ turn: 1, kind: 'resumed' });
  });

  test('keeps a reveal that came before it from being stale afterwards', () => {
    const state = timed();
    const clue = accepted(giveClue(state, captain(state.team), { ...now(state), word: 'Gradient', count: 1 }, 2000));
    const paused = accepted(pause(clue, true, game(clue), 10_000));
    const resumed = accepted(resume(paused, true, game(paused), 90_000));
    expect(refused(reveal(resumed, guesser(resumed.team), { ...now(resumed), card: own(resumed) }, 91_000))).toBeNull();
  });
});

describe('an extension', () => {
  const TIMED = { ...STANDARD, firstClueTime: 90, clueTime: 60, guessTime: 30, extensions: true };
  const timed = (at = 1000) => newGame(WORDS, seededRng(3), setup('timed', TIMED), at);

  test('adds 30 seconds to the phase, once for each group, and names the group in the log', () => {
    const state = timed(1000);
    const team = state.team;
    const extended = accepted(extend(state, captain(team), now(state)));
    expect(extended.clock).toEqual({ ends: 121_000, length: 120_000 });
    expect(extended.extended).toEqual({ ...{ red: false, blue: false }, [team]: true });
    expect(extended.events).toEqual([{ turn: 1, kind: 'extended', team }]);
    expect(refused(extend(extended, captain(team), now(extended)))).toBe('extension_used');
    // The other group has its own, in its turn.
    const next = expire(extended, 121_000);
    expect(next.turn).toBe(2);
    expect(refused(extend(next, captain(team), now(next)))).toBe('not_your_turn');
    expect(accepted(extend(next, captain(next.team), now(next))).clock).toEqual({ ends: 211_000, length: 90_000 });
  });

  test('is asked for by the captain in the clue phase and by a guesser in the guess phase', () => {
    const state = timed(1000);
    expect(refused(extend(state, guesser(state.team), now(state)))).toBe('not_captain');
    const clued = accepted(giveClue(state, captain(state.team), { ...now(state), word: 'Gradient', count: 1 }, 2000));
    expect(refused(extend(clued, captain(clued.team), now(clued)))).toBe('not_guesser');
    expect(accepted(extend(clued, guesser(clued.team), now(clued))).clock).toEqual({ ends: 62_000, length: 60_000 });
    expect(refused(extend(clued, spectator, now(clued)))).toBe('not_your_turn');
    expect(refused(extend(clued, guesser(clued.team), { gameId: clued.gameId, turn: 9 }))).toBe('stale');
  });

  test('is refused where the settings leave it out, or the phase has no time limit', () => {
    const off = newGame(WORDS, seededRng(3), setup('off', { ...TIMED, extensions: false }), 0);
    expect(refused(extend(off, captain(off.team), now(off)))).toBe('no_extension');
    const untimed = newGame(WORDS, seededRng(3), setup('untimed', { ...TIMED, firstClueTime: 0 }), 0);
    expect(refused(extend(untimed, captain(untimed.team), now(untimed)))).toBe('no_extension');
  });
});

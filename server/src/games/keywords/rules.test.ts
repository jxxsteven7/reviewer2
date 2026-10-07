import { CHAT_KEPT, MAX_CHAT_LENGTH } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import { seededRng } from '../../core/random';
import { dropSelection, giveClue, newGame, pass, reveal, say, select, withdraw } from './rules';
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
    expect(state.selections).toEqual([]);
    expect(state.chat).toEqual({ red: [], blue: [] });
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
    const over = accepted(withdraw(gameState(), now(gameState())));
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
    expect(word(42 as unknown as string)).toBe('clue_empty');
  });

  test("refuses a card's translation as a clue", () => {
    const state = gameState();
    const cards = state.cards.map((card, i) => (i === 3 ? { ...card, translations: ['Entropie'] } : card));
    const translated = { ...state, cards };
    const clue = { ...now(state), word: 'entropie', count: 1 };
    expect(refused(giveClue(translated, captain('red'), clue))).toBe('clue_on_board');
    expect(refused(giveClue(state, captain('red'), clue))).toBeNull();
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
    expect(accepted(pass(choose(state), ann, now(state)))).toMatchObject({ phase: 'clue', selections: [] });
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

  test('refuses a message for another game, and any message once the game is over', () => {
    const state = gameState();
    expect(refused(say(state, ann, { gameId: 'other', text: 'Hello' }))).toBe('stale');
    const over = accepted(withdraw(state, now(state)));
    expect(refused(said(over))).toBe('game_over');
    expect(refused(say(over, ann, { gameId: 'other', text: 'Hello' }))).toBe('stale');
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
    expect(newGame(WORDS, seededRng(1), 'next').chat).toEqual({ red: [], blue: [] });
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

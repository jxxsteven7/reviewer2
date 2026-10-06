import { describe, expect, test } from 'vitest';
import { giveClue, reveal, withdraw } from './rules';
import { accepted, captain, gameState, guesser, now } from './testing';
import { viewFor } from './view';

const playing = () => {
  const start = gameState();
  const clued = accepted(giveClue(start, captain('red'), { ...now(start), word: 'Gradient', count: 2 }));
  return accepted(reveal(clued, guesser('red'), { ...now(clued), card: 0 }));
};

describe('what each player sees', () => {
  test('the public view has no color at all for unrevealed cards', () => {
    const view = viewFor(playing(), 'public');
    expect(view.cards[0]).toEqual({ word: 'Word0', revealed: true, color: 'red' });
    for (const card of view.cards.slice(1)) {
      expect(card.revealed).toBe(false);
      expect(Object.keys(card)).toEqual(['word', 'revealed']);
    }
    expect(JSON.stringify(view.cards.slice(1))).not.toMatch(/color|red|blue|neutral|reviewer2/);
  });

  test('the key view shows every color', () => {
    const view = viewFor(playing(), 'key');
    expect(view.cards.every((card) => card.color !== undefined)).toBe(true);
    expect(view.cards[24]).toEqual({ word: 'Word24', revealed: false, color: 'reviewer2' });
  });

  test('everyone sees every color once the game is over', () => {
    const view = viewFor(withdraw(playing()), 'public');
    expect(view.cards.every((card) => card.color !== undefined)).toBe(true);
    expect(view.result).toEqual({ winner: null, reason: 'withdrawn' });
  });

  test("every view carries a card's translations, which are no secret", () => {
    const state = playing();
    state.cards = state.cards.map((card, i) => (i === 5 ? { ...card, translations: ['Other5'] } : card));
    for (const sees of ['public', 'key'] as const) {
      const view = viewFor(state, sees);
      expect(view.cards[5]?.translations).toEqual(['Other5']);
      expect(view.cards.filter((card) => 'translations' in card)).toHaveLength(1);
    }
  });

  test('both views share the public facts of the game', () => {
    const state = playing();
    const shared = { turn: 1, team: 'red', phase: 'guess', startingTeam: 'red', guessesMade: 1, guessesLeft: 2 };
    for (const sees of ['public', 'key'] as const) {
      const view = viewFor(state, sees);
      expect(view).toMatchObject(shared);
      expect(view.clue).toEqual({ word: 'Gradient', count: 2 });
      expect(view.remaining).toEqual({ red: 8, blue: 8 });
      expect(view.history).toEqual([
        { turn: 1, team: 'red', word: 'Gradient', count: 2, guesses: [{ card: 0, color: 'red' }] },
      ]);
    }
  });

  test('a view is a copy that cannot change the game', () => {
    const state = playing();
    const view = viewFor(state, 'key');
    view.history[0]?.guesses.push({ card: 5, color: 'red' });
    if (view.clue) view.clue.word = 'changed';
    expect(state.history[0]?.guesses).toHaveLength(1);
    expect(state.clue?.word).toBe('Gradient');
  });
});

import { SPECTATOR, type Seat } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import { giveClue, reveal, say, select, withdraw } from './rules';
import type { KeywordsState } from './state';
import { accepted, captain, gameState, guesser, now } from './testing';
import { viewFor } from './view';

const redCaptain: Seat = { team: 'red', role: 'captain' };
const blueCaptain: Seat = { team: 'blue', role: 'captain' };
const redGuesser: Seat = { team: 'red', role: 'guesser' };
const blueGuesser: Seat = { team: 'blue', role: 'guesser' };
const SEATS = { redCaptain, redGuesser, blueCaptain, blueGuesser, spectator: SPECTATOR };

// Red has been given a clue and has revealed one of its cards.
const playing = () => {
  const start = gameState();
  const clued = accepted(giveClue(start, captain('red'), { ...now(start), word: 'Gradient', count: 2 }));
  return accepted(reveal(clued, guesser('red'), { ...now(clued), card: 0 }));
};

// The same game with a card chosen by each of two red guessers, and a message in each group.
const talking = () => {
  let state = playing();
  state = accepted(select(state, guesser('red', 'ann'), { ...now(state), card: 3 }));
  state = accepted(select(state, guesser('red', 'bob'), { ...now(state), card: 17 }));
  state = accepted(say(state, guesser('red', 'ann'), { gameId: state.gameId, text: 'The third one?' }));
  return accepted(say(state, guesser('blue', 'dan'), { gameId: state.gameId, text: 'They are stuck.' }));
};

describe('what each player sees of the cards', () => {
  test('everyone but a captain gets no color at all for unrevealed cards', () => {
    for (const seat of [redGuesser, blueGuesser, SPECTATOR]) {
      const view = viewFor(playing(), seat);
      expect(view.cards[0]).toEqual({ word: 'Word0', revealed: true, color: 'red' });
      for (const card of view.cards.slice(1)) {
        expect(card.revealed).toBe(false);
        expect(Object.keys(card)).toEqual(['word', 'revealed']);
      }
      expect(JSON.stringify(view.cards.slice(1))).not.toMatch(/color|red|blue|neutral|reviewer2/);
    }
  });

  test('both captains see every color', () => {
    for (const seat of [redCaptain, blueCaptain]) {
      const view = viewFor(playing(), seat);
      expect(view.cards.every((card) => card.color !== undefined)).toBe(true);
      expect(view.cards[24]).toEqual({ word: 'Word24', revealed: false, color: 'reviewer2' });
    }
  });

  test('everyone sees every color once the game is over', () => {
    const view = viewFor(accepted(withdraw(playing(), { gameId: 'game-1' })), SPECTATOR);
    expect(view.cards.every((card) => card.color !== undefined)).toBe(true);
    expect(view.result).toEqual({ winner: null, reason: 'withdrawn' });
  });

  test("every view carries a card's translations, which are no secret", () => {
    const state = playing();
    state.cards = state.cards.map((card, i) => (i === 5 ? { ...card, translations: ['Other5'] } : card));
    for (const seat of Object.values(SEATS)) {
      const view = viewFor(state, seat);
      expect(view.cards[5]?.translations).toEqual(['Other5']);
      expect(view.cards.filter((card) => 'translations' in card)).toHaveLength(1);
    }
  });

  test('all views share the public facts of the game', () => {
    const state = talking();
    const shared = { turn: 1, team: 'red', phase: 'guess', startingTeam: 'red', guessesMade: 1, guessesLeft: 2 };
    for (const seat of Object.values(SEATS)) {
      const view = viewFor(state, seat);
      expect(view).toMatchObject(shared);
      expect(view.clue).toEqual({ word: 'Gradient', count: 2 });
      expect(view.remaining).toEqual({ red: 8, blue: 8 });
      expect(view.history).toEqual([
        { turn: 1, team: 'red', word: 'Gradient', count: 2, guesses: [{ card: 0, color: 'red' }] },
      ]);
    }
  });
});

describe('what each player sees of a group', () => {
  const chosen = [
    { player: 'ann', card: 3 },
    { player: 'bob', card: 17 },
  ];
  const redChat = [{ id: 1, player: 'ann', turn: 1, text: 'The third one?' }];
  const blueChat = [{ id: 1, player: 'dan', turn: 1, text: 'They are stuck.' }];

  test("the group whose turn it is sees its guessers' choices and its own chat", () => {
    for (const seat of [redGuesser, redCaptain]) {
      const view = viewFor(talking(), seat);
      expect(view.selections).toEqual(chosen);
      expect(view.chat).toEqual(redChat);
    }
  });

  test('the other group sees its own chat and no choices', () => {
    for (const seat of [blueGuesser, blueCaptain]) {
      const view = viewFor(talking(), seat);
      expect('selections' in view).toBe(false);
      expect(view.chat).toEqual(blueChat);
    }
  });

  test('spectators and screens see neither', () => {
    const view = viewFor(talking(), SPECTATOR);
    expect('selections' in view).toBe(false);
    expect('chat' in view).toBe(false);
    expect(JSON.stringify(view)).not.toMatch(/third one|stuck|ann|dan/);
  });

  test('a chat stays in its group when the game is over, although every color is shown', () => {
    const over = accepted(withdraw(talking(), { gameId: 'game-1' }));
    expect(viewFor(over, redGuesser).chat).toEqual(redChat);
    expect(viewFor(over, blueGuesser).chat).toEqual(blueChat);
    expect('chat' in viewFor(over, SPECTATOR)).toBe(false);
    expect(JSON.stringify(viewFor(over, blueGuesser))).not.toContain('third one');
  });

  test('the group has an empty list of choices in its turn before anyone chooses', () => {
    const state = gameState();
    expect(viewFor(state, redGuesser).selections).toEqual([]);
    expect(viewFor(state, redGuesser).chat).toEqual([]);
    expect('selections' in viewFor(state, blueGuesser)).toBe(false);
  });
});

describe('a view', () => {
  test('is a copy that cannot change the game', () => {
    const state: KeywordsState = talking();
    const view = viewFor(state, redCaptain);
    view.history[0]?.guesses.push({ card: 5, color: 'red' });
    if (view.clue) view.clue.word = 'changed';
    view.selections?.pop();
    if (view.selections?.[0]) view.selections[0].card = 24;
    if (view.chat?.[0]) view.chat[0].text = 'changed';
    view.chat?.push({ id: 2, player: 'eve', turn: 1, text: 'added' });
    expect(state.history[0]?.guesses).toHaveLength(1);
    expect(state.clue?.word).toBe('Gradient');
    expect(state.selections).toEqual([
      { player: 'ann', card: 3 },
      { player: 'bob', card: 17 },
    ]);
    expect(state.chat.red).toEqual([{ id: 1, player: 'ann', turn: 1, text: 'The third one?' }]);
  });
});

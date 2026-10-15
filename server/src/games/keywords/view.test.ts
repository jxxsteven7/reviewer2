import { SPECTATOR, type Seat } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import { extend, giveClue, mark, pause, reveal, say, select, withdraw } from './rules';
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
  const clued = accepted(giveClue(start, captain('red'), { ...now(start), word: 'Gradient', count: 2 }, 0));
  return accepted(reveal(clued, guesser('red'), { ...now(clued), card: 0 }, 0));
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
      const view = viewFor(playing(), seat, 0);
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
      const view = viewFor(playing(), seat, 0);
      expect(view.cards.every((card) => card.color !== undefined)).toBe(true);
      expect(view.cards[24]).toEqual({ word: 'Word24', revealed: false, color: 'reviewer2' });
    }
  });

  test('everyone sees every color once the game is over', () => {
    const view = viewFor(accepted(withdraw(playing(), { gameId: 'game-1' })), SPECTATOR, 0);
    expect(view.cards.every((card) => card.color !== undefined)).toBe(true);
    expect(view.result).toEqual({ winner: null, reason: 'withdrawn' });
  });

  test("every view carries a card's translations and forms, which are no secret", () => {
    const state = playing();
    state.cards = state.cards.map((card, i) =>
      i === 5 ? { ...card, translations: ['Other5'] } : i === 6 ? { ...card, forms: ['Words6', 'W6'] } : card,
    );
    for (const seat of Object.values(SEATS)) {
      const view = viewFor(state, seat, 0);
      expect(view.cards[5]?.translations).toEqual(['Other5']);
      expect(view.cards[6]).toEqual({
        word: 'Word6',
        revealed: false,
        forms: ['Words6', 'W6'],
        ...(seat.role === 'captain' ? { color: 'red' } : {}),
      });
      expect(view.cards.filter((card) => 'translations' in card)).toHaveLength(1);
      expect(view.cards.filter((card) => 'forms' in card)).toHaveLength(1);
    }
  });

  test("only the captains get the English of a card's characters, while the game is on and the card face down", () => {
    const state = playing();
    state.cards = state.cards.map((card, i) => (i <= 1 ? { ...card, glosses: ['ball', 'sphere'] } : card));
    for (const seat of Object.values(SEATS)) {
      const view = viewFor(state, seat, 0);
      // Card 0 has been revealed, card 1 hasn't.
      expect(view.cards[0]).not.toHaveProperty('glosses');
      if (seat.role === 'captain') expect(view.cards[1]?.glosses).toEqual(['ball', 'sphere']);
      else expect(view.cards[1]).not.toHaveProperty('glosses');
    }
    const over = viewFor(accepted(withdraw(state, { gameId: 'game-1' })), redCaptain, 0);
    expect(over.cards.some((card) => 'glosses' in card)).toBe(false);
  });

  test('all views share the public facts of the game', () => {
    const state = talking();
    const shared = { turn: 1, team: 'red', phase: 'guess', startingTeam: 'red', guessesMade: 1, guessesLeft: 2 };
    for (const seat of Object.values(SEATS)) {
      const view = viewFor(state, seat, 0);
      expect(view).toMatchObject(shared);
      expect(view.clue).toEqual({ word: 'Gradient', count: 2 });
      expect(view.remaining).toEqual({ red: 8, blue: 8 });
      expect(view.history).toEqual([
        {
          turn: 1,
          team: 'red',
          word: 'Gradient',
          count: 2,
          guesses: [{ card: 0, color: 'red', player: 'red-guesser', at: 0 }],
          captain: 'red-captain',
          at: 0,
        },
      ]);
      expect(view.clock).toBeNull();
    }
  });

  test('everyone sees how long the phase has left when it is sent, and for how long it ran', () => {
    const state: KeywordsState = { ...playing(), clock: { ends: 50_000, length: 90_000 } };
    for (const seat of Object.values(SEATS)) {
      expect(viewFor(state, seat, 20_000).clock).toEqual({ left: 30_000, total: 90_000 });
      // A view that goes out late, before the server has ended the phase, has no time left.
      expect(viewFor(state, seat, 51_000).clock).toEqual({ left: 0, total: 90_000 });
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
      const view = viewFor(talking(), seat, 0);
      expect(view.selections).toEqual(chosen);
      expect(view.chat).toEqual(redChat);
    }
  });

  test('the other group sees its own chat and no choices', () => {
    for (const seat of [blueGuesser, blueCaptain]) {
      const view = viewFor(talking(), seat, 0);
      expect('selections' in view).toBe(false);
      expect(view.chat).toEqual(blueChat);
    }
  });

  test('spectators and screens see neither', () => {
    const view = viewFor(talking(), SPECTATOR, 0);
    expect('selections' in view).toBe(false);
    expect('chat' in view).toBe(false);
    expect(JSON.stringify(view)).not.toMatch(/third one|stuck|ann|dan/);
  });

  test('a chat stays in its group when the game is over, although every color is shown', () => {
    const over = accepted(withdraw(talking(), { gameId: 'game-1' }));
    expect(viewFor(over, redGuesser, 0).chat).toEqual(redChat);
    expect(viewFor(over, blueGuesser, 0).chat).toEqual(blueChat);
    expect('chat' in viewFor(over, SPECTATOR, 0)).toBe(false);
    expect(JSON.stringify(viewFor(over, blueGuesser, 0))).not.toContain('third one');
  });

  test('the group has an empty list of choices in its turn before anyone chooses', () => {
    const state = gameState();
    expect(viewFor(state, redGuesser, 0).selections).toEqual([]);
    expect(viewFor(state, redGuesser, 0).chat).toEqual([]);
    expect('selections' in viewFor(state, blueGuesser, 0)).toBe(false);
  });
});

describe("what each player sees of a group's marks", () => {
  // Both groups have marked cards while red guesses.
  const marking = () => {
    let state = playing();
    state = accepted(mark(state, guesser('red'), { gameId: state.gameId, card: 3, mark: 'ours' }));
    state = accepted(mark(state, guesser('red'), { gameId: state.gameId, card: 17, mark: 'r2' }));
    return accepted(mark(state, guesser('blue'), { gameId: state.gameId, card: 9, mark: 'theirs' }));
  };

  test("each group's guessers and captain see the group's own marks, in either group's turn", () => {
    for (const seat of [redGuesser, redCaptain]) {
      expect(viewFor(marking(), seat, 0).marks).toEqual([
        { card: 3, mark: 'ours' },
        { card: 17, mark: 'r2' },
      ]);
    }
    for (const seat of [blueGuesser, blueCaptain]) {
      expect(viewFor(marking(), seat, 0).marks).toEqual([{ card: 9, mark: 'theirs' }]);
    }
  });

  test('spectators and screens see no marks at all', () => {
    expect('marks' in viewFor(marking(), SPECTATOR, 0)).toBe(false);
  });

  test('a group with no marks yet gets an empty list, and nobody gets any once the game is over', () => {
    expect(viewFor(playing(), redGuesser, 0).marks).toEqual([]);
    const over = accepted(withdraw(marking(), { gameId: 'game-1' }));
    for (const seat of Object.values(SEATS)) expect('marks' in viewFor(over, seat, 0)).toBe(false);
  });
});

describe('the cards a captain meant', () => {
  // Red's captain marks two of the group's cards with the clue, and the group reveals one of them.
  const marked = () => {
    const start = gameState();
    const clued = accepted(
      giveClue(start, captain('red'), { ...now(start), word: 'Gradient', count: 2, targets: [3, 1] }, 0),
    );
    return accepted(reveal(clued, guesser('red'), { ...now(clued), card: 1 }, 0));
  };

  test("are in no view while the game is on, not even the captain's own", () => {
    const state = marked();
    expect(state.history[0]?.targets).toEqual([3, 1]);
    for (const [name, seat] of Object.entries(SEATS)) {
      const record = viewFor(state, seat, 0).history[0];
      expect(record, name).toMatchObject({ word: 'Gradient', captain: 'red-captain' });
      expect(record && 'targets' in record, name).toBe(false);
      expect(JSON.stringify(viewFor(state, seat, 0)), name).not.toContain('targets');
    }
  });

  test('stay out of every view during a pause, too', () => {
    const state = accepted(pause(marked(), true, { gameId: 'game-1' }, 0));
    for (const seat of Object.values(SEATS)) expect(JSON.stringify(viewFor(state, seat, 0))).not.toContain('targets');
  });

  test('are in every view once the game is over, in the order they were marked', () => {
    const state = accepted(withdraw(marked(), { gameId: 'game-1' }));
    for (const [name, seat] of Object.entries(SEATS)) {
      expect(viewFor(state, seat, 0).history[0]?.targets, name).toEqual([3, 1]);
    }
  });

  test('leave a record without them as it was in the game', () => {
    const state = marked();
    viewFor(state, redCaptain, 0);
    expect(state.history[0]?.targets).toEqual([3, 1]);
    const over = accepted(withdraw(state, { gameId: 'game-1' }));
    const targets = viewFor(over, redCaptain, 0).history[0]?.targets;
    targets?.push(99);
    expect(over.history[0]?.targets).toEqual([3, 1]);
  });
});

describe('a view', () => {
  test('is a copy that cannot change the game', () => {
    const state: KeywordsState = talking();
    const view = viewFor(state, redCaptain, 0);
    view.history[0]?.guesses.push({ card: 5, color: 'red', player: 'bob', at: 0 });
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

describe('a paused game', () => {
  test('shows nobody the board, and the time the phase had left', () => {
    const state = { ...talking(), clock: { ends: 50_000, length: 60_000 } };
    const paused = accepted(pause(state, true, { gameId: state.gameId }, 20_000));
    for (const seat of Object.values(SEATS)) {
      const view = viewFor(paused, seat, 25_000);
      expect(view.paused).toBe(true);
      expect(view.cards).toEqual([]);
      expect(view.clock).toEqual({ left: 30_000, total: 60_000 });
      expect(JSON.stringify(view)).not.toMatch(/Word\d/);
      expect(view.events).toEqual([{ turn: 1, kind: 'paused' }]);
      expect(view.remaining).toEqual({ red: 8, blue: 8 });
    }
    // The chat and the choices still go to the group.
    expect(viewFor(paused, redGuesser, 25_000).chat).toHaveLength(1);
    expect(viewFor(paused, redGuesser, 25_000).selections).toHaveLength(2);
  });

  test('shows everyone the whole board again once the game has ended during the pause', () => {
    const paused = accepted(pause(playing(), true, { gameId: playing().gameId }, 0));
    const over = accepted(withdraw(paused, { gameId: paused.gameId }));
    for (const seat of Object.values(SEATS)) {
      const view = viewFor(over, seat, 0);
      expect(view.paused).toBe(false);
      expect(view.cards).toHaveLength(25);
      expect(view.cards.every((card) => card.color !== undefined)).toBe(true);
    }
  });

  test('tells everyone whether the game is paused, and which groups have extended', () => {
    const state = {
      ...playing(),
      settings: { ...playing().settings, extensions: true },
      clock: { ends: 9, length: 9 },
    };
    const view = viewFor(state, SPECTATOR, 0);
    expect(view.paused).toBe(false);
    expect(view.extended).toEqual({ red: false, blue: false });
    const extended = accepted(extend(state, guesser('red'), now(state)));
    expect(viewFor(extended, SPECTATOR, 0).extended).toEqual({ red: true, blue: false });
    expect(viewFor(extended, SPECTATOR, 0).events).toEqual([{ turn: 1, kind: 'extended', team: 'red' }]);
  });
});

describe("a card's pinyin", () => {
  test('goes to everyone, as the translations do', () => {
    const state = playing();
    state.cards = state.cards.map((card, i) => (i === 7 ? { ...card, word: '\u57fa\u56e0', pinyin: 'ji yin' } : card));
    for (const seat of Object.values(SEATS)) {
      const view = viewFor(state, seat, 0);
      expect(view.cards[7]).toMatchObject({ word: '\u57fa\u56e0', pinyin: 'ji yin' });
      expect(view.cards[8]).not.toHaveProperty('pinyin');
    }
  });
});

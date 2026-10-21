import {
  CARD_COUNTS,
  CHAT_KEPT,
  otherTeam,
  SPECTATOR,
  TEAMS,
  type ClueCount,
  type Seat,
} from '@reviewer2/shared/keywords';
import { describe, expect, test } from 'vitest';
import { pick, seededRng, type Rng } from '../../core/random';
import {
  dropSelection,
  expire,
  giveClue,
  newGame,
  pass,
  reveal,
  say,
  select,
  withdraw,
  type Actor,
  type Outcome,
} from './rules';
import { guessesLeft, remaining, type KeywordsState } from './state';
import { captain, guesser, setup, spectator } from './testing';
import { viewFor } from './view';

// Plays hundreds of random games in which anyone may try anything, including actions from an
// old turn, and checks after every step that the rules still hold, that the rules left the state
// they were given alone, and that no view carries what its viewer may not see: the color of an
// unrevealed card, another group's chat, or the cards another group is choosing. Half the games
// play under the free guess rule with time limits, and time runs out on some of their turns.

// The words have no digits, which every clue with a digit would have a character in common with.
const letters = (n: number): string =>
  (n < 26 ? '' : letters(Math.floor(n / 26) - 1)) + String.fromCharCode(97 + (n % 26));
const WORDS = Array.from({ length: 25 }, (_, i) => `Term${letters(i)}`);
const GUESSERS: Actor[] = TEAMS.flatMap((team) => [guesser(team, `${team}-ann`), guesser(team, `${team}-bob`)]);
const ACTORS: Actor[] = [captain('red'), captain('blue'), ...GUESSERS, spectator];
const COUNTS: ClueCount[] = [0, 1, 2, 3, 4, 9, 'unlimited'];
const TEXTS = ['Card three?', 'Not that one', '', '   ', 'x'.repeat(300)];

function randomStep(state: KeywordsState, rng: Rng, step: number, at: number): Outcome {
  // Most of the time the right player acts, so that games finish; the rest is noise.
  const right = rng.int(10) < 6;
  const turnGuesser = () =>
    pick(
      GUESSERS.filter((actor) => actor.team === state.team),
      rng,
    );
  const actor = right ? (state.phase === 'clue' ? captain(state.team) : turnGuesser()) : pick(ACTORS, rng);
  const moment = { gameId: state.gameId, turn: rng.int(10) === 0 ? state.turn - 1 : state.turn };
  // 0: a clue, 1: a reveal, 2: a pass, 3: a choice of a card, 4: a message to the group.
  const action = right ? (state.phase === 'clue' ? 0 : pick([1, 1, 1, 2, 3, 3], rng)) : rng.int(5);
  switch (action) {
    case 0: {
      const word = rng.int(5) === 0 ? pick(['', 'two words', ...WORDS], rng) : `Clue${letters(step)}`;
      return giveClue(state, actor, { ...moment, word, count: pick(COUNTS, rng) }, at);
    }
    case 1:
      return reveal(state, actor, { ...moment, card: rng.int(27) - 1 }, at);
    case 2:
      return pass(state, actor, moment, at);
    case 3:
      return select(state, actor, { ...moment, card: rng.int(4) === 0 ? null : rng.int(27) - 1 });
    default:
      return say(state, actor, { gameId: rng.int(20) === 0 ? 'another-game' : state.gameId, text: pick(TEXTS, rng) });
  }
}

function checkHistory(state: KeywordsState) {
  const guessed = state.history.flatMap((record) => record.guesses);
  // Every revealed card was guessed once, under the clue of its turn, with its real color.
  expect(guessed.map((guess) => guess.card).sort((a, b) => a - b)).toEqual(
    state.cards.flatMap((card, index) => (card.revealed ? [index] : [])),
  );
  expect(guessed.every((guess) => guess.color === state.cards[guess.card]?.color)).toBe(true);
  // The records are in the order of their turns, each under the team that played that turn.
  const inOrder = state.history.every(
    (record, index) =>
      record.turn > (state.history[index - 1]?.turn ?? 0) &&
      (record.team === state.startingTeam) === (record.turn % 2 === 1),
  );
  expect(inOrder).toBe(true);
  // A turn without a clue is one whose time ran out.
  expect(state.history.every((record) => record.word !== null || (record.timedOut && !record.guesses.length))).toBe(
    true,
  );
  if (state.phase === 'guess') {
    const current = state.history.at(-1);
    expect(current).toMatchObject({ turn: state.turn, team: state.team, word: state.clue?.word });
    expect(current?.guesses).toHaveLength(state.guessesMade);
  }
}

// Only guessers of the team whose turn it is have a card chosen, one each, and only while that
// team guesses. Only guessers have written to their group, and a group keeps its latest messages.
function checkGroups(before: KeywordsState, after: KeywordsState) {
  const guessers = (team: string) => GUESSERS.filter((actor) => actor.team === team).map((actor) => actor.id);
  if (after.phase !== 'guess') expect(after.selections).toEqual([]);
  const choosing = after.selections.map((selection) => selection.player);
  expect(new Set(choosing).size).toBe(choosing.length);
  expect(choosing.every((player) => guessers(after.team).includes(player))).toBe(true);
  expect(after.selections.every(({ card }) => after.cards[card]?.revealed === false)).toBe(true);

  for (const team of TEAMS) {
    const chat = after.chat[team];
    expect(chat.length).toBeLessThanOrEqual(CHAT_KEPT);
    const fine = chat.every(
      (message, index) =>
        message.id === (chat[index - 1]?.id ?? message.id - 1) + 1 &&
        guessers(team).includes(message.player) &&
        message.turn <= after.turn &&
        message.text.trim() === message.text &&
        message.text.length > 0,
    );
    expect(fine).toBe(true);
    // Nothing that was written is changed afterwards: the chat only grows at its end.
    const kept = before.chat[team].filter((message) => message.id >= (chat[0]?.id ?? 0));
    expect(chat.slice(0, kept.length)).toEqual(kept);
  }
}

function checkViews(state: KeywordsState) {
  const over = state.phase === 'over';
  for (const team of TEAMS) {
    for (const role of ['captain', 'guesser'] as const) {
      const seat: Seat = { team, role };
      const view = viewFor(state, seat, 0);
      const leak = view.cards.some((card) => !card.revealed && 'color' in card);
      expect(leak).toBe(role === 'captain' || over);
      expect(view.chat).toEqual(state.chat[team]);
      expect(view.selections).toEqual(team === state.team ? state.selections : undefined);
      expect('selections' in view).toBe(team === state.team);
    }
  }
  const watching = viewFor(state, SPECTATOR, 0);
  expect(watching.cards.every((card) => card.revealed || over === 'color' in card)).toBe(true);
  expect('chat' in watching || 'selections' in watching).toBe(false);
}

function checkInvariants(before: KeywordsState, after: KeywordsState) {
  const colors = after.cards.map((card) => card.color);
  expect(
    remaining(
      after.cards.map((c) => ({ ...c, revealed: false })),
      after.startingTeam,
    ),
  ).toBe(CARD_COUNTS.starting);
  expect(colors.filter((color) => color === 'reviewer2')).toHaveLength(1);
  expect(before.cards.every((card, i) => !card.revealed || after.cards[i]?.revealed === true)).toBe(true);

  // Teams alternate: the starting team plays the odd turns.
  expect(after.team === after.startingTeam).toBe(after.turn % 2 === 1);
  expect(after.phase === 'guess').toBe(after.clue !== null);
  const left = guessesLeft(after);
  if (left !== null) expect(left).toBeGreaterThan(0);
  if (after.settings.guessRule === 'free') expect(left).toBeNull();
  // A phase runs on the clock for as long as the settings give it; a game that is over doesn't.
  const { firstClueTime, clueTime, guessTime } = after.settings;
  const time = after.phase === 'guess' ? guessTime : after.turn === 1 ? firstClueTime : clueTime;
  expect(after.clock?.length ?? 0).toBe(after.phase === 'over' ? 0 : time * 1000);
  checkHistory(after);
  checkGroups(before, after);
  checkViews(after);

  if (after.phase === 'over' && after.result) {
    const { winner, reason } = after.result;
    if (reason === 'found') expect(remaining(after.cards, winner ?? 'red')).toBe(0);
    if (reason === 'reviewer2') {
      expect(after.cards.find((card) => card.color === 'reviewer2')?.revealed).toBe(true);
      expect(winner).toBe(otherTeam(after.team));
    }
  }
}

describe('random games', () => {
  // Hundreds of games take a few seconds, more than the default allows on a slow machine.
  test('always keep the rules and the key, and always end', { timeout: 60_000 }, () => {
    const reasons = new Map<string, number>();
    const seen = { selections: 0, messages: 0, dropped: 0, expired: 0 };
    const TIMED = { guessRule: 'free', firstClueTime: 90, clueTime: 60, guessTime: 90 } as const;
    for (let seed = 0; seed < 300; seed += 1) {
      const rng = seededRng(seed);
      let at = 0;
      let state = newGame(WORDS, rng, setup(`game-${seed}`, seed % 2 === 0 ? {} : TIMED), at);
      for (let step = 0; state.phase !== 'over'; step += 1) {
        expect(step).toBeLessThan(2000);
        const untouched = JSON.stringify(state);
        // Now and then the chair withdraws the game, sometimes one that is long over, and now
        // and then a guesser leaves their seat.
        let outcome: Outcome;
        if (seed % 50 === 49 && step >= 20) {
          outcome = withdraw(state, { gameId: step === 20 ? 'an-earlier-game' : state.gameId });
        } else if (rng.int(40) === 0) {
          outcome = { ok: true, state: dropSelection(state, pick(GUESSERS, rng).id) };
          seen.dropped += Number(outcome.state !== state);
        } else if (rng.int(10) === 0) {
          // Time passes, and may run out.
          at += rng.int(100_000);
          outcome = { ok: true, state: expire(state, at) };
          seen.expired += Number(outcome.state !== state);
        } else {
          at += rng.int(5_000);
          outcome = randomStep(state, rng, step, at);
        }
        // The rules never write to the state they are given. A refusal returns no state at all,
        // so this is also what makes a refusal change nothing.
        expect(JSON.stringify(state)).toBe(untouched);
        const next = outcome.ok ? outcome.state : state;
        checkInvariants(state, next);
        seen.selections = Math.max(seen.selections, next.selections.length);
        state = next;
      }
      seen.messages = Math.max(seen.messages, state.chat.red.length, state.chat.blue.length);
      const reason = state.result?.reason ?? 'none';
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    // The games end in every possible way, and the groups really chose cards and talked.
    expect([...reasons.keys()].sort()).toEqual(['found', 'reviewer2', 'withdrawn']);
    expect(seen.selections).toBe(2);
    expect(seen.messages).toBeGreaterThan(5);
    expect(seen.dropped).toBeGreaterThan(5);
    expect(seen.expired).toBeGreaterThan(20);
  });
});

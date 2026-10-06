import { CARD_COUNTS, otherTeam, type ClueCount, type KeywordsView } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import { pick, seededRng, type Rng } from '../../core/random';
import { giveClue, newGame, pass, reveal, withdraw, type Actor, type Outcome } from './rules';
import { guessesLeft, remaining, type KeywordsState } from './state';
import { captain, guesser, spectator } from './testing';
import { viewFor } from './view';

// Plays hundreds of random games in which anyone may try anything, including actions from an
// old turn, and checks after every step that the rules still hold and that no view other than a
// captain's gives the key away.

const WORDS = Array.from({ length: 25 }, (_, i) => `Term${i}`);
const ACTORS: Actor[] = [captain('red'), guesser('red'), captain('blue'), guesser('blue'), spectator];
const COUNTS: ClueCount[] = [0, 1, 2, 3, 4, 9, 'unlimited'];

function randomStep(state: KeywordsState, rng: Rng, step: number): Outcome {
  // Most of the time the right player acts, so that games finish; the rest is noise.
  const right = rng.int(10) < 6;
  const actor = right ? (state.phase === 'clue' ? captain(state.team) : guesser(state.team)) : pick(ACTORS, rng);
  const moment = { gameId: state.gameId, turn: rng.int(10) === 0 ? state.turn - 1 : state.turn };
  switch (right ? (state.phase === 'clue' ? 0 : rng.int(5) === 0 ? 2 : 1) : rng.int(3)) {
    case 0: {
      const word = rng.int(5) === 0 ? pick(['', 'two words', ...WORDS], rng) : `Clue${step}`;
      return giveClue(state, actor, { ...moment, word, count: pick(COUNTS, rng) });
    }
    case 1:
      return reveal(state, actor, { ...moment, card: rng.int(27) - 1 });
    default:
      return pass(state, actor, moment);
  }
}

function expectNoLeak(view: KeywordsView, over: boolean) {
  for (const card of view.cards) {
    if (card.revealed || over) expect(card.color).toBeDefined();
    else expect('color' in card).toBe(false);
  }
}

function checkInvariants(before: KeywordsState, after: KeywordsState, outcome: Outcome) {
  if (!outcome.ok) expect(after).toBe(before); // a refusal changes nothing

  const colors = after.cards.map((card) => card.color);
  expect(
    remaining(
      after.cards.map((c) => ({ ...c, revealed: false })),
      after.startingTeam,
    ),
  ).toBe(CARD_COUNTS.starting);
  expect(colors.filter((color) => color === 'reviewer2')).toHaveLength(1);
  before.cards.forEach((card, i) => {
    if (card.revealed) expect(after.cards[i]?.revealed).toBe(true);
  });

  // Teams alternate: the starting team plays the odd turns.
  expect(after.team === after.startingTeam).toBe(after.turn % 2 === 1);
  expect(after.phase === 'guess').toBe(after.clue !== null);
  const left = guessesLeft(after);
  if (left !== null) expect(left).toBeGreaterThan(0);

  const over = after.phase === 'over';
  expectNoLeak(viewFor(after, 'public'), over);
  expect(viewFor(after, 'key').cards.every((card) => card.color !== undefined)).toBe(true);

  if (over && after.result) {
    const { winner, reason } = after.result;
    if (reason === 'found') expect(remaining(after.cards, winner ?? 'red')).toBe(0);
    if (reason === 'reviewer2') {
      expect(after.cards.find((card) => card.color === 'reviewer2')?.revealed).toBe(true);
      expect(winner).toBe(otherTeam(after.team));
    }
  }
}

describe('random games', () => {
  test('always keep the rules and the key, and always end', () => {
    const reasons = new Map<string, number>();
    for (let seed = 0; seed < 300; seed += 1) {
      const rng = seededRng(seed);
      let state = newGame(WORDS, rng, `game-${seed}`);
      for (let step = 0; state.phase !== 'over'; step += 1) {
        expect(step).toBeLessThan(2000);
        const outcome =
          seed % 50 === 49 && step === 20
            ? { ok: true as const, state: withdraw(state) }
            : randomStep(state, rng, step);
        const next = outcome.ok ? outcome.state : state;
        checkInvariants(state, next, outcome);
        state = next;
      }
      const reason = state.result?.reason ?? 'none';
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    // The games end in every possible way.
    expect([...reasons.keys()].sort()).toEqual(['found', 'reviewer2', 'withdrawn']);
  });
});

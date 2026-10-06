import type { CardColor, Team } from '@reviewer2/shared';
import type { Actor, Moment, Outcome } from './rules';
import type { KeywordsState } from './state';

// Helpers for the tests of this module.

// A board laid out by hand, one letter per card: R red, B blue, N an irrelevant paper and X
// Reviewer 2. The default gives red cards 0-8, blue cards 9-16, papers 17-23 and Reviewer 2 at 24.
export const LAYOUT = 'RRRRRRRRRBBBBBBBBNNNNNNNX';
const COLORS: Record<string, CardColor> = { R: 'red', B: 'blue', N: 'neutral', X: 'reviewer2' };

export function gameState(overrides: Partial<KeywordsState> = {}, layout = LAYOUT): KeywordsState {
  return {
    gameId: 'game-1',
    cards: [...layout].map((letter, index) => ({
      word: `Word${index}`,
      color: COLORS[letter] as CardColor,
      revealed: false,
    })),
    startingTeam: 'red',
    turn: 1,
    team: 'red',
    phase: 'clue',
    clue: null,
    guessesMade: 0,
    history: [],
    result: null,
    selections: [],
    chat: { red: [], blue: [] },
    ...overrides,
  };
}

// The players of the tests. Each team has one captain and as many guessers as a test names.
export const captain = (team: Team): Actor => ({ id: `${team}-captain`, team, role: 'captain' });
export const guesser = (team: Team, id = `${team}-guesser`): Actor => ({ id, team, role: 'guesser' });
export const spectator: Actor = { id: 'spectator', team: null, role: 'spectator' };

export const now = (state: KeywordsState): Moment => ({ gameId: state.gameId, turn: state.turn });

export function accepted(outcome: Outcome): KeywordsState {
  if (!outcome.ok) throw new Error(`refused: ${outcome.error}`);
  return outcome.state;
}

export const refused = (outcome: Outcome) => (outcome.ok ? null : outcome.error);

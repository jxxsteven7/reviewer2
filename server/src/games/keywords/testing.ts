import { defaultSettings, type CardColor, type KeywordsSettings, type Language, type Team } from '@reviewer2/shared';
import type { GameContext } from '../../core/game';
import { seededRng } from '../../core/random';
import { keywordsGame, type KeywordsData } from './index';
import type { Actor, Moment, Outcome, Setup } from './rules';
import type { KeywordsState } from './state';

// Helpers for the tests of this module.

// The settings that most tests play with: the standard guess rule, which gives a clue's number a
// meaning, and no time limits, so that the time of an action doesn't matter. The tests of the
// free rule and of the clock set their own.
export const STANDARD: KeywordsSettings = {
  ...defaultSettings('en'),
  guessRule: 'standard',
  firstClueTime: 0,
  clueTime: 0,
  guessTime: 0,
};

export const setup = (gameId: string, settings: Partial<KeywordsSettings> = {}, language: Language = 'en'): Setup => ({
  gameId,
  settings: { ...STANDARD, ...settings },
  language,
});

// A board laid out by hand, one letter per card: R red, B blue, N an irrelevant paper and X
// Reviewer 2. The default gives red cards 0-8, blue cards 9-16, papers 17-23 and Reviewer 2 at 24.
export const LAYOUT = 'RRRRRRRRRBBBBBBBBNNNNNNNX';
const COLORS: Record<string, CardColor> = { R: 'red', B: 'blue', N: 'neutral', X: 'reviewer2' };

export function gameState(overrides: Partial<KeywordsState> = {}, layout = LAYOUT): KeywordsState {
  return {
    gameId: 'game-1',
    startedAt: 0,
    settings: STANDARD,
    language: 'en',
    cards: [...layout].map((letter, index) => ({
      word: `Word${index}`,
      color: COLORS[letter] as CardColor,
      revealed: false,
    })),
    startingTeam: 'red',
    turn: 1,
    team: 'red',
    phase: 'clue',
    clock: null,
    pause: null,
    clue: null,
    guessesMade: 0,
    history: [],
    events: [],
    extended: { red: false, blue: false },
    result: null,
    selections: [],
    marks: { red: [], blue: [] },
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

// The module as a room drives it (index.ts), with four players: Ann and Cat are the PIs of red and
// blue, Bob and Dan their students, and a game has started in the room's language, English. `send`
// has a player send a message, keeps what it changed, and throws on a refusal.
export function seatedGame() {
  const players = ['ann', 'bob', 'cat', 'dan'];
  const ctx: GameContext = {
    phase: 'lobby',
    language: 'en',
    rng: seededRng(1),
    chairId: 'ann',
    now: () => 0,
    keyOf: (id) => `key-${id}`,
    nameOf: (id) => id,
    isOnline: () => true,
    agentOf: () => null,
    playerIds: () => players,
    titleCount: () => null,
  };
  let data = keywordsGame.create('en');
  for (const id of players) data = keywordsGame.join(data, ctx, id, false);
  const game = {
    data,
    ctx,
    send(id: string, type: string, payload: unknown): KeywordsData {
      const result = keywordsGame.handle(game.data, game.ctx, id, type, payload);
      if (!result.ok) throw new Error(`refused: ${result.error}`);
      game.data = result.data;
      return result.data;
    },
  };
  const seats: [string, Team, 'captain' | 'guesser'][] = [
    ['ann', 'red', 'captain'],
    ['bob', 'red', 'guesser'],
    ['cat', 'blue', 'captain'],
    ['dan', 'blue', 'guesser'],
  ];
  for (const [id, team, role] of seats) game.send(id, 'keywords:seat', { team, role });
  game.ctx = { ...ctx, phase: 'playing' };
  const words = Array.from({ length: 25 }, (_, index) => ({ word: `Word${index}` }));
  game.data = keywordsGame.start(game.data, game.ctx, words, 'g1');
  return game;
}

import type { BoardWord } from '@reviewer2/shared';
import { defaultSettings, type ImpostorRole, type ImpostorSettings } from '@reviewer2/shared/impostor';
import { seededRng } from '../../core/random';
import { describe as write, newGame, vote, votersOf, type Outcome } from './rules';
import type { ImpostorGame } from './state';

// Helpers for the tests of this module.

// The settings that most tests play with: no time limits, so that the time of an action doesn't
// matter. The tests of the clock set their own.
export const SETTINGS: ImpostorSettings = { ...defaultSettings('en'), describeTime: 0, voteTime: 0 };

// The two words of the tests: the students have the apple, the Reviewer 2s the pear.
export const APPLE: BoardWord = { word: 'apple', forms: ['apples'] };
export const PEAR: BoardWord = { word: 'pear' };

const ROLES: Record<string, ImpostorRole> = { S: 'student', R: 'reviewer2', P: 'pi' };

// A game dealt by hand, one letter per player: S a student, R a Reviewer 2 and P the PI. Player
// pN has number N, and player p1 describes first.
export function dealt(roles: string, settings: Partial<ImpostorSettings> = {}, now = 0): ImpostorGame {
  const letters = [...roles];
  const game = newGame(
    {
      gameId: 'g1',
      settings: { ...SETTINGS, ...settings },
      players: letters.map((_, index) => ({ id: `p${index + 1}`, agent: false })),
      words: [APPLE, PEAR],
      source: () => ({
        kind: 'library',
        field: 'general',
        pair: 'general:apple+pear',
        terms: { student: 'apple', reviewer2: 'pear' },
      }),
    },
    seededRng(1),
    now,
  );
  return {
    ...game,
    players: letters.map((letter, index) => ({
      id: `p${index + 1}`,
      number: index + 1,
      role: ROLES[letter] as ImpostorRole,
      agent: false,
      fate: 'alive',
      out: null,
    })),
    words: { student: APPLE, reviewer2: PEAR },
    source: {
      kind: 'library',
      field: 'general',
      pair: 'general:apple+pear',
      terms: { student: 'apple', reviewer2: 'pear' },
    },
    speaker: 'p1',
  };
}

// Lines that give neither word away and are far enough apart from each other.
export const LINES = [
  'grows on a tree',
  'sweet and crisp',
  'you keep it in a bowl',
  'often eaten raw',
  'comes in many colors',
  'good baked in a pie',
  'has a core with seeds',
  'picked in the autumn',
  'sold at every market',
  'children take one to school',
  'makes a fine juice',
  'keeps for weeks when cool',
  'a snack between meals',
  'bruises when dropped',
  'the skin can be waxy',
  'farmers grow orchards of them',
  'a favorite of horses',
  'sliced into salads',
  'dried into rings',
  'turned into cider',
  'it can be green or yellow',
  'shaped by the branch it hung on',
  'a teacher might get one',
  'smells lovely when ripe',
  'part of many desserts',
  'a classic still life subject',
  'some are sour',
  'it has a stalk',
  'bees help it grow',
  'stored in a cellar',
  'pressed for vinegar',
  'cooked down into a sauce',
  'a lunchbox regular',
  'hard when not yet ripe',
  'a symbol of temptation',
  'found in a fruit basket',
];

export const at = (game: ImpostorGame) => ({ gameId: game.gameId, round: game.round });

export function accepted(outcome: Outcome): ImpostorGame {
  if (!outcome.ok) throw new Error(`refused: ${outcome.error}`);
  return outcome.game;
}

export const refused = (outcome: Outcome) => (outcome.ok ? null : outcome.error);

// Everyone who is to describe does, in turn, until the phase moves on.
export function describeAll(game: ImpostorGame, now = 0): ImpostorGame {
  let next = game;
  while ((next.phase === 'describe' || next.phase === 'tie') && next.speaker !== null && !next.report) {
    const text = LINES[next.lines.length % LINES.length] as string;
    next = accepted(write(next, next.speaker, { ...at(next), text }, now));
  }
  return next;
}

// Everyone who votes in the vote being held votes, for the number that `votes` gives them, or
// abstains, until the votes are revealed.
export function voteAll(game: ImpostorGame, votes: Record<string, number | null>, now = 0): ImpostorGame {
  let next = game;
  const ballots = game.ballots.length;
  for (const voter of votersOf(game)) {
    if (next.ballots.length > ballots) break;
    next = accepted(vote(next, voter.id, { ...at(next), number: votes[voter.id] ?? null }, now));
  }
  return next;
}

// Those that `votes` names vote as it says, and nobody else.
export function cast(game: ImpostorGame, votes: Record<string, number | null>, now = 0): ImpostorGame {
  let next = game;
  for (const [id, number] of Object.entries(votes)) next = accepted(vote(next, id, { ...at(next), number }, now));
  return next;
}

// Everyone describes and then votes as `votes` says.
export const playRound = (game: ImpostorGame, votes: Record<string, number | null>, now = 0) =>
  voteAll(describeAll(game, now), votes, now);

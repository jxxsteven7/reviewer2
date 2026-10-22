import type { DatabaseSync } from 'node:sqlite';
import { ReplayStore, type NewReplay } from '../src/store/records';

// The record of a game, for the tests of what accounts keep of their games, which the database ties
// to the record of the game (migration 24): a finished game of the first game that red won, kept
// with the least that a record has, or as `changes` say. A game that a match scored (`match`) was
// played in a match room. A game that an AI played in brought nobody anything, as the room decides
// while no version of the AI is certified.

export function newReplay(gameId: string, changes: Partial<NewReplay> = {}): NewReplay {
  const game = changes.game ?? 'keywords';
  const match = changes.match ?? null;
  return {
    game,
    gameId,
    ending: 'finished',
    outcome: { winner: 'red', reason: 'found' },
    durationMs: 1000,
    setup: null,
    log: { v: 2, game, gameId, start: null, entries: [{ t: 1000, by: null, type: 'end' }] },
    agentLog: null,
    players: [],
    counts: { accounts: 1, guests: 0, agents: 0 },
    takeover: false,
    scoresNothing: (changes.counts?.agents ?? 0) > 0 || changes.takeover === true,
    agentPlays: [],
    match,
    inMatch: match !== null,
    practice: false,
    language: 'en',
    fields: ['general'],
    version: 'v',
    rules: 4,
    words: 'w',
    ...changes,
  };
}

// Keeps such a game, ending now on the clock, so that records of it can be kept. A game kept
// already is left as it is.
export function keepGame(
  db: DatabaseSync,
  gameId: string,
  changes: Partial<NewReplay> = {},
  now: () => number = () => Date.now(),
): void {
  new ReplayStore(db, now).add(newReplay(gameId, changes));
}

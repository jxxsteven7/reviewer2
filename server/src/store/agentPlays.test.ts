import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { AgentPlay } from '../core/room';
import { AccountStore } from './accounts';
import { openDatabase } from './database';
import { AgentPlayStore, RecordStore, ReplayStore } from './records';

// What the AI's page counts of the games it played in (docs/architecture.md#ai-players): games,
// however many seats it had in one and however many people it played for in one.

let db: DatabaseSync;
let replays: ReplayStore;
let plays: AgentPlayStore;

beforeEach(async () => {
  ({ db } = await openDatabase(null));
  replays = new ReplayStore(db, () => 0);
  plays = new AgentPlayStore(db);
});

afterEach(() => db.close());

const play = (playerId: string, changes: Partial<AgentPlay>): AgentPlay => ({
  playerId,
  persona: 'reviewer1',
  takeover: false,
  accountId: null,
  side: null,
  role: null,
  won: null,
  feats: null,
  ...changes,
});

const keep = (gameId: string, agentPlays: AgentPlay[]) =>
  replays.add({ game: 'keywords', gameId, ending: 'finished', durationMs: 1, replay: null, agentPlays }, null);

describe('the AI page', () => {
  test('counts a game once, with the AI as the PI of both groups and playing for two people in it', () => {
    const accounts = new AccountStore(db);
    const ann = accounts.create('Ann', 'ann', 'h');
    if (!ann) throw new Error('no account');
    keep('g1', [
      play('a', {
        side: 'red',
        role: 'captain',
        won: true,
        feats: { clues: 2, found: 3, reviewer2: 0, best: { word: 'Pair', found: 2 } },
      }),
      play('b', {
        side: 'blue',
        role: 'captain',
        won: false,
        feats: { clues: 1, found: 1, reviewer2: 0, best: { word: 'One', found: 1 } },
      }),
      play('p1', { takeover: true, accountId: ann.id, side: 'red', role: 'guesser', won: true }),
      play('p2', { takeover: true, side: 'blue', role: 'guesser', won: false }),
    ]);
    // Ann's own record of the game, for what she played with the AI.
    new RecordStore(db).add(ann.id, {
      game: 'keywords',
      gameId: 'g1',
      side: 'red',
      role: 'guesser',
      winner: 'red',
      won: true,
      verdict: 'oral',
      points: 0,
      agents: true,
    });
    expect(plays.profile('reviewer1', null)).toEqual({
      games: 1,
      wins: 1,
      clues: 3,
      found: 4,
      reviewer2: 0,
      roles: { captain: { games: 1, wins: 1 }, guesser: { games: 0, wins: 0 } },
      takeovers: 1,
      best: { word: 'Pair', found: 2 },
      you: null,
    });
    // In her group as the red PI, and against her as the blue one, in the same game.
    expect(plays.profile('reviewer1', ann.id).you).toEqual({
      wonTogether: 1,
      lostTogether: 0,
      beat: 1,
      beaten: 0,
      takenOver: 1,
    });
  });

  test('counts each game of several, by role', () => {
    keep('g1', [play('a', { role: 'captain', won: true })]);
    keep('g2', [
      play('b', { role: 'guesser', won: false }),
      play('c', { takeover: true, role: 'guesser', won: false }),
    ]);
    keep('g3', [play('d', { role: 'guesser', won: true })]);
    expect(plays.profile('reviewer1', null)).toMatchObject({
      games: 3,
      wins: 2,
      roles: { captain: { games: 1, wins: 1 }, guesser: { games: 2, wins: 1 } },
      takeovers: 1,
      best: null,
    });
  });
});

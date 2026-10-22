import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { RECORDS_NOTICE_VERSION } from '@reviewer2/shared';
import type { AgentPlay } from '../core/room';
import { AccountStore } from './accounts';
import { openDatabase } from './database';
import { GAMES } from '../games';
import { AgentPlayStore, RecordStore, ReplayStore } from './records';

// What the AI's page counts of the games it played in (docs/architecture.md#ai-players): games,
// however many seats it had in one and however many people it played for in one, each game apart,
// with what the game counts of its seats added up as the game adds them up.

let db: DatabaseSync;
let replays: ReplayStore;
let plays: AgentPlayStore;

beforeEach(async () => {
  ({ db } = await openDatabase(null));
  replays = new ReplayStore(db, () => 0);
  plays = new AgentPlayStore(db, new Map(GAMES.map((game) => [game.id, game])));
});

afterEach(() => db.close());

const play = (playerId: string, changes: Partial<AgentPlay>): AgentPlay => ({
  playerId,
  persona: 'reviewer1',
  takeover: false,
  accountId: null,
  side: null,
  role: null,
  result: null,
  place: null,
  feats: null,
  ...changes,
});

// How a seat of the first game came out: won by the group that came first, or lost by the other.
const WON = { result: 'won', place: 1 } as const;
const LOST = { result: 'lost', place: 2 } as const;

const keep = (gameId: string, agentPlays: AgentPlay[], game = 'keywords') =>
  replays.add({
    game,
    gameId,
    ending: 'finished',
    outcome: null,
    durationMs: 1,
    setup: null,
    log: { v: 2, game, gameId, start: null, entries: [{ t: 1, by: null, type: 'end' }] },
    agentLog: null,
    players: [],
    counts: { accounts: 1, guests: 0, agents: 1 },
    takeover: false,
    scoresNothing: true,
    agentPlays,
    match: null,
    inMatch: false,
    practice: true,
    language: 'en',
    fields: ['general'],
    version: 'test',
    rules: 4,
    words: '0123456789abcdef',
  });

describe('the AI page', () => {
  test('counts a game once, with the AI as the PI of both groups and playing for two people in it', () => {
    const accounts = new AccountStore(db);
    const ann = accounts.create('Ann', 'ann', 'h', RECORDS_NOTICE_VERSION);
    if (!ann) throw new Error('no account');
    keep('g1', [
      play('a', {
        side: 'red',
        role: 'captain',
        ...WON,
        feats: { clues: 2, found: 3, reviewer2: 0, best: { word: 'Pair', found: 2 } },
      }),
      play('b', {
        side: 'blue',
        role: 'captain',
        ...LOST,
        feats: { clues: 1, found: 1, reviewer2: 0, best: { word: 'One', found: 1 } },
      }),
      play('p1', { takeover: true, accountId: ann.id, side: 'red', role: 'guesser', ...WON }),
      play('p2', { takeover: true, side: 'blue', role: 'guesser', ...LOST }),
    ]);
    // Ann's own record of the game, for what she played with the AI.
    new RecordStore(db).add(ann.id, {
      game: 'keywords',
      gameId: 'g1',
      side: 'red',
      role: 'guesser',
      ...WON,
      verdict: 'oral',
      points: 0,
    });
    expect(plays.profile('reviewer1', null)).toEqual({
      keywords: {
        games: 1,
        seats: 2,
        wins: 1,
        roles: { captain: { seats: 2, wins: 1 } },
        takeovers: 1,
        feats: { clues: 3, found: 4, reviewer2: 0, best: { word: 'Pair', found: 2 } },
        you: null,
      },
    });
    // In her group as the red PI, and against her as the blue one, in the same game.
    expect(plays.profile('reviewer1', ann.id).keywords?.you).toEqual({
      wonTogether: 1,
      lostTogether: 0,
      beat: 1,
      beaten: 0,
      takenOver: 1,
    });
  });

  test('counts each game of several, by role', () => {
    keep('g1', [play('a', { role: 'captain', ...WON })]);
    keep('g2', [play('b', { role: 'guesser', ...LOST }), play('c', { takeover: true, role: 'guesser', ...LOST })]);
    keep('g3', [play('d', { role: 'guesser', ...WON })]);
    expect(plays.profile('reviewer1', null).keywords).toMatchObject({
      games: 3,
      seats: 3,
      wins: 2,
      roles: { captain: { seats: 1, wins: 1 }, guesser: { seats: 2, wins: 1 } },
      takeovers: 1,
      feats: { clues: 0, found: 0, reviewer2: 0, best: null },
    });
  });

  test('counts the seats of a practice game one by one, so that a game it wins and loses is not won', () => {
    // The player is the red PI; the AI is the red student and the whole blue group, and red wins.
    keep('g1', [
      play('a', { side: 'red', role: 'guesser', ...WON, feats: { clues: 0, found: 0, reviewer2: 1, best: null } }),
      play('b', { side: 'blue', role: 'captain', ...LOST, feats: { clues: 2, found: 1, reviewer2: 0, best: null } }),
      play('c', { side: 'blue', role: 'guesser', ...LOST, feats: { clues: 0, found: 0, reviewer2: 0, best: null } }),
    ]);
    expect(plays.profile('reviewer1', null).keywords).toMatchObject({
      games: 1,
      seats: 3,
      wins: 1,
      roles: { captain: { seats: 1, wins: 0 }, guesser: { seats: 2, wins: 1 } },
      feats: { clues: 2, found: 1, reviewer2: 1, best: null },
    });
    // What the game counted of each seat is kept as JSON in the game's own shape.
    expect(db.prepare("SELECT feats FROM agent_plays WHERE player_id = 'b'").get()).toEqual({
      feats: '{"clues":2,"found":1,"reviewer2":0,"best":null}',
    });
  });

  test('counts each game apart, and adds up what a game counts of its seats only where the game does', () => {
    const accounts = new AccountStore(db);
    const ann = accounts.create('Ann', 'ann', 'h', RECORDS_NOTICE_VERSION);
    if (!ann) throw new Error('no account');
    keep('g1', [
      play('a', { side: 'red', role: 'captain', ...WON, feats: { clues: 1, found: 2, reviewer2: 0, best: null } }),
    ]);
    // A game that the server doesn't play adds up nothing of what it counted; one drawn is no win.
    keep(
      't1',
      [play('b', { side: 'solo', role: 'painter', result: 'drawn', place: 1, feats: { strokes: 4 } })],
      'test',
    );
    keep('t2', [play('c', { side: 'solo', role: 'painter', result: 'lost', place: 3 })], 'test');
    keep('t3', [play('d', { takeover: true, accountId: ann.id, side: 'solo', role: 'painter', ...WON })], 'test');
    expect(plays.profile('reviewer1', ann.id)).toEqual({
      keywords: {
        games: 1,
        seats: 1,
        wins: 1,
        roles: { captain: { seats: 1, wins: 1 } },
        takeovers: 0,
        feats: { clues: 1, found: 2, reviewer2: 0, best: null },
        you: { wonTogether: 0, lostTogether: 0, beat: 0, beaten: 0, takenOver: 0 },
      },
      test: {
        games: 2,
        seats: 2,
        wins: 0,
        roles: { painter: { seats: 2, wins: 0 } },
        takeovers: 1,
        feats: null,
        you: { wonTogether: 0, lostTogether: 0, beat: 0, beaten: 0, takenOver: 1 },
      },
    });
    expect(plays.profile('reviewer2', null)).toEqual({});
  });

  test('goes by place against the AI, and counts a game drawn together as neither won nor lost', () => {
    const accounts = new AccountStore(db);
    const ann = accounts.create('Ann', 'ann', 'h', RECORDS_NOTICE_VERSION);
    if (!ann) throw new Error('no account');
    const records = new RecordStore(db);
    const record = (gameId: string, side: string, result: 'won' | 'drawn' | 'lost', place: number) =>
      records.add(ann.id, { game: 'test', gameId, side, role: 'painter', result, place, verdict: 'v', points: 0 });
    // Each for themselves: Ann second ahead of the AI third, then the AI first ahead of Ann.
    keep('t1', [play('a', { side: 'a', role: 'painter', result: 'lost', place: 3 })], 'test');
    record('t1', 'ann', 'lost', 2);
    keep('t2', [play('a', { side: 'a', role: 'painter', ...WON })], 'test');
    record('t2', 'ann', 'lost', 2);
    // Together, a game drawn.
    keep('t3', [play('a', { side: 'all', role: 'painter', result: 'drawn', place: 1 })], 'test');
    record('t3', 'all', 'drawn', 1);
    expect(plays.profile('reviewer1', ann.id).test?.you).toEqual({
      wonTogether: 0,
      lostTogether: 0,
      beat: 1,
      beaten: 1,
      takenOver: 0,
    });
  });

  test('keeps how a game came out for a seat with its place, both or neither (migration 26)', () => {
    keep('g1', [play('a', { takeover: true })]);
    expect(db.prepare("SELECT result, place FROM agent_plays WHERE game_id = 'g1'").get()).toEqual({
      result: null,
      place: null,
    });
    const insert = db.prepare(
      'INSERT INTO agent_plays (game_id, player_id, game, persona, takeover, result, place) ' +
        "VALUES ('g1', ?, 'keywords', 'reviewer1', 0, ?, ?)",
    );
    expect(() => insert.run('b', 'won', null)).toThrow(/CHECK/);
    expect(() => insert.run('c', null, 1)).toThrow(/CHECK/);
    expect(() => insert.run('d', 'tied', 1)).toThrow(/CHECK/);
    expect(() => insert.run('e', 'won', 0)).toThrow(/CHECK/);
    insert.run('f', 'drawn', 1);
  });
});

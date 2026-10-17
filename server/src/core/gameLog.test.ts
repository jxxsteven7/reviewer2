import { describe, expect, test } from 'vitest';
import { GameLog, markDeleted, MAX_GAME_LOG_BYTES, MAX_SAID_BYTES } from './gameLog';

describe('the log of a game', () => {
  test('notes each thing in order, from the start of the game, with who did it, what it carried and what was said', () => {
    const log = new GameLog('test', 'g1', 1000, { a: 'red' });
    log.add(1000, 'a', 'test:press', { data: 'hard' });
    log.add(2500, null, 'tick', { data: { offline: ['b'] } });
    log.add(4000, 'b', 'test:say', { said: 'over here' });
    log.add(4500, 'c', 'test:press', { data: 'soft', agent: 'reviewer1' });
    expect(log.data()).toEqual({
      v: 2,
      game: 'test',
      gameId: 'g1',
      start: { a: 'red' },
      entries: [
        { t: 0, by: 'a', type: 'test:press', data: 'hard' },
        { t: 1500, by: null, type: 'tick', data: { offline: ['b'] } },
        { t: 3000, by: 'b', type: 'test:say', said: 'over here' },
        { t: 3500, by: 'c', type: 'test:press', data: 'soft', agent: 'reviewer1' },
      ],
    });
    expect(log.full).toBe(false);
  });

  test('leaves out what is said once the chat has taken up its share, says so once, and keeps the rest', () => {
    const log = new GameLog('test', 'g1', 0, null);
    const text = 'x'.repeat(1000);
    let at = 0;
    while (JSON.stringify(log.data()).length < MAX_SAID_BYTES - 2000) log.add((at += 1), 'a', 'say', { said: text });
    const before = log.data()?.entries.length ?? 0;
    log.add((at += 1), 'a', 'say', { said: text });
    log.add((at += 1), 'a', 'say', { said: text });
    log.add((at += 1), 'a', 'say', { said: text });
    log.add((at += 1), 'a', 'reveal', { data: 3 });
    const kept = log.data();
    expect(kept?.truncated).toBe(true);
    const after = kept?.entries.slice(before) ?? [];
    // The line that still fitted, if any, then the note, then no more chat, but the move.
    expect(after.filter(({ type }) => type === 'truncated')).toHaveLength(1);
    expect(after.at(-1)).toEqual({ t: at, by: 'a', type: 'reveal', data: 3 });
    expect(after.at(-2)).toMatchObject({ by: null, type: 'truncated' });
    const said = (kept?.entries ?? []).filter(({ said: line }) => line !== undefined);
    expect(Buffer.byteLength(JSON.stringify(said))).toBeLessThanOrEqual(MAX_SAID_BYTES);
  });

  test('is full once what was done has grown past its limit, the chat apart, and keeps everything all the same', () => {
    const log = new GameLog('test', 'g1', 0, null);
    const text = 'x'.repeat(10_000);
    let at = 0;
    while (!log.full) {
      expect(Buffer.byteLength(JSON.stringify(log.data()))).toBeLessThanOrEqual(MAX_GAME_LOG_BYTES);
      log.add((at += 1), 'a', 'press', { data: text });
    }
    // The entry that went past the limit was the one after as many as fit, and is kept with them,
    // as is whatever comes after, such as the end that cuts the game short.
    expect(at).toBe(Math.floor(MAX_GAME_LOG_BYTES / 10_000) + 1);
    expect(log.size).toBe(at);
    log.add(at + 1, null, 'end', { data: { ending: 'abandoned', why: 'flood' } });
    expect(log.data().entries.at(-1)).toEqual({
      t: at + 1,
      by: null,
      type: 'end',
      data: { ending: 'abandoned', why: 'flood' },
    });
    expect(log.full).toBe(true);
  });

  test('is not full for what was said, which has its own share', () => {
    const log = new GameLog('test', 'g1', 0, null);
    let at = 0;
    while (!log.data().truncated) log.add((at += 1), 'a', 'say', { said: 'x'.repeat(4000) });
    while (JSON.stringify(log.data()).length < MAX_GAME_LOG_BYTES + 4000) {
      log.add((at += 1), 'a', 'reveal', { data: 'x'.repeat(4000) });
    }
    // Past the limit as JSON, with the chat, but not without it.
    expect(Buffer.byteLength(JSON.stringify(log.data()))).toBeGreaterThan(MAX_GAME_LOG_BYTES);
    expect(log.full).toBe(false);
  });
});

describe('marking the players of a deleted account', () => {
  test('adds their IDs once each, in the order they went, and keeps what they said', () => {
    const log = new GameLog('test', 'g1', 0, null);
    log.add(1, 'a', 'say', { said: 'mine' });
    log.add(2, 'b', 'say', { said: 'theirs' });
    const kept = log.data();
    if (!kept) throw new Error('no log');
    const marked = markDeleted(kept, ['b', 'a', 'b']);
    expect(marked.deleted).toEqual(['b', 'a']);
    expect(marked.entries).toBe(kept.entries);
    // An account deleted later adds its own after them, and nobody is marked twice.
    expect(markDeleted(marked, ['a', 'c']).deleted).toEqual(['b', 'a', 'c']);
    // The log it was made from is left as it was.
    expect(kept.deleted).toBeUndefined();
  });

  test('gives the same log back when there is nobody new to mark', () => {
    const log = { entries: [], deleted: ['a'] };
    expect(markDeleted(log, ['a'])).toBe(log);
    expect(markDeleted(log, [])).toBe(log);
    const unmarked: { entries: unknown[]; deleted?: string[] } = { entries: [] };
    expect(markDeleted(unmarked, new Set<string>())).toBe(unmarked);
  });
});

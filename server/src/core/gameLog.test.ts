import { describe, expect, test } from 'vitest';
import { GameLog, MAX_GAME_LOG_BYTES, MAX_SAID_BYTES, unsay } from './gameLog';

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
    expect(log.overflowed).toBe(false);
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

  test('is never larger than its limit as JSON, the note that it left the chat out included', () => {
    // A log whose chat has taken up its share, with the note, and within a few kilobytes of its
    // limit, built the same way each time.
    const grown = () => {
      const log = new GameLog('test', 'g1', 0, null);
      let at = 0;
      while (!log.data()?.truncated) log.add((at += 1), 'a', 'say', { said: 'x'.repeat(4000) });
      while (JSON.stringify(log.data()).length < MAX_GAME_LOG_BYTES - 4500)
        log.add((at += 1), 'a', 'reveal', { data: 'x'.repeat(4000) });
      return { log, at };
    };
    const room = MAX_GAME_LOG_BYTES - Buffer.byteLength(JSON.stringify(grown().log.data()));
    // One more entry, of every size from well under what is left to well over it: whatever is
    // kept fits, and the rest is dropped.
    const outcomes = { kept: 0, dropped: 0 };
    for (let size = room - 120; size <= room; size += 1) {
      const { log, at } = grown();
      log.add(at + 1, 'a', 'reveal', { data: 'z'.repeat(size) });
      const kept = log.data();
      if (kept === null) {
        outcomes.dropped += 1;
        continue;
      }
      outcomes.kept += 1;
      expect(Buffer.byteLength(JSON.stringify(kept))).toBeLessThanOrEqual(MAX_GAME_LOG_BYTES);
    }
    expect(outcomes.kept).toBeGreaterThan(0);
    expect(outcomes.dropped).toBeGreaterThan(0);
  });

  test('is not kept at all once it has grown past its limit', () => {
    const log = new GameLog('test', 'g1', 0, null);
    const text = 'x'.repeat(10_000);
    let at = 0;
    while (!log.overflowed) {
      expect(Buffer.byteLength(JSON.stringify(log.data()))).toBeLessThanOrEqual(MAX_GAME_LOG_BYTES);
      log.add((at += 1), 'a', 'press', { data: text });
    }
    // The entry that went past the limit was the one after as many as fit.
    expect(at).toBe(Math.floor(MAX_GAME_LOG_BYTES / 10_000) + 1);
    expect(log.data()).toBeNull();
    log.add(at + 1, 'a', 'press', { data: 'small' });
    expect(log.data()).toBeNull();
  });
});

describe('taking out what players said', () => {
  test('takes out the lines of those players alone, and keeps that they said something, and when', () => {
    const log = new GameLog('test', 'g1', 0, null);
    log.add(1, 'a', 'say', { said: 'mine' });
    log.add(2, 'b', 'say', { said: 'theirs' });
    log.add(3, 'a', 'press', { data: 'kept' });
    const kept = log.data();
    if (!kept) throw new Error('no log');
    expect(unsay(kept, new Set(['a'])).entries).toEqual([
      { t: 1, by: 'a', type: 'say' },
      { t: 2, by: 'b', type: 'say', said: 'theirs' },
      { t: 3, by: 'a', type: 'press', data: 'kept' },
    ]);
    // A log they said nothing in comes back as it was.
    expect(unsay(kept, new Set(['c']))).toBe(kept);
  });
});

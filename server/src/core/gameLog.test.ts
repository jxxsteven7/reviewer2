import { describe, expect, test } from 'vitest';
import { GameLog, MAX_GAME_LOG_BYTES } from './gameLog';

describe('the log of a game', () => {
  test('notes each thing in order, from the start of the game, with who did it and what it said', () => {
    const log = new GameLog('test', 'g1', 1000, { a: 'red' });
    log.add(1000, 'a', 'test:press', 'hard');
    log.add(2500, null, 'tick');
    log.add(4000, 'b', 'emote', { emote: 'waiting' }, true);
    expect(log.data()).toEqual({
      v: 1,
      game: 'test',
      gameId: 'g1',
      start: { a: 'red' },
      entries: [
        { t: 0, by: 'a', type: 'test:press', data: 'hard' },
        { t: 1500, by: null, type: 'tick' },
        { t: 3000, by: 'b', type: 'emote', data: { emote: 'waiting' } },
      ],
    });
    expect(log.overflowed).toBe(false);
  });

  test('leaves out minor things once it has grown long, and says so once, keeping the rest', () => {
    const log = new GameLog('test', 'g1', 0, null);
    const text = 'x'.repeat(1000);
    let at = 0;
    while (JSON.stringify(log.data()).length < (MAX_GAME_LOG_BYTES * 3) / 4)
      log.add((at += 1), 'a', 'choose', text, true);
    const before = log.data()?.entries.length ?? 0;
    log.add((at += 1), 'a', 'choose', text, true);
    log.add((at += 1), 'a', 'choose', text, true);
    log.add((at += 1), 'a', 'reveal', 3);
    const kept = log.data();
    expect(kept?.truncated).toBe(true);
    expect(kept?.entries.slice(before)).toEqual([
      { t: at - 2, by: null, type: 'truncated' },
      { t: at, by: 'a', type: 'reveal', data: 3 },
    ]);
  });

  test('is never larger than its limit as JSON, the note that it left minor things out included', () => {
    // A log past its soft limit, with the note, and within a few kilobytes of its limit, built the
    // same way each time.
    const grown = () => {
      const log = new GameLog('test', 'g1', 0, null);
      let at = 0;
      const fill = (minor: boolean) => log.add((at += 1), 'a', minor ? 'choose' : 'reveal', 'x'.repeat(4000), minor);
      while (JSON.stringify(log.data()).length <= (MAX_GAME_LOG_BYTES * 3) / 4) fill(true);
      fill(true);
      while (JSON.stringify(log.data()).length < MAX_GAME_LOG_BYTES - 4500) fill(false);
      return { log, at };
    };
    expect(grown().log.data()?.truncated).toBe(true);
    const room = MAX_GAME_LOG_BYTES - Buffer.byteLength(JSON.stringify(grown().log.data()));
    // One more entry, of every size from well under what is left to well over it: whatever is
    // kept fits, and the rest is dropped.
    const outcomes = { kept: 0, dropped: 0 };
    for (let size = room - 120; size <= room; size += 1) {
      const { log, at } = grown();
      log.add(at + 1, 'a', 'reveal', 'z'.repeat(size));
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
      log.add((at += 1), 'a', 'press', text);
    }
    // The entry that went past the limit was the one after as many as fit.
    expect(at).toBe(Math.floor(MAX_GAME_LOG_BYTES / 10_000) + 1);
    expect(log.data()).toBeNull();
    log.add(at + 1, 'a', 'press', 'small');
    expect(log.data()).toBeNull();
  });
});

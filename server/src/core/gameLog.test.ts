import { describe, expect, test } from 'vitest';
import { GameLog, MAX_GAME_LOG_BYTES } from './gameLog';

describe('the log of a game', () => {
  test('notes each thing in order, from the start of the game, with who did it and what it said', () => {
    const log = new GameLog('test', 'g1', 1000, { seats: { a: 'red' } });
    log.add(1000, 'a', 'test:press', 'hard');
    log.add(2500, null, 'tick');
    log.add(4000, 'b', 'emote', { emote: 'waiting' }, true);
    expect(log.data()).toEqual({
      v: 1,
      game: 'test',
      gameId: 'g1',
      start: { seats: { a: 'red' } },
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

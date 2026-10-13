import { describe, expect, test } from 'vitest';
import { AgentLog, MAX_AGENT_LOG_BYTES } from './agentLog';

describe('the AI log of a game', () => {
  test('keeps each step with its time from the start of the game', () => {
    const log = new AgentLog('game-1', 1_000);
    expect(log.empty).toBe(true);
    log.add(4_000, { by: 'p1', persona: 'reviewer1', kind: 'clue', answer: { word: 'zebra' } });
    log.add(9_000, { by: 'p2', persona: 'reviewer1', takeover: true, kind: 'guess', error: 'busy' });
    expect(log.empty).toBe(false);
    expect(log.data()).toEqual({
      v: 1,
      gameId: 'game-1',
      steps: [
        { t: 3_000, by: 'p1', persona: 'reviewer1', kind: 'clue', answer: { word: 'zebra' } },
        { t: 8_000, by: 'p2', persona: 'reviewer1', takeover: true, kind: 'guess', error: 'busy' },
      ],
    });
  });

  test('stops at its limit and says that it did, staying within it', () => {
    const log = new AgentLog('game-1', 0);
    const reason = 'x'.repeat(1_000);
    for (let i = 0; i < 100; i += 1) log.add(i, { by: 'p1', persona: 'reviewer1', kind: 'guess', answer: { reason } });
    const data = log.data();
    expect(data.truncated).toBe(true);
    expect(data.steps.length).toBeLessThan(100);
    expect(Buffer.byteLength(JSON.stringify(data))).toBeLessThanOrEqual(MAX_AGENT_LOG_BYTES);
    const kept = data.steps.length;
    log.add(200, { by: 'p1', persona: 'reviewer1', kind: 'clue' });
    expect(log.data().steps).toHaveLength(kept);
  });
});

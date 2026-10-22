import { describe, expect, test } from 'vitest';
import {
  AgentLog,
  CERTIFIED_AGENTS,
  certifiedPlay,
  MAX_AGENT_LOG_BYTES,
  type AgentLogData,
  type AgentStep,
} from './agentLog';

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

describe('the certified versions of the AI', () => {
  const v1 = { prompt: 'keywords-1', model: 'model-a' };
  const v2 = { prompt: 'keywords-2', model: 'model-a' };
  const log = (steps: AgentStep[], more: Partial<AgentLogData> = {}): AgentLogData => ({
    v: 1,
    gameId: 'game-1',
    steps,
    ...more,
  });
  // A step with an answer from a version, or from none that the note says, or with no answer.
  const answered = (version: { prompt: string; model: string } | null, more: Partial<AgentStep> = {}): AgentStep => ({
    t: 1,
    by: 'p1',
    persona: 'reviewer1',
    kind: 'clue',
    answer: { word: 'zebra' },
    ...(version === null ? {} : { note: { ...version, ms: 1 } }),
    ...more,
  });
  const unanswered: AgentStep = { t: 2, by: 'p1', persona: 'reviewer1', kind: 'clue', error: 'busy' };

  test('are none yet, so that a game an AI played in brings nothing', () => {
    expect(
      CERTIFIED_AGENTS,
      'No version of the AI is certified yet. The first one needs more than this list: the records page ' +
        '(RecordStore.#recent, GameRecord.agents) in server/src/store/records.ts, the score floats ' +
        '(RoomView.agentsPlayed), the points of the second game (pointsShown in ' +
        'server/src/games/impostor/results.ts) and the docs (docs/architecture.md#ai-players, both ' +
        'READMEs) take "an AI played" for "brought nothing", and must decide by certifiedPlay() as the ' +
        'room and the recount do, and with them the record of each game (replays.scores_nothing), by which ' +
        'the streaks and the friend duos go.',
    ).toEqual([]);
    expect(certifiedPlay(log([answered(v1)]))).toBe(false);
  });

  test('let a game count when every answer the AI gave in it came from one of them', () => {
    expect(certifiedPlay(log([answered(v1), answered(v1, { takeover: true, kind: 'guess' })]), [v1])).toBe(true);
    expect(certifiedPlay(log([answered(v1), answered(v2)]), [v1, v2])).toBe(true);
    // An answer from another version, or from a version that the note doesn't say, counts against
    // the game; one that came too late to be of use is an answer like any other.
    expect(certifiedPlay(log([answered(v1), answered(v2)]), [v1])).toBe(false);
    expect(certifiedPlay(log([answered(v1), answered({ ...v1, model: 'model-b' })]), [v1])).toBe(false);
    expect(certifiedPlay(log([answered(v1), answered(null)]), [v1])).toBe(false);
    expect(certifiedPlay(log([answered(v1, { late: true })]), [v1])).toBe(true);
    // A step with no answer played nothing, but the AI must have answered at least once.
    expect(certifiedPlay(log([answered(v1), unanswered]), [v1])).toBe(true);
    expect(certifiedPlay(log([unanswered]), [v1])).toBe(false);
    expect(certifiedPlay(log([]), [v1])).toBe(false);
    expect(certifiedPlay(null, [v1])).toBe(false);
    // A log cut short may have lost an answer from another version.
    expect(certifiedPlay(log([answered(v1)], { truncated: true }), [v1])).toBe(false);
  });
});

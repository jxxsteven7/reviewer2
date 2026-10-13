import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Rooms } from './core/rooms';
import {
  collectStats,
  History,
  HISTORY_MS,
  STATS_LOG_ALWAYS_MS,
  STATS_LOG_MS,
  statsLog,
  watchStats,
  type Stats,
} from './stats';

const noRooms = { all: () => [] } as unknown as Rooms;

function stats(changes: Partial<Stats> = {}): Stats {
  return {
    version: 'test',
    uptime: 60,
    memory: { rss: 80 * 2 ** 20, heapUsed: 20 * 2 ** 20, limit: null },
    rooms: { lobby: 1, playing: 2, ended: 0 },
    players: { online: 7, offline: 1 },
    agents: null,
    connections: { websocket: 6, polling: 2 },
    countries: [
      { country: 'SG', connections: 5, latency: 40 },
      { country: 'CN', connections: 3, latency: 180 },
    ],
    ...changes,
  };
}

describe('collectStats', () => {
  test('counts connections by transport and by country, with the median latency of each country', () => {
    const result = collectStats('v1', noRooms, [
      { transport: 'websocket', country: 'CN', latency: 300 },
      { transport: 'websocket', country: 'SG', latency: 40 },
      { transport: 'polling', country: 'CN', latency: 100 },
      { transport: 'websocket', country: 'CN', latency: null },
      { transport: 'websocket', country: 'CN', latency: 120 },
      { transport: 'polling', country: 'XX', latency: null },
      { transport: 'websocket', country: 'SG', latency: 61 },
    ]);
    expect(result.version).toBe('v1');
    expect(result.connections).toEqual({ websocket: 5, polling: 2 });
    // Most connections first; a country whose connections have no heartbeat yet has no latency.
    expect(result.countries).toEqual([
      { country: 'CN', connections: 4, latency: 120 },
      { country: 'SG', connections: 2, latency: 51 },
      { country: 'XX', connections: 1, latency: null },
    ]);
  });

  test('puts countries with as many connections in alphabetical order', () => {
    const result = collectStats('v1', noRooms, [
      { transport: 'websocket', country: 'SG', latency: null },
      { transport: 'websocket', country: 'MY', latency: null },
    ]);
    expect(result.countries.map(({ country }) => country)).toEqual(['MY', 'SG']);
  });

  test('reports the memory, and a limit only when there is one', () => {
    const { memory, uptime } = collectStats('v1', noRooms, []);
    expect(memory.rss).toBeGreaterThan(0);
    expect(memory.heapUsed).toBeGreaterThan(0);
    expect(memory.limit === null || memory.limit > memory.rss).toBe(true);
    expect(uptime).toBeGreaterThanOrEqual(0);
  });
});

describe('the stats line', () => {
  test('carries the counts and the memory in megabytes, but nothing about latency', () => {
    const log = vi.fn();
    statsLog(log)(stats());
    expect(log).toHaveBeenCalledExactlyOnceWith('stats', {
      rooms: { lobby: 1, playing: 2, ended: 0 },
      players: { online: 7, offline: 1 },
      connections: { websocket: 6, polling: 2 },
      countries: { SG: 5, CN: 3 },
      memoryMb: { rss: 80, heapUsed: 20 },
    });
  });

  test('is skipped while the counts stay the same, however the memory and latency change', () => {
    const log = vi.fn();
    const write = statsLog(log);
    write(stats());
    write(stats({ uptime: 360, memory: { rss: 90 * 2 ** 20, heapUsed: 30 * 2 ** 20, limit: null } }));
    write(
      stats({
        countries: [
          { country: 'SG', connections: 5, latency: 400 },
          { country: 'CN', connections: 3, latency: null },
        ],
      }),
    );
    expect(log).toHaveBeenCalledTimes(1);
    write(stats({ players: { online: 6, offline: 2 } }));
    expect(log).toHaveBeenCalledTimes(2);
    // Back to what an earlier line said is still a change from the last one.
    write(stats());
    expect(log).toHaveBeenCalledTimes(3);
  });

  test('is written once an hour anyway, so that the memory stays in the log', () => {
    expect(STATS_LOG_ALWAYS_MS / STATS_LOG_MS).toBe(12);
    const log = vi.fn();
    const write = statsLog(log, 3);
    for (let call = 1; call <= 7; call += 1) {
      write(stats({ memory: { rss: call * 2 ** 20, heapUsed: 2 ** 20, limit: null } }));
    }
    // The first line, and then every third call: the memory of the 1st, the 4th and the 7th.
    expect(log.mock.calls.map(([, fields]) => (fields as { memoryMb: { rss: number } }).memoryMb.rss)).toEqual([
      1, 4, 7,
    ]);
    // A change starts the hour over.
    write(stats({ players: { online: 1, offline: 0 } }));
    write(stats({ players: { online: 1, offline: 0 } }));
    write(stats({ players: { online: 1, offline: 0 } }));
    expect(log).toHaveBeenCalledTimes(4);
    write(stats({ players: { online: 1, offline: 0 } }));
    expect(log).toHaveBeenCalledTimes(5);
  });
});

describe('History', () => {
  test('keeps the players online and the rooms of each sample, as far back as its span', () => {
    let at = 0;
    const history = new History({ span: 2, now: () => at });
    for (at = 1; at <= 5; at += 1) history.add(stats({ players: { online: at, offline: 0 } }));
    expect(history.samples()).toEqual([
      { at: 3, players: 3, rooms: 3 },
      { at: 4, players: 4, rooms: 3 },
      { at: 5, players: 5, rooms: 3 },
    ]);
    expect(history.now()).toBe(6);
  });

  test('goes back 24 hours, on a clock that only runs forward', () => {
    const history = new History();
    expect(history.span).toBe(HISTORY_MS);
    expect(HISTORY_MS).toBe(24 * 60 * 60_000);
    const before = performance.now();
    const now = history.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(performance.now());
  });
});

describe('watchStats', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('writes a line every 5 minutes when something changed, and samples every 30 seconds', () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const history = new History();
    let current = stats();
    const stop = watchStats(() => current, log, history);

    vi.advanceTimersByTime(STATS_LOG_MS - 1);
    expect(log).not.toHaveBeenCalled();
    expect(history.samples()).toHaveLength(9);
    vi.advanceTimersByTime(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(history.samples()).toHaveLength(10);

    vi.advanceTimersByTime(STATS_LOG_MS);
    expect(log).toHaveBeenCalledTimes(1);
    current = stats({ rooms: { lobby: 0, playing: 0, ended: 0 } });
    vi.advanceTimersByTime(STATS_LOG_MS);
    expect(log).toHaveBeenCalledTimes(2);

    stop();
    current = stats();
    vi.advanceTimersByTime(STATS_LOG_MS);
    expect(log).toHaveBeenCalledTimes(2);
    expect(history.samples()).toHaveLength(30);
  });

  test('takes other times when it is given them', () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const history = new History();
    const stop = watchStats(() => stats(), log, history, { logMs: 1_000, sampleMs: 100 });
    vi.advanceTimersByTime(1_000);
    stop();
    expect(log).toHaveBeenCalledTimes(1);
    expect(history.samples()).toHaveLength(10);
  });

  test('takes no samples without a history to keep them', () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const collect = vi.fn(() => stats());
    const stop = watchStats(collect, log, null, { logMs: 1_000, sampleMs: 100 });
    vi.advanceTimersByTime(1_000);
    stop();
    expect(collect).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
  });

  test('logs what counting throws and goes on, rather than end the process', () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const history = new History();
    let broken = true;
    const collect = () => {
      if (broken) throw new Error('EMFILE: too many open files, uv_resident_set_memory');
      return stats();
    };
    const stop = watchStats(collect, log, history, { logMs: 100, sampleMs: 50 });
    vi.advanceTimersByTime(100);
    const message = 'EMFILE: too many open files, uv_resident_set_memory';
    expect(log).toHaveBeenCalledWith('error', { where: 'sample', message });
    expect(log).toHaveBeenCalledWith('error', { where: 'stats', message });
    expect(history.samples()).toHaveLength(0);
    broken = false;
    log.mockClear();
    vi.advanceTimersByTime(100);
    stop();
    expect(log).toHaveBeenCalledExactlyOnceWith(
      'stats',
      expect.objectContaining({ players: { online: 7, offline: 1 } }),
    );
    expect(history.samples()).toHaveLength(2);
  });
});

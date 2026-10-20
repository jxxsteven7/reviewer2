import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Rooms } from './core/rooms';
import type { ConnectionInfo } from './core/socket';
import { collectStats, STATS_LOG_ALWAYS_MS, STATS_LOG_MS, statsLog, watchStats, type Stats } from './stats';

const noRooms = { all: () => [] } as unknown as Rooms;

// A connection that is in no room and logged in to no account: those count for nothing here.
const connection = (transport: string, country: string, latency: number | null): ConnectionInfo => ({
  transport,
  country,
  latency,
  account: null,
  room: null,
});

function stats(changes: Partial<Stats> = {}): Stats {
  return {
    version: 'test',
    uptime: 60,
    busy: false,
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
      connection('websocket', 'CN', 300),
      connection('websocket', 'SG', 40),
      connection('polling', 'CN', 100),
      connection('websocket', 'CN', null),
      connection('websocket', 'CN', 120),
      connection('polling', 'XX', null),
      connection('websocket', 'SG', 61),
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
      connection('websocket', 'SG', null),
      connection('websocket', 'MY', null),
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

describe('watchStats', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('writes a line every 5 minutes when something changed', () => {
    vi.useFakeTimers();
    const log = vi.fn();
    let current = stats();
    const stop = watchStats(() => current, log);

    vi.advanceTimersByTime(STATS_LOG_MS - 1);
    expect(log).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(log).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(STATS_LOG_MS);
    expect(log).toHaveBeenCalledTimes(1);
    current = stats({ rooms: { lobby: 0, playing: 0, ended: 0 } });
    vi.advanceTimersByTime(STATS_LOG_MS);
    expect(log).toHaveBeenCalledTimes(2);

    stop();
    current = stats();
    vi.advanceTimersByTime(STATS_LOG_MS);
    expect(log).toHaveBeenCalledTimes(2);
  });

  test('takes another time when it is given one', () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const collect = vi.fn(() => stats());
    const stop = watchStats(collect, log, { logMs: 1_000 });
    vi.advanceTimersByTime(1_000);
    stop();
    expect(collect).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
  });

  test('logs what counting throws and goes on, rather than end the process', () => {
    vi.useFakeTimers();
    const log = vi.fn();
    let broken = true;
    const collect = () => {
      if (broken) throw new Error('EMFILE: too many open files, uv_resident_set_memory');
      return stats();
    };
    const stop = watchStats(collect, log, { logMs: 100 });
    vi.advanceTimersByTime(100);
    const message = 'EMFILE: too many open files, uv_resident_set_memory';
    expect(log).toHaveBeenCalledExactlyOnceWith('error', { where: 'stats', message });
    broken = false;
    log.mockClear();
    vi.advanceTimersByTime(100);
    stop();
    expect(log).toHaveBeenCalledExactlyOnceWith(
      'stats',
      expect.objectContaining({ players: { online: 7, offline: 1 } }),
    );
  });
});

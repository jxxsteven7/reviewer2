import { totalmem } from 'node:os';
import type { RoomPhase } from '@reviewer2/shared';
import { megabytes, memoryLimit } from './core/load';
import type { Rooms } from './core/rooms';
import type { ConnectionInfo } from './core/socket';

// What the operator sees of the server (docs/architecture.md). The `stats` log line and
// /status.json on the status port both come from collectStats(). None of it says who anyone is: no
// addresses, tokens, names, ids or room codes, and countries only as counts.

export interface Stats {
  version: string;
  // Seconds since the process started.
  uptime: number;
  // Whether the server is busy, and turns newcomers away (core/load.ts).
  busy: boolean;
  // In bytes. `limit` is the memory that the system allows the process, such as systemd's
  // MemoryMax, or null when it sets none. The system counts the limit against more than `rss`:
  // against every process of the service and the file cache it uses. The cache is given up
  // first, so the process's own share is still what matters.
  memory: { rss: number; heapUsed: number; limit: number | null };
  rooms: Record<RoomPhase, number>;
  // The people in all rooms: online with at least one connection, or offline, with a seat to come
  // back to. AI players aren't people, and are counted apart.
  players: { online: number; offline: number };
  // The AI players (docs/architecture.md#ai-players), or null on a server without an agent: how many
  // are in the rooms, whether the agent answers, and how many steps they took in the last hour and
  // how many of those failed.
  agents: { players: number; up: boolean; steps: number; failures: number } | null;
  connections: { websocket: number; polling: number };
  // Most connections first. `latency` is the median of the connections' last heartbeats, in
  // milliseconds, or null while none has come back.
  countries: { country: string; connections: number; latency: number | null }[];
}

// How often the log gets a `stats` line when something changed, and how often it gets one anyway.
export const STATS_LOG_MS = 5 * 60_000;
export const STATS_LOG_ALWAYS_MS = 60 * 60_000;

export function collectStats(
  version: string,
  rooms: Rooms,
  connections: readonly ConnectionInfo[],
  agents: { up: boolean; steps: number; failures: number } | null = null,
  busy = false,
): Stats {
  const stats: Stats = {
    version,
    uptime: Math.round(process.uptime()),
    busy,
    memory: memory(),
    rooms: { lobby: 0, playing: 0, ended: 0 },
    players: { online: 0, offline: 0 },
    agents: agents && { players: 0, ...agents },
    connections: { websocket: 0, polling: 0 },
    countries: [],
  };
  for (const room of rooms.all()) {
    stats.rooms[room.phase] += 1;
    const online = room.onlineCount();
    const ai = [...room.members.values()].filter((member) => member.agent).length;
    stats.players.online += online;
    stats.players.offline += room.members.size - ai - online;
    if (stats.agents) stats.agents.players += ai;
  }
  const countries = new Map<string, { connections: number; latencies: number[] }>();
  for (const { transport, country, latency } of connections) {
    // Anything but WebSocket is long-polling, before the upgrade to WebSocket or instead of it.
    stats.connections[transport === 'websocket' ? 'websocket' : 'polling'] += 1;
    const entry = countries.get(country) ?? { connections: 0, latencies: [] };
    countries.set(country, entry);
    entry.connections += 1;
    if (latency !== null) entry.latencies.push(latency);
  }
  stats.countries = [...countries]
    .map(([country, { connections, latencies }]) => ({ country, connections, latency: median(latencies) }))
    .sort((a, b) => b.connections - a.connections || a.country.localeCompare(b.country));
  return stats;
}

function memory(): Stats['memory'] {
  const { rss, heapUsed } = process.memoryUsage();
  const limit = memoryLimit();
  return { rss, heapUsed, limit: limit < totalmem() ? limit : null };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2);
}

type Log = (event: string, fields?: Record<string, unknown>) => void;

// Returns what writes a `stats` line, unless the rooms, players, connections and countries are
// what they were in the last one, so a quiet server writes little. The memory comes along in
// megabytes but doesn't count as a change, since it is never quite the same. The latency stays
// out of the log for that reason. A line is written anyway once in `always` calls, with the
// 5-minute timer once an hour, so that the log still shows how the memory goes while nothing
// else changes.
export function statsLog(log: Log, always = STATS_LOG_ALWAYS_MS / STATS_LOG_MS): (stats: Stats) => void {
  let last = '';
  let skipped = 0;
  return (stats) => {
    const counts = {
      rooms: stats.rooms,
      players: stats.players,
      connections: stats.connections,
      countries: Object.fromEntries(stats.countries.map(({ country, connections }) => [country, connections])),
    };
    const key = JSON.stringify(counts);
    if (key === last && skipped < always - 1) {
      skipped += 1;
      return;
    }
    last = key;
    skipped = 0;
    log('stats', {
      ...counts,
      memoryMb: { rss: megabytes(stats.memory.rss), heapUsed: megabytes(stats.memory.heapUsed) },
    });
  };
}

// Writes the `stats` line, on its own clock until the returned function stops it. The time can be
// changed for tests. Counting throws only when the system does, as process.memoryUsage() does when
// the process has run out of file descriptors, and a timer that threw would end the process: here
// it is logged and the next tick tries again.
export function watchStats(collect: () => Stats, log: Log, { logMs = STATS_LOG_MS } = {}): () => void {
  const write = statsLog(log);
  const timer = setInterval(() => {
    try {
      write(collect());
    } catch (error) {
      log('error', { where: 'stats', message: error instanceof Error ? error.message : String(error) });
    }
  }, logMs);
  timer.unref();
  return () => clearInterval(timer);
}

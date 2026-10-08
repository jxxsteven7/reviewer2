import { totalmem } from 'node:os';
import type { RoomPhase } from '@reviewer2/shared';
import type { Rooms } from './core/rooms';
import type { ConnectionInfo } from './core/socket';

// What the operator sees of the server (docs/architecture.md). The `stats` log line and the status
// page both come from collectStats(). None of it says who anyone is: no addresses, tokens, names
// or room codes, and countries only as counts.

export interface Stats {
  version: string;
  // Seconds since the process started.
  uptime: number;
  // In bytes. `limit` is the memory that the system allows the process, such as systemd's
  // MemoryMax, or null when it sets none.
  memory: { rss: number; heapUsed: number; limit: number | null };
  rooms: Record<RoomPhase, number>;
  // The members of all rooms: online with at least one connection, or offline, with a seat to
  // come back to.
  players: { online: number; offline: number };
  connections: { websocket: number; polling: number };
  // Most connections first. `latency` is the median of the connections' last heartbeats, in
  // milliseconds, or null while none has come back.
  countries: { country: string; connections: number; latency: number | null }[];
}

// How often the log gets a `stats` line, and how often the status page's chart gets a sample.
export const STATS_LOG_MS = 5 * 60_000;
export const SAMPLE_MS = 30_000;

export function collectStats(version: string, rooms: Rooms, connections: readonly ConnectionInfo[]): Stats {
  const stats: Stats = {
    version,
    uptime: Math.round(process.uptime()),
    memory: memory(),
    rooms: { lobby: 0, playing: 0, ended: 0 },
    players: { online: 0, offline: 0 },
    connections: { websocket: 0, polling: 0 },
    countries: [],
  };
  for (const room of rooms.all()) {
    stats.rooms[room.phase] += 1;
    const online = room.onlineCount();
    stats.players.online += online;
    stats.players.offline += room.members.size - online;
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
  // Without a limit, Node reports a number far beyond the memory there is.
  const limit = process.constrainedMemory();
  return { rss, heapUsed, limit: limit > 0 && limit < totalmem() ? limit : null };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2);
}

const megabytes = (bytes: number) => Math.round(bytes / 2 ** 20);

type Log = (event: string, fields?: Record<string, unknown>) => void;

// Returns what writes a `stats` line, unless the rooms, players, connections and countries are
// what they were in the last one, so a quiet server writes nothing. The memory comes along in
// megabytes but doesn't count as a change, since it is never quite the same. The latency stays
// out of the log for that reason.
export function statsLog(log: Log): (stats: Stats) => void {
  let last = '';
  return (stats) => {
    const counts = {
      rooms: stats.rooms,
      players: stats.players,
      connections: stats.connections,
      countries: Object.fromEntries(stats.countries.map(({ country, connections }) => [country, connections])),
    };
    const key = JSON.stringify(counts);
    if (key === last) return;
    last = key;
    log('stats', {
      ...counts,
      memoryMb: { rss: megabytes(stats.memory.rss), heapUsed: megabytes(stats.memory.heapUsed) },
    });
  };
}

export interface Sample {
  // When the sample was taken, in milliseconds since 1970.
  at: number;
  players: number;
  rooms: number;
}

// The players online and the rooms open, every 30 seconds for the last 24 hours, for the status
// page's chart. It lives in memory, so it starts again with every restart.
export class History {
  readonly #samples: Sample[] = [];

  constructor(readonly size = (24 * 60 * 60_000) / SAMPLE_MS) {}

  add(stats: Stats, at = Date.now()): void {
    const { lobby, playing, ended } = stats.rooms;
    this.#samples.push({ at, players: stats.players.online, rooms: lobby + playing + ended });
    if (this.#samples.length > this.size) this.#samples.shift();
  }

  samples(): readonly Sample[] {
    return this.#samples;
  }
}

// Writes the `stats` line and takes the chart's samples on their own clocks until the returned
// function stops them. The times can be changed for tests.
export function watchStats(
  collect: () => Stats,
  log: Log,
  history: History,
  { logMs = STATS_LOG_MS, sampleMs = SAMPLE_MS } = {},
): () => void {
  const write = statsLog(log);
  const timers = [setInterval(() => write(collect()), logMs), setInterval(() => history.add(collect()), sampleMs)];
  for (const timer of timers) timer.unref();
  return () => timers.forEach((timer) => clearInterval(timer));
}

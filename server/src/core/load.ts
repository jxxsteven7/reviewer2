import { totalmem } from 'node:os';
import { getHeapStatistics } from 'node:v8';

// How much of the server one address, and everyone at once, may take
// (docs/architecture.md#limits-and-housekeeping): how many connections one address may have open
// at once, and when the server is too busy for newcomers. A busy server is never shut down, which
// would only finish what an attacker started: it goes on for whoever is in a room, turns newcomers
// away, and takes them again by itself once the load has come down.

type Log = (event: string, fields?: Record<string, unknown>) => void;

export const DEFAULT_CONNECTIONS_PER_ADDRESS = 100;
export const DEFAULT_BUSY_CONNECTIONS = 10_000;
// The share of the memory that the process can have in use (defaultBusyMemory) at which it is
// busy, unless BUSY_MEMORY_MB says otherwise.
export const DEFAULT_BUSY_MEMORY_SHARE = 0.9;
// A busy server stays busy until both the connections and the memory are below this share of what
// made it busy, so that a load right at the line doesn't turn it on and off with every connection.
export const RECOVERY_SHARE = 0.9;
// While the server is busy, a member comes back to their seat on this many connections at most, a
// phone and a computer and one whose end hasn't been noticed yet, and a screen comes back to its
// room while the room has fewer screens than it may have (MAX_SCREENS). Past that, a seat's token
// would let whoever holds it open as many connections as they like through a busy server.
export const BUSY_MEMBER_CONNECTIONS = 3;

export const megabytes = (bytes: number): number => Math.round(bytes / 2 ** 20);

// The memory that the process may use, in bytes: the limit that the system sets for it, such as a
// cgroup's memory limit, or else the machine's memory. Without a limit, Node reports a number far
// beyond the memory there is.
export function memoryLimit(): number {
  const limit = process.constrainedMemory();
  return limit > 0 && limit < totalmem() ? limit : totalmem();
}

// The most that V8 lets the heap grow to, in bytes: past it, the process doesn't run on with less
// memory but dies. Node sets it from the memory the process may use, and `--max-old-space-size`
// sets it by hand.
export const heapLimit = (): number => getHeapStatistics().heap_size_limit;

// The memory that the process has in use, in bytes: its heap, and what Node holds outside it,
// such as buffers. The resident memory that /status.json shows (stats.ts) counts as well what V8
// has freed but keeps for what it allocates next, which it hardly ever gives back to the system: a
// server judged by that would stay busy for good after one spike, since what it has in use could
// come down to nothing and the resident memory would stay where the spike left it. V8 is asked
// rather than process.memoryUsage(), which reads the resident memory from the system as well, and
// throws when the process has run out of file descriptors, as it may just when it is busy.
export function memoryInUse(): number {
  const { used_heap_size, external_memory } = getHeapStatistics();
  return used_heap_size + external_memory;
}

// The memory in use at which the server is busy unless BUSY_MEMORY_MB says otherwise, in bytes:
// the share of the memory the process may use, or of the heap's limit if that is less, as it is
// unless the process is kept very small. Measured against the memory the process may use alone,
// the heap would run out, and the process with it, before the server was ever busy.
export function defaultBusyMemory(limit = memoryLimit(), heap = heapLimit()): number {
  return Math.round(DEFAULT_BUSY_MEMORY_SHARE * Math.min(limit, heap));
}

// The connections that each address has open, which Engine.IO's handshake asks before it opens
// another (server.ts). An address is counted by its key in the limits (clientIp.ts), and is
// forgotten once its last connection has closed.
export class AddressConnections {
  readonly #open = new Map<string, number>();

  constructor(readonly max: number) {}

  // Whether the address may open one more.
  admits(address: string): boolean {
    return this.#count(address) < this.max;
  }

  opened(address: string): void {
    this.#open.set(address, this.#count(address) + 1);
  }

  closed(address: string): void {
    const left = this.#count(address) - 1;
    if (left > 0) this.#open.set(address, left);
    else this.#open.delete(address);
  }

  #count(address: string): number {
    return this.#open.get(address) ?? 0;
  }
}

export interface BusyLimits {
  // More connections than this, or this much memory in use, in bytes, make the server busy.
  connections: number;
  memory: number;
}

export interface Load {
  connections: number;
  // The memory in use, in bytes (memoryInUse).
  memory: number;
}

// Whether the server is busy, worked out from the load whenever it is asked, which is when a new
// connection or a new room is asked for, when the status data is, and once a minute (main.ts). The
// log says when the server becomes busy, with `level: "warn"`, and when it stops being so. A load
// that can't be read, as when the system refuses the reading, leaves the server as it was: a
// handshake that threw would end the process, and the reading is logged as an error, once until
// it works again.
export class BusyGauge {
  #busy = false;
  #unreadable = false;

  constructor(
    readonly limits: BusyLimits,
    private readonly read: () => Load,
    private readonly log: Log,
  ) {}

  check(): boolean {
    let load: Load;
    try {
      load = this.read();
    } catch (error) {
      if (!this.#unreadable) {
        this.#unreadable = true;
        this.log('error', { where: 'busy', message: error instanceof Error ? error.message : String(error) });
      }
      return this.#busy;
    }
    this.#unreadable = false;
    const { limits } = this;
    const fields = () => ({
      connections: load.connections,
      memoryMb: megabytes(load.memory),
      busyConnections: limits.connections,
      busyMemoryMb: megabytes(limits.memory),
    });
    if (!this.#busy && (load.connections > limits.connections || load.memory >= limits.memory)) {
      this.#busy = true;
      this.log('busy_started', { level: 'warn', ...fields() });
    } else if (
      this.#busy &&
      load.connections < RECOVERY_SHARE * limits.connections &&
      load.memory < RECOVERY_SHARE * limits.memory
    ) {
      this.#busy = false;
      this.log('busy_ended', fields());
    }
    return this.#busy;
  }
}

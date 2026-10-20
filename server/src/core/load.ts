import { totalmem } from 'node:os';

// How much of the server one address, and everyone at once, may take
// (docs/architecture.md#limits-and-housekeeping): how many connections one address may have open
// at once, and when the server is too busy for newcomers. A busy server is never shut down, which
// would only finish what an attacker started: it goes on for whoever is in a room, turns newcomers
// away, and takes them again by itself once the load has come down.

type Log = (event: string, fields?: Record<string, unknown>) => void;

export const DEFAULT_CONNECTIONS_PER_ADDRESS = 100;
export const DEFAULT_BUSY_CONNECTIONS = 10_000;
// The share of the memory that the process may use (memoryLimit) at which it is busy, unless
// BUSY_MEMORY_MB says otherwise.
export const DEFAULT_BUSY_MEMORY_SHARE = 0.9;
// A busy server stays busy until both the connections and the memory are below this share of what
// made it busy, so that a load right at the line doesn't turn it on and off with every connection.
export const RECOVERY_SHARE = 0.9;

const megabytes = (bytes: number) => Math.round(bytes / 2 ** 20);

// The memory that the process may use, in bytes: the limit that the system sets for it, such as a
// cgroup's memory limit, or else the machine's memory. Without a limit, Node reports a number far
// beyond the memory there is.
export function memoryLimit(): number {
  const limit = process.constrainedMemory();
  return limit > 0 && limit < totalmem() ? limit : totalmem();
}

// The connections that each address has open, which Engine.IO's handshake asks before it opens
// another (server.ts). An address is counted by its key in the limits (clientIp.ts), and is
// forgotten once its last connection has closed.
export class AddressConnections {
  readonly #open = new Map<string, number>();

  constructor(readonly max: number) {}

  // Whether the address may open one more.
  admits(address: string): boolean {
    return this.count(address) < this.max;
  }

  count(address: string): number {
    return this.#open.get(address) ?? 0;
  }

  opened(address: string): void {
    this.#open.set(address, this.count(address) + 1);
  }

  closed(address: string): void {
    const left = this.count(address) - 1;
    if (left > 0) this.#open.set(address, left);
    else this.#open.delete(address);
  }

  // How many addresses have a connection open.
  get addresses(): number {
    return this.#open.size;
  }
}

export interface BusyLimits {
  // More connections than this, or this much memory in bytes, make the server busy.
  connections: number;
  memory: number;
}

export interface Load {
  connections: number;
  // The process's resident memory, in bytes, as /status.json gives it (stats.ts).
  memory: number;
}

// Whether the server is busy, worked out from the load whenever it is asked, which is when a new
// connection or a new room is asked for, when the status data is, and once a minute (main.ts). The
// log says when the server becomes busy, with `level: "warn"`, and when it stops being so.
export class BusyGauge {
  #busy = false;

  constructor(
    readonly limits: BusyLimits,
    private readonly read: () => Load,
    private readonly log: Log,
  ) {}

  get busy(): boolean {
    return this.#busy;
  }

  check(): boolean {
    const load = this.read();
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

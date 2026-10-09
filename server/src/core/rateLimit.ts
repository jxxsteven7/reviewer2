// Two simple limits (docs/architecture.md): a token bucket for each connection, which allows short
// bursts, and a counter per address over a fixed window, for new rooms and for codes without a
// room.
//
// Neither trusts its clock to run forward. The server gives them one that does (server.ts), but a
// clock that is set back must cost at most a moment of leniency, never lock anyone out: a bucket
// would otherwise owe tokens for as long as the clock went back, and a window would stay open
// until the clock had caught up with its start.

export class TokenBucket {
  #tokens: number;
  #updated: number;

  constructor(
    private readonly perSecond: number,
    private readonly burst: number,
    private readonly now: () => number,
  ) {
    this.#tokens = burst;
    this.#updated = now();
  }

  take(): boolean {
    const time = this.now();
    const elapsed = Math.max(0, time - this.#updated);
    this.#tokens = Math.min(this.burst, this.#tokens + (elapsed / 1000) * this.perSecond);
    this.#updated = time;
    if (this.#tokens < 1) return false;
    this.#tokens -= 1;
    return true;
  }
}

export class WindowCounter {
  readonly #windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  // Whether the key is still under its limit in the current window.
  allowed(key: string): boolean {
    const window = this.#current(key);
    return window === undefined || window.count < this.limit;
  }

  add(key: string): void {
    const window = this.#current(key);
    if (window) window.count += 1;
    else this.#windows.set(key, { start: this.now(), count: 1 });
  }

  // Counts one against the key if it is still under its limit, and says whether it was. Checking
  // and counting in one step is for what awaits between the two, such as hashing a password:
  // requests that arrive together would otherwise all pass the check before any is counted.
  take(key: string): boolean {
    if (!this.allowed(key)) return false;
    this.add(key);
    return true;
  }

  // Gives back one that was taken, for an attempt that came to nothing.
  refund(key: string): void {
    const window = this.#current(key);
    if (window && window.count > 0) window.count -= 1;
  }

  // Starts the key's count again.
  forget(key: string): void {
    this.#windows.delete(key);
  }

  // Forget the windows that have run out, so the map doesn't grow forever.
  prune(): void {
    for (const key of [...this.#windows.keys()]) this.#current(key);
  }

  #current(key: string) {
    const window = this.#windows.get(key);
    if (!window) return undefined;
    const age = this.now() - window.start;
    // A window that starts in the future was opened before the clock was set back.
    if (age < 0 || age >= this.windowMs) {
      this.#windows.delete(key);
      return undefined;
    }
    return window;
  }
}

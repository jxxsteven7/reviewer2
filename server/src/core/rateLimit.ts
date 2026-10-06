// Two simple limits (docs/architecture.md): a token bucket for each connection, which allows short
// bursts, and a counter per address over a fixed window, for room creation and failed joins.

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
    this.#tokens = Math.min(this.burst, this.#tokens + ((time - this.#updated) / 1000) * this.perSecond);
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

  // Forget the windows that have run out, so the map doesn't grow forever.
  prune(): void {
    for (const key of [...this.#windows.keys()]) this.#current(key);
  }

  #current(key: string) {
    const window = this.#windows.get(key);
    if (window && this.now() - window.start >= this.windowMs) {
      this.#windows.delete(key);
      return undefined;
    }
    return window;
  }
}

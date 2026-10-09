import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { normalizePassword } from '@reviewer2/shared';

// Passwords are kept as scrypt hashes (docs/architecture.md), with a random salt and the
// parameters they were made with: "scrypt$<log2 N>$<r>$<p>$<salt>$<hash>", salt and hash in
// base64url. When the parameters are raised, a hash made with the old ones still verifies, and is
// made again with the new ones at the next login.
//
// N = 2^15, r = 8 and p = 3 take 32 MiB and about 115 ms on a current desktop CPU.
// At most two hashes are worked on at a time, so that a flood of logins costs at most 64 MiB and
// two of libuv's four threads, which the static files need too; up to 32 more wait their turn,
// and past that the server answers `busy`.

export interface ScryptParams {
  log2N: number;
  r: number;
  p: number;
}

export const SCRYPT: ScryptParams = { log2N: 15, r: 8, p: 3 };

const KEY_BYTES = 32;
const SALT_BYTES = 16;
const FORMAT = /^scrypt\$(\d{1,2})\$(\d{1,2})\$(\d{1,2})\$([A-Za-z0-9_-]{16,64})\$([A-Za-z0-9_-]{43})$/;

// Parameters beyond these are not ours, and would cost too much to try.
const sane = ({ log2N, r, p }: ScryptParams) => log2N >= 10 && log2N <= 20 && r >= 1 && r <= 16 && p >= 1 && p <= 16;

function derive(password: string, salt: Buffer, { log2N, r, p }: ScryptParams): Promise<Buffer> {
  const N = 2 ** log2N;
  return new Promise((resolve, reject) => {
    // maxmem must be above 128 * N * r, which scrypt needs.
    scrypt(normalizePassword(password), salt, KEY_BYTES, { N, r, p, maxmem: 256 * N * r }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

const encode = ({ log2N, r, p }: ScryptParams, salt: Buffer, key: Buffer) =>
  `scrypt$${log2N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;

function decode(stored: string): { params: ScryptParams; salt: Buffer; key: Buffer } | null {
  const match = FORMAT.exec(stored);
  if (!match) return null;
  const [, log2N, r, p, salt, key] = match as unknown as [string, string, string, string, string, string];
  const params = { log2N: Number(log2N), r: Number(r), p: Number(p) };
  return sane(params) ? { params, salt: Buffer.from(salt, 'base64url'), key: Buffer.from(key, 'base64url') } : null;
}

const sameParams = (a: ScryptParams, b: ScryptParams) => a.log2N === b.log2N && a.r === b.r && a.p === b.p;

// Thrown when too many hashes are waiting already.
export class BusyError extends Error {
  constructor() {
    super('too many passwords are being checked at once');
  }
}

export interface Verification {
  ok: boolean;
  // Whether the hash was made with other parameters than the current ones.
  outdated: boolean;
}

export class PasswordHasher {
  #active = 0;
  readonly #waiting: (() => void)[] = [];
  // What a password is checked against when there is no account by that name, so that the answer
  // takes as long either way.
  readonly #dummy: Buffer = randomBytes(SALT_BYTES);

  constructor(
    readonly params: ScryptParams = SCRYPT,
    private readonly concurrency = 2,
    private readonly queue = 32,
  ) {}

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await this.#run(() => derive(password, salt, this.params));
    return encode(this.params, salt, key);
  }

  // Checks a password against a stored hash. Without one, as for a name that no account has, it
  // does the same work and fails, so that nobody can tell the two apart by the time it takes. A
  // hash that can't be read fails too.
  async verify(password: string, stored: string | null): Promise<Verification> {
    const decoded = stored === null ? null : decode(stored);
    if (!decoded) {
      await this.#run(() => derive(password, this.#dummy, this.params));
      return { ok: false, outdated: false };
    }
    const key = await this.#run(() => derive(password, decoded.salt, decoded.params));
    const ok = key.length === decoded.key.length && timingSafeEqual(key, decoded.key);
    return { ok, outdated: ok && !sameParams(decoded.params, this.params) };
  }

  async #run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#active >= this.concurrency) {
      if (this.#waiting.length >= this.queue) throw new BusyError();
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    } else {
      this.#active += 1;
    }
    try {
      return await task();
    } finally {
      // The next in line takes this one's place, so the count of those at work stays the same.
      const next = this.#waiting.shift();
      if (next) next();
      else this.#active -= 1;
    }
  }
}

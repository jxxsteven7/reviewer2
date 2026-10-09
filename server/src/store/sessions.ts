import type { DatabaseSync, StatementSync } from 'node:sqlite';

// The logins and the links in mails (migration 2, docs/architecture.md). Both are kept by the
// SHA-256 of their token, never by the token itself: the token is in a browser's cookie or in a
// mail, and whoever reads the database learns nothing that could be used as one.

const DAY_MS = 24 * 60 * 60_000;

export interface SessionLimits {
  // A login that hasn't been used for this long has ended.
  idleMs: number;
  // And one that is this old has ended however much it is used.
  lifetimeMs: number;
  // How often the time a login was last used is written down. Every reconnect uses it, and a
  // write for each would be wasted: an hour more or less of 30 days changes nothing.
  touchMs: number;
  // How many browsers one account may be logged in on. A new login ends the one used longest ago.
  perAccount: number;
}

export const DEFAULT_SESSION_LIMITS: SessionLimits = {
  idleMs: 30 * DAY_MS,
  lifetimeMs: 365 * DAY_MS,
  touchMs: 60 * 60_000,
  perAccount: 20,
};

const iso = (time: number) => new Date(time).toISOString();

// The clock is the system's, in milliseconds since 1970: a login lasts 30 days of the calendar,
// across restarts.
export class SessionStore {
  readonly #insert: StatementSync;
  readonly #find: StatementSync;
  readonly #touch: StatementSync;
  readonly #delete: StatementSync;
  readonly #deleteOthers: StatementSync;
  readonly #trim: StatementSync;
  readonly #prune: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
    readonly limits: SessionLimits = DEFAULT_SESSION_LIMITS,
  ) {
    this.#insert = db.prepare('INSERT INTO sessions (token_hash, account_id, created_at, used_at) VALUES (?, ?, ?, ?)');
    this.#find = db.prepare(
      'SELECT account_id AS accountId, used_at AS usedAt FROM sessions ' +
        'WHERE token_hash = ? AND used_at > ? AND created_at > ?',
    );
    this.#touch = db.prepare('UPDATE sessions SET used_at = ? WHERE token_hash = ?');
    this.#delete = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
    this.#deleteOthers = db.prepare(
      'DELETE FROM sessions WHERE account_id = ? AND token_hash IS NOT ? RETURNING token_hash AS hash',
    );
    this.#trim = db.prepare(
      'DELETE FROM sessions WHERE account_id = ? AND token_hash NOT IN (' +
        'SELECT token_hash FROM sessions WHERE account_id = ? ORDER BY used_at DESC, created_at DESC LIMIT ?' +
        ') RETURNING token_hash AS hash',
    );
    this.#prune = db.prepare('DELETE FROM sessions WHERE used_at <= ? OR created_at <= ?');
  }

  // A new login. Returns the logins of the same account that it ended, for being one too many.
  create(hash: Uint8Array, accountId: number): Uint8Array[] {
    const time = iso(this.now());
    this.#insert.run(hash, accountId, time, time);
    return (this.#trim.all(accountId, accountId, this.limits.perAccount) as { hash: Uint8Array }[]).map(
      ({ hash: ended }) => ended,
    );
  }

  // The account that a login belongs to, or null when there is no such login or it has ended.
  find(hash: Uint8Array): { accountId: number } | null {
    const now = this.now();
    const row = this.#find.get(hash, iso(now - this.limits.idleMs), iso(now - this.limits.lifetimeMs)) as
      { accountId: number; usedAt: string } | undefined;
    if (!row) return null;
    if (Date.parse(row.usedAt) <= now - this.limits.touchMs) this.#touch.run(iso(now), hash);
    return { accountId: row.accountId };
  }

  delete(hash: Uint8Array): boolean {
    return Number(this.#delete.run(hash).changes) > 0;
  }

  // Ends every login of an account but `except`, and returns the ones it ended.
  deleteForAccount(accountId: number, except: Uint8Array | null = null): Uint8Array[] {
    return (this.#deleteOthers.all(accountId, except) as { hash: Uint8Array }[]).map(({ hash }) => hash);
  }

  // Deletes the logins that have ended, and says how many.
  prune(): number {
    const now = this.now();
    return Number(this.#prune.run(iso(now - this.limits.idleMs), iso(now - this.limits.lifetimeMs)).changes);
  }
}

export type MailPurpose = 'bind' | 'reset';

// The links in mails: one that confirms an email address for an account, and one that resets its
// password. Each works once, until it expires.
export class MailTokenStore {
  readonly #insert: StatementSync;
  readonly #find: StatementSync;
  readonly #delete: StatementSync;
  readonly #deleteForAccount: StatementSync;
  readonly #deleteAll: StatementSync;
  readonly #pending: StatementSync;
  readonly #prune: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.#insert = db.prepare(
      'INSERT INTO email_tokens (token_hash, account_id, purpose, email_fp, expires_at) VALUES (?, ?, ?, ?, ?)',
    );
    this.#find = db.prepare(
      'SELECT account_id AS accountId, email_fp AS emailFp FROM email_tokens ' +
        'WHERE token_hash = ? AND purpose = ? AND expires_at > ?',
    );
    this.#delete = db.prepare('DELETE FROM email_tokens WHERE token_hash = ?');
    this.#deleteForAccount = db.prepare('DELETE FROM email_tokens WHERE account_id = ? AND purpose = ?');
    this.#deleteAll = db.prepare('DELETE FROM email_tokens WHERE purpose = ?');
    this.#pending = db.prepare(
      "SELECT 1 FROM email_tokens WHERE account_id = ? AND purpose = 'bind' AND expires_at > ? LIMIT 1",
    );
    this.#prune = db.prepare('DELETE FROM email_tokens WHERE expires_at <= ?');
  }

  create(hash: Uint8Array, accountId: number, purpose: MailPurpose, emailFp: Uint8Array | null, ttlMs: number): void {
    this.#insert.run(hash, accountId, purpose, emailFp, iso(this.now() + ttlMs));
  }

  // The link's account, and for a link that confirms an address, that address's fingerprint, or
  // null when there is no such link or it has expired.
  find(hash: Uint8Array, purpose: MailPurpose): { accountId: number; emailFp: Uint8Array | null } | null {
    const row = this.#find.get(hash, purpose, iso(this.now())) as
      { accountId: number; emailFp: Uint8Array | null } | undefined;
    return row ?? null;
  }

  delete(hash: Uint8Array): boolean {
    return Number(this.#delete.run(hash).changes) > 0;
  }

  deleteForAccount(accountId: number, purpose: MailPurpose): number {
    return Number(this.#deleteForAccount.run(accountId, purpose).changes);
  }

  // Deletes every link of a purpose, and says how many there were.
  deleteAll(purpose: MailPurpose): number {
    return Number(this.#deleteAll.run(purpose).changes);
  }

  // Whether the account has an address waiting for its confirmation link to be opened.
  pending(accountId: number): boolean {
    return this.#pending.get(accountId, iso(this.now())) !== undefined;
  }

  // Deletes the links that have expired, and says how many.
  prune(): number {
    return Number(this.#prune.run(iso(this.now())).changes);
  }
}

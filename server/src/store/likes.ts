import type { DatabaseSync, StatementSync } from 'node:sqlite';

// The likes table (migration 10, docs/architecture.md#public-profiles): which accounts like which
// profiles. This module only reads and writes rows; who may like whom is for accounts/service.ts.

// An account that likes a profile, as its owner is shown them.
export interface LikerRow {
  id: number;
  handle: string;
  username: string;
  avatar: string | null;
}

// How many likers the owner is shown, the latest first.
export const LIKERS_SHOWN = 100;

// The clock is the system's, in milliseconds since 1970, for the times that are kept.
export class LikeStore {
  readonly #insert: StatementSync;
  readonly #delete: StatementSync;
  readonly #has: StatementSync;
  readonly #count: StatementSync;
  readonly #likers: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.#insert = db.prepare('INSERT OR IGNORE INTO likes (account_id, liker_id, created_at) VALUES (?, ?, ?)');
    this.#delete = db.prepare('DELETE FROM likes WHERE account_id = ? AND liker_id = ?');
    this.#has = db.prepare('SELECT 1 FROM likes WHERE account_id = ? AND liker_id = ?');
    this.#count = db.prepare('SELECT count(*) AS count FROM likes WHERE account_id = ?');
    this.#likers = db.prepare(
      'SELECT accounts.id, accounts.handle, accounts.username, accounts.avatar FROM likes ' +
        'JOIN accounts ON accounts.id = likes.liker_id WHERE likes.account_id = ? ' +
        'ORDER BY likes.created_at DESC, accounts.id DESC LIMIT ?',
    );
  }

  // The liker likes the profile. Says whether that is new: liking it again changes nothing.
  add(accountId: number, likerId: number): boolean {
    return Number(this.#insert.run(accountId, likerId, new Date(this.now()).toISOString()).changes) > 0;
  }

  // The liker takes the like back. Says whether there was one.
  remove(accountId: number, likerId: number): boolean {
    return Number(this.#delete.run(accountId, likerId).changes) > 0;
  }

  has(accountId: number, likerId: number): boolean {
    return this.#has.get(accountId, likerId) !== undefined;
  }

  count(accountId: number): number {
    return (this.#count.get(accountId) as { count: number }).count;
  }

  // The accounts that like the profile, the latest first, at most LIKERS_SHOWN of them.
  likersOf(accountId: number, limit = LIKERS_SHOWN): LikerRow[] {
    return this.#likers.all(accountId, limit) as unknown as LikerRow[];
  }
}

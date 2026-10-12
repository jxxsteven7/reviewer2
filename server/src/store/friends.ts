import type { DatabaseSync, StatementSync } from 'node:sqlite';

// The friendships table (migration 8, docs/architecture.md#friends): one row for each pair of
// accounts between which a request is open, was declined or was accepted. This module only reads
// and writes rows; the rules, and the limits, are in accounts/friends.ts.

export type FriendshipStatus = 'pending' | 'accepted' | 'declined';

export interface Friendship {
  id: number;
  requesterId: number;
  addresseeId: number;
  status: FriendshipStatus;
  createdAt: string;
  // When the request was accepted or declined; null while it is open.
  answeredAt: string | null;
}

// A friend, or the other side of a request, as the account's page lists them.
export interface FriendRow {
  id: number;
  username: string;
  avatar: string | null;
}

// How many friends an account has, and how many requests it has open each way.
export interface FriendCounts {
  friends: number;
  outgoing: number;
  incoming: number;
}

const COLUMNS =
  'id, requester_id AS requesterId, addressee_id AS addresseeId, status, created_at AS createdAt, ' +
  'answered_at AS answeredAt';
const OTHER = 'SELECT accounts.id, accounts.username, accounts.avatar FROM friendships JOIN accounts ON accounts.id = ';

// The clock is the system's, in milliseconds since 1970, for the times that are kept.
export class FriendStore {
  readonly #insert: StatementSync;
  readonly #between: StatementSync;
  readonly #answer: StatementSync;
  readonly #renew: StatementSync;
  readonly #delete: StatementSync;
  readonly #friends: StatementSync;
  readonly #incoming: StatementSync;
  readonly #outgoing: StatementSync;
  readonly #counts: StatementSync;
  readonly #others: StatementSync;
  readonly #pruneDeclined: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.#insert = db.prepare(
      "INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'pending', ?)",
    );
    // The pair in order, as the unique index has it.
    this.#between = db.prepare(
      `SELECT ${COLUMNS} FROM friendships WHERE min(requester_id, addressee_id) = ? AND max(requester_id, addressee_id) = ?`,
    );
    this.#answer = db.prepare('UPDATE friendships SET status = ?, answered_at = ? WHERE id = ?');
    this.#renew = db.prepare(
      "UPDATE friendships SET requester_id = ?, addressee_id = ?, status = 'pending', created_at = ?, answered_at = NULL " +
        'WHERE id = ?',
    );
    this.#delete = db.prepare('DELETE FROM friendships WHERE id = ?');
    this.#friends = db.prepare(
      `${OTHER}CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END ` +
        "WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?) ORDER BY accounts.username_key",
    );
    this.#incoming = db.prepare(
      `${OTHER}requester_id WHERE status = 'pending' AND addressee_id = ? ORDER BY friendships.id`,
    );
    this.#outgoing = db.prepare(
      `${OTHER}addressee_id WHERE status = 'pending' AND requester_id = ? ORDER BY friendships.id`,
    );
    this.#counts = db.prepare(
      "SELECT count(*) FILTER (WHERE status = 'accepted') AS friends, " +
        "count(*) FILTER (WHERE status = 'pending' AND requester_id = ?) AS outgoing, " +
        "count(*) FILTER (WHERE status = 'pending' AND addressee_id = ?) AS incoming " +
        'FROM friendships WHERE requester_id = ? OR addressee_id = ?',
    );
    this.#others = db.prepare(
      'SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS id FROM friendships ' +
        "WHERE status <> 'declined' AND (requester_id = ? OR addressee_id = ?)",
    );
    this.#pruneDeclined = db.prepare("DELETE FROM friendships WHERE status = 'declined' AND answered_at <= ?");
  }

  // The row for a pair, whichever of the two asked, or undefined when there is none.
  between(a: number, b: number): Friendship | undefined {
    return this.#between.get(Math.min(a, b), Math.max(a, b)) as Friendship | undefined;
  }

  // A new request. The caller has made sure that the pair has no row.
  request(requesterId: number, addresseeId: number): void {
    this.#insert.run(requesterId, addresseeId, this.#time());
  }

  // A request that was declined is asked anew, by whoever asks now.
  renew(id: number, requesterId: number, addresseeId: number): void {
    this.#renew.run(requesterId, addresseeId, this.#time(), id);
  }

  accept(id: number): void {
    this.#answer.run('accepted', this.#time(), id);
  }

  decline(id: number): void {
    this.#answer.run('declined', this.#time(), id);
  }

  delete(id: number): void {
    this.#delete.run(id);
  }

  // The account's friends, by username.
  friendsOf(accountId: number): FriendRow[] {
    return this.#friends.all(accountId, accountId, accountId) as unknown as FriendRow[];
  }

  // Those who asked the account, and those the account asked, the oldest first.
  incoming(accountId: number): FriendRow[] {
    return this.#incoming.all(accountId) as unknown as FriendRow[];
  }

  outgoing(accountId: number): FriendRow[] {
    return this.#outgoing.all(accountId) as unknown as FriendRow[];
  }

  counts(accountId: number): FriendCounts {
    return this.#counts.get(accountId, accountId, accountId, accountId) as unknown as FriendCounts;
  }

  // The IDs of the account's friends and of the other side of each request that is open.
  others(accountId: number): number[] {
    return (this.#others.all(accountId, accountId, accountId) as { id: number }[]).map(({ id }) => id);
  }

  // Deletes the declined requests that were answered at or before `before`, and says how many.
  pruneDeclined(before: string): number {
    return Number(this.#pruneDeclined.run(before).changes);
  }

  #time(): string {
    return new Date(this.now()).toISOString();
  }
}

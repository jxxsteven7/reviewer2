import {
  ACKNOWLEDGMENT_KINDS,
  type Acknowledgment,
  type AcknowledgmentCount,
  type AcknowledgmentKind,
  type FeedbackKind,
} from '@reviewer2/shared';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { isUniqueFailure } from './accounts';

// The acknowledgments table (migration 4, docs/architecture.md#acknowledgments). The operator
// writes it, with admin.ts: by adopting feedback that came with a name, or by adding someone by
// hand. Everyone may read the names, kinds and dates (accounts/http.ts); the rest is the
// operator's.

export interface NewAcknowledgment {
  name: string;
  kind: AcknowledgmentKind;
  // The feedback it came from, or null for one added by hand.
  feedbackId: number | null;
  accountId: number | null;
}

// An entry as the operator sees it: with the account's username, while it has an account.
export interface AcknowledgmentEntry extends NewAcknowledgment {
  id: number;
  // When it was given, in ISO 8601 and UTC.
  creditedAt: string;
  username: string | null;
}

// What feedback of each kind is thanked for.
export const kindOfFeedback = (kind: FeedbackKind): AcknowledgmentKind => (kind === 'words' ? 'words' : 'feedback');

const COLUMNS =
  'a.id, a.name, a.kind, a.credited_at AS creditedAt, a.feedback_id AS feedbackId, a.account_id AS accountId, ' +
  'c.username';
const FROM = 'FROM acknowledgments a LEFT JOIN accounts c ON c.id = a.account_id';

// The clock is the system's, in milliseconds since 1970, for the date that is shown.
export class AcknowledgmentStore {
  readonly #insert: StatementSync;
  readonly #list: StatementSync;
  readonly #all: StatementSync;
  readonly #byId: StatementSync;
  readonly #setAccount: StatementSync;
  readonly #delete: StatementSync;
  readonly #counts: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.#insert = db.prepare(
      'INSERT INTO acknowledgments (name, kind, credited_at, feedback_id, account_id) VALUES (?, ?, ?, ?, ?)',
    );
    this.#list = db.prepare(
      'SELECT name, kind, substr(credited_at, 1, 10) AS date FROM acknowledgments ORDER BY credited_at, id',
    );
    this.#all = db.prepare(`SELECT ${COLUMNS} ${FROM} ORDER BY a.id`);
    this.#byId = db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE a.id = ?`);
    this.#setAccount = db.prepare('UPDATE acknowledgments SET account_id = ? WHERE id = ?');
    this.#delete = db.prepare('DELETE FROM acknowledgments WHERE id = ?');
    this.#counts = db.prepare('SELECT kind, count(*) AS count FROM acknowledgments WHERE account_id = ? GROUP BY kind');
  }

  // Adds an entry and returns its id, or null when its feedback has been adopted already.
  add({ name, kind, feedbackId, accountId }: NewAcknowledgment): number | null {
    try {
      const { lastInsertRowid } = this.#insert.run(
        name,
        kind,
        new Date(this.now()).toISOString(),
        feedbackId,
        accountId,
      );
      return Number(lastInsertRowid);
    } catch (error) {
      if (isUniqueFailure(error)) return null;
      throw error;
    }
  }

  // What everyone sees, the oldest first.
  list(): Acknowledgment[] {
    return this.#list.all() as unknown as Acknowledgment[];
  }

  // Every entry, for the operator.
  all(): AcknowledgmentEntry[] {
    return this.#all.all() as unknown as AcknowledgmentEntry[];
  }

  byId(id: number): AcknowledgmentEntry | undefined {
    return this.#byId.get(id) as AcknowledgmentEntry | undefined;
  }

  // Links the entry to an account, or to none with null. Says whether there is such an entry.
  setAccount(id: number, accountId: number | null): boolean {
    return Number(this.#setAccount.run(accountId, id).changes) > 0;
  }

  remove(id: number): boolean {
    return Number(this.#delete.run(id).changes) > 0;
  }

  // How often the account is thanked for each kind, in the order of the kinds.
  counts(accountId: number): AcknowledgmentCount[] {
    const rows = this.#counts.all(accountId) as unknown as AcknowledgmentCount[];
    return ACKNOWLEDGMENT_KINDS.flatMap((kind) => rows.filter((row) => row.kind === kind));
  }
}

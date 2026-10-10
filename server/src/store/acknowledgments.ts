import {
  ACKNOWLEDGMENT_KINDS,
  type AcknowledgmentCount,
  type AcknowledgmentKind,
  type FeedbackKind,
} from '@reviewer2/shared';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { isUniqueFailure } from './accounts';

// The acknowledgments table (migration 4, docs/architecture.md#acknowledgments): whom the operator
// thanked, by adopting feedback or by hand (admin.ts), and the account that each is counted for,
// which an account's page shows. The public list is ACKNOWLEDGMENTS.md, never this table, and
// nothing of it leaves the server but an account's own counts. Like the feedback it is an archive:
// nothing here deletes a row or changes one (archive.test.ts), except that deleting an account
// unlinks its rows, through ON DELETE SET NULL.

export interface NewAcknowledgment {
  // The name it was given by, or '' for feedback that came without one.
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

// The clock is the system's, in milliseconds since 1970, for the day it was given.
export class AcknowledgmentStore {
  readonly #insert: StatementSync;
  readonly #all: StatementSync;
  readonly #counts: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.#insert = db.prepare(
      'INSERT INTO acknowledgments (name, kind, credited_at, feedback_id, account_id) VALUES (?, ?, ?, ?, ?)',
    );
    this.#all = db.prepare(
      'SELECT a.id, a.name, a.kind, a.credited_at AS creditedAt, a.feedback_id AS feedbackId, ' +
        'a.account_id AS accountId, c.username FROM acknowledgments a LEFT JOIN accounts c ON c.id = a.account_id ' +
        'ORDER BY a.id',
    );
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

  // Every entry, for the operator, the oldest first.
  all(): AcknowledgmentEntry[] {
    return this.#all.all() as unknown as AcknowledgmentEntry[];
  }

  // How often the account is thanked for each kind, in the order of the kinds.
  counts(accountId: number): AcknowledgmentCount[] {
    const rows = this.#counts.all(accountId) as unknown as AcknowledgmentCount[];
    return ACKNOWLEDGMENT_KINDS.flatMap((kind) => rows.filter((row) => row.kind === kind));
  }
}

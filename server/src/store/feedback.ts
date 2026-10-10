import { usernameKey, type FeedbackKind, type FeedbackPage, type Language } from '@reviewer2/shared';
import type { DatabaseSync, SQLOutputValue, StatementSync } from 'node:sqlite';
import { databaseBytes, MAX_DATABASE_BYTES } from './database';

// Feedback from players, kept for the author to read on the status page (docs/architecture.md).
// What is kept is what the player wrote and what came along by itself, and nothing that says who
// they are: no address, nickname, token or room code. The contact, which the player may leave so
// that the author can reply, is cleared after 90 days. The feedback itself is the project's
// archive of suggestions and stays for good: nothing here deletes it or changes what the player
// sent (archive.test.ts). A player who wants to be thanked for feedback that is adopted leaves a
// name for it, perhaps with a link, and then, if they were logged in, the feedback remembers their
// account (docs/architecture.md#acknowledgments).

const DAY_MS = 24 * 60 * 60_000;

export interface FeedbackLimits {
  // Past any of these, no more feedback is taken, so that it can't fill the disk: as many as
  // `maxEntries`, more than `maxBytes` of feedback, counting what each piece holds, and a whole
  // database larger than `maxDatabaseBytes`, which accounts share with it.
  maxEntries: number;
  maxBytes: number;
  maxDatabaseBytes: number;
  // How long a contact is kept.
  contactMs: number;
}

export const DEFAULT_FEEDBACK_LIMITS: FeedbackLimits = {
  maxEntries: 10_000,
  maxBytes: 50 * 2 ** 20,
  maxDatabaseBytes: MAX_DATABASE_BYTES,
  contactMs: 90 * DAY_MS,
};

export interface NewFeedback {
  kind: FeedbackKind;
  text: string;
  contact: string | null;
  // The name for the acknowledgments, the link that came with it, and the account that gave it, if
  // the player was logged in.
  credit: string | null;
  link: string | null;
  accountId: number | null;
  // Whether the player agreed to the feedback being published as a GitHub issue, or null when the
  // page didn't ask, as a page from before players were asked doesn't.
  publicIssue: boolean | null;
  // The build of the page that sent it.
  version: string;
  language: Language;
  page: FeedbackPage;
  // The browser's, for a bug only.
  userAgent: string | null;
}

export interface Feedback extends NewFeedback {
  id: number;
  // When the server took it, in ISO 8601 and UTC.
  createdAt: string;
  // The number of the GitHub issue that the operator published it as, if any.
  issue: number | null;
  // The username of the account, while it has one.
  username: string | null;
  // The acknowledgment that adopting it made, if the operator has.
  acknowledgmentId: number | null;
  // The username of another account than the one it came from, when the name for the
  // acknowledgments is that username. The name may be anyone's, but then it may also be someone
  // passing for the account's owner, which the operator is told before adopting it.
  nameTakenBy: string | null;
}

const COLUMNS =
  'f.id, f.created_at AS createdAt, f.kind, f.text, f.contact, f.credit, f.link, f.account_id AS accountId, ' +
  'f.public_issue AS publicIssue, f.issue, f.version, f.language, f.page, f.user_agent AS userAgent, a.username, ' +
  'k.id AS acknowledgmentId';
const FROM =
  'FROM feedback f LEFT JOIN accounts a ON a.id = f.account_id LEFT JOIN acknowledgments k ON k.feedback_id = f.id';

// The clock is the system's, in milliseconds since 1970, because a contact is kept for 90 days
// of the calendar, across restarts. Tests give it one of their own.
export class FeedbackStore {
  readonly #insert: StatementSync;
  readonly #count: StatementSync;
  readonly #size: StatementSync;
  readonly #latest: StatementSync;
  readonly #byId: StatementSync;
  readonly #account: StatementSync;
  readonly #clear: StatementSync;
  readonly #setIssue: StatementSync;

  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
    readonly limits: FeedbackLimits = DEFAULT_FEEDBACK_LIMITS,
  ) {
    this.#insert = db.prepare(
      'INSERT INTO feedback (created_at, kind, text, contact, credit, link, account_id, public_issue, version, ' +
        'language, page, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    this.#count = db.prepare('SELECT count(*) AS count FROM feedback');
    // What the feedback holds, in bytes of UTF-8, which is what it takes in the file, give or take
    // the pages around it.
    this.#size = db.prepare(
      'SELECT coalesce(sum(length(CAST(text AS BLOB)) + coalesce(length(CAST(contact AS BLOB)), 0) + ' +
        'coalesce(length(CAST(credit AS BLOB)), 0) + coalesce(length(CAST(link AS BLOB)), 0) + ' +
        'coalesce(length(CAST(user_agent AS BLOB)), 0) + length(version)), 0) AS bytes FROM feedback',
    );
    this.#latest = db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE f.id < ? ORDER BY f.id DESC LIMIT ?`);
    this.#byId = db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE f.id = ?`);
    this.#account = db.prepare('SELECT id, username FROM accounts WHERE username_key = ?');
    this.#clear = db.prepare('UPDATE feedback SET contact = NULL WHERE contact IS NOT NULL AND created_at < ?');
    this.#setIssue = db.prepare('UPDATE feedback SET issue = ? WHERE id = ?');
  }

  // Why no more feedback can be taken, or null while it can.
  full(): 'entries' | 'size' | 'database' | null {
    if (this.count() >= this.limits.maxEntries) return 'entries';
    const { bytes } = this.#size.get() as { bytes: number };
    if (bytes > this.limits.maxBytes) return 'size';
    return databaseBytes(this.db) > this.limits.maxDatabaseBytes ? 'database' : null;
  }

  // Keeps the feedback and returns its id.
  add(feedback: NewFeedback): number {
    const { kind, text, contact, credit, link, accountId, publicIssue, version, language, page, userAgent } = feedback;
    const createdAt = new Date(this.now()).toISOString();
    const { lastInsertRowid } = this.#insert.run(
      createdAt,
      kind,
      text,
      contact,
      credit,
      link,
      accountId,
      publicIssue === null ? null : publicIssue ? 1 : 0,
      version,
      language,
      page,
      userAgent,
    );
    return Number(lastInsertRowid);
  }

  count(): number {
    return (this.#count.get() as { count: number }).count;
  }

  // The latest feedback first, up to `limit` of it, from before the id `before` when it is given.
  latest(limit: number, before = Number.MAX_SAFE_INTEGER): Feedback[] {
    return this.#latest.all(before, limit).map((row) => this.#fromRow(row));
  }

  byId(id: number): Feedback | undefined {
    const row = this.#byId.get(id);
    return row && this.#fromRow(row);
  }

  // A row as Feedback, with Feedback.nameTakenBy, which is looked up here and not in the query
  // because only usernameKey() (shared/src/accounts.ts) says which username a name is.
  #fromRow(row: Record<string, SQLOutputValue>): Feedback {
    const publicIssue = row.publicIssue === null ? null : row.publicIssue === 1;
    const feedback = { ...row, publicIssue } as unknown as Omit<Feedback, 'nameTakenBy'>;
    const owner =
      feedback.credit === null
        ? undefined
        : (this.#account.get(usernameKey(feedback.credit)) as { id: number; username: string } | undefined);
    return { ...feedback, nameTakenBy: owner && owner.id !== feedback.accountId ? owner.username : null };
  }

  // Records the GitHub issue that the feedback was published as. Says whether there is such feedback.
  setIssue(id: number, issue: number): boolean {
    return Number(this.#setIssue.run(issue, id).changes) > 0;
  }

  // Clears the contacts that have been kept for 90 days, and says how many it cleared.
  clearContacts(): number {
    const cutoff = new Date(this.now() - this.limits.contactMs).toISOString();
    return Number(this.#clear.run(cutoff).changes);
  }
}

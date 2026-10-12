import { usernameKey, type FeedbackKind, type FeedbackPage, type Language } from '@reviewer2/shared';
import type { DatabaseSync, SQLOutputValue, StatementSync } from 'node:sqlite';
import { databaseBytes, MAX_DATABASE_BYTES } from './database';

// Feedback from players, kept for the author to read on the status page (docs/architecture.md).
// What is kept is what the player wrote and what came along by itself, and nothing that says who
// they are: no address, nickname, token or room code. The contact, which the player may leave so
// that the author can reply, is cleared after 90 days. The feedback itself is the project's
// archive of suggestions: nothing here changes what the player sent, and the one way a row goes
// is the purge of what the operator put in the trash 30 days before (archive.test.ts). Beside the
// text, the operator keeps notes of what became of it (admin.ts): the GitHub issue it was
// published as, the pull request that resolved it, whether it was closed, and whether it is in
// the trash. A player who wants to be thanked for feedback that is adopted leaves a name for it,
// perhaps with a link, and then, if they were logged in, the feedback remembers their account
// (docs/architecture.md#acknowledgments).
//
// Reports of players are kept here too, in a table of their own (migration 6), and are an archive
// as the feedback was: no row is deleted or changed. Unlike feedback, a report says who sent it,
// about whom, and in which room, since that is what it is for.

const DAY_MS = 24 * 60 * 60_000;

export interface FeedbackLimits {
  // Past any of these, no more feedback is taken, so that it can't fill the disk: as many as
  // `maxEntries`, more than `maxBytes` of feedback, counting what each piece holds, and a whole
  // database larger than `maxDatabaseBytes`, which accounts share with it. Feedback in the trash
  // counts until it is purged.
  maxEntries: number;
  maxBytes: number;
  maxDatabaseBytes: number;
  // How long a contact is kept.
  contactMs: number;
  // How long feedback stays in the trash before it is purged.
  trashMs: number;
}

export const DEFAULT_FEEDBACK_LIMITS: FeedbackLimits = {
  maxEntries: 10_000,
  maxBytes: 50 * 2 ** 20,
  maxDatabaseBytes: MAX_DATABASE_BYTES,
  contactMs: 90 * DAY_MS,
  trashMs: 30 * DAY_MS,
};

// The limits for as many pieces of feedback as `maxEntries`, which MAX_FEEDBACK sets (config.ts):
// the room for them grows with them, 5 KB a piece on average, so that a server that is full can be
// given more room with one setting. Nothing is deleted to make room.
export const feedbackLimits = (maxEntries: number): FeedbackLimits => ({
  ...DEFAULT_FEEDBACK_LIMITS,
  maxEntries,
  maxBytes: Math.round((DEFAULT_FEEDBACK_LIMITS.maxBytes / DEFAULT_FEEDBACK_LIMITS.maxEntries) * maxEntries),
});

// What became of a piece of feedback, from the operator's notes, the first of these that holds:
// in the trash; closed without being adopted; thanked, by the acknowledgment that adopting it
// made; resolved, by a pull request; published as a GitHub issue; or new. The page shows the
// status, and the whole trail beside it.
export const FEEDBACK_STATUSES = ['new', 'issue', 'resolved', 'thanked', 'closed', 'trash'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

// What is read: the feedback of one status, the open feedback, which is neither closed nor in the
// trash, or all of it.
export type FeedbackView = 'all' | 'open' | FeedbackStatus;

// How many days feedback that went to the trash at `deletedAt` has left before it is purged,
// rounded up, so that the last day says 1, and 0 once the next purge takes it.
export const daysLeft = (deletedAt: string, now: number, trashMs = DEFAULT_FEEDBACK_LIMITS.trashMs): number =>
  Math.max(0, Math.ceil((Date.parse(deletedAt) + trashMs - now) / DAY_MS));

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
  // The number of the pull request that resolved it, if the operator has recorded one, and when
  // they did.
  resolvedPr: number | null;
  resolvedAt: string | null;
  // When the operator closed it without adopting it, or null while it is open.
  closedAt: string | null;
  // When the operator put it in the trash, or null while it isn't there.
  deletedAt: string | null;
  status: FeedbackStatus;
  // The username of the account, while it has one.
  username: string | null;
  // The acknowledgment that adopting it made, if the operator has.
  acknowledgmentId: number | null;
  // The username of another account than the one it came from, when the name for the
  // acknowledgments is that username. The name may be anyone's, but then it may also be someone
  // passing for the account's owner, which the operator is told before adopting it.
  nameTakenBy: string | null;
}

export interface NewReport {
  reporterId: number;
  // The account of the player reported, if they had one, and the name they had in the room.
  reportedId: number | null;
  reportedName: string;
  roomCode: string;
  text: string | null;
}

export interface Report extends Omit<NewReport, 'reporterId'> {
  id: number;
  createdAt: string;
  // The accounts' usernames, while they have them, and whether the operator has barred the account
  // reported from public rooms.
  reporter: string | null;
  reported: string | null;
  reportedBarred: boolean;
}

// The status, as a column, in the order of FEEDBACK_STATUSES from the last to the first.
const STATUS =
  "CASE WHEN f.deleted_at IS NOT NULL THEN 'trash' WHEN f.closed_at IS NOT NULL THEN 'closed' " +
  "WHEN k.id IS NOT NULL THEN 'thanked' WHEN f.resolved_pr IS NOT NULL THEN 'resolved' " +
  "WHEN f.issue IS NOT NULL THEN 'issue' ELSE 'new' END AS status";
const COLUMNS =
  'f.id, f.created_at AS createdAt, f.kind, f.text, f.contact, f.credit, f.link, f.account_id AS accountId, ' +
  'f.public_issue AS publicIssue, f.issue, f.resolved_pr AS resolvedPr, f.resolved_at AS resolvedAt, ' +
  'f.closed_at AS closedAt, f.deleted_at AS deletedAt, f.version, f.language, f.page, f.user_agent AS userAgent, ' +
  `a.username, k.id AS acknowledgmentId, ${STATUS}`;
const FROM =
  'FROM feedback f LEFT JOIN accounts a ON a.id = f.account_id LEFT JOIN acknowledgments k ON k.feedback_id = f.id';
// The rows of a view, by their status: the one given, or any, and with the second parameter 1
// only the open ones. SQLite reads `status` as the column above.
const VIEW = "status = coalesce(?, status) AND (? = 0 OR status IN ('new', 'issue', 'resolved', 'thanked'))";
// The kind and the status of every row, for counting.
const KINDS_AND_STATUSES = `(SELECT f.kind, ${STATUS} ${FROM})`;

// The parameters of VIEW.
const viewParams = (view: FeedbackView): [string | null, number] =>
  view === 'all' ? [null, 0] : view === 'open' ? [null, 1] : [view, 0];

// The clock is the system's, in milliseconds since 1970, because a contact is kept for 90 days
// of the calendar, across restarts, and the trash for 30. Tests give it one of their own.
export class FeedbackStore {
  readonly #insert: StatementSync;
  readonly #count: StatementSync;
  readonly #size: StatementSync;
  readonly #latest: StatementSync;
  readonly #kinds: StatementSync;
  readonly #statuses: StatementSync;
  readonly #byId: StatementSync;
  readonly #account: StatementSync;
  readonly #clear: StatementSync;
  readonly #setIssue: StatementSync;
  readonly #resolve: StatementSync;
  readonly #close: StatementSync;
  readonly #reopen: StatementSync;
  readonly #delete: StatementSync;
  readonly #restore: StatementSync;
  readonly #purge: StatementSync;
  readonly #report: StatementSync;
  readonly #reports: StatementSync;
  readonly #reportCount: StatementSync;

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
    this.#latest = db.prepare(
      `SELECT ${COLUMNS} ${FROM} WHERE f.id < ? AND f.kind = coalesce(?, f.kind) AND ${VIEW} ORDER BY f.id DESC LIMIT ?`,
    );
    this.#kinds = db.prepare(`SELECT kind, count(*) AS count FROM ${KINDS_AND_STATUSES} WHERE ${VIEW} GROUP BY kind`);
    this.#statuses = db.prepare(
      `SELECT status, count(*) AS count FROM ${KINDS_AND_STATUSES} WHERE kind = coalesce(?, kind) GROUP BY status`,
    );
    this.#byId = db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE f.id = ?`);
    this.#account = db.prepare('SELECT id, username FROM accounts WHERE username_key = ?');
    this.#clear = db.prepare('UPDATE feedback SET contact = NULL WHERE contact IS NOT NULL AND created_at < ?');
    // The operator's notes. Each statement carries its rule, so that it can't be broken by
    // mistake: a row is closed once and reopened once, never in the trash; it goes to the trash
    // once, unless an acknowledgment points at it, and comes back once.
    this.#setIssue = db.prepare('UPDATE feedback SET issue = ? WHERE id = ?');
    this.#resolve = db.prepare('UPDATE feedback SET resolved_pr = ?, resolved_at = ? WHERE id = ?');
    this.#close = db.prepare(
      'UPDATE feedback SET closed_at = ? WHERE id = ? AND closed_at IS NULL AND deleted_at IS NULL',
    );
    this.#reopen = db.prepare(
      'UPDATE feedback SET closed_at = NULL WHERE id = ? AND closed_at IS NOT NULL AND deleted_at IS NULL',
    );
    this.#delete = db.prepare(
      'UPDATE feedback SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL AND ' +
        'NOT EXISTS (SELECT 1 FROM acknowledgments WHERE feedback_id = feedback.id)',
    );
    this.#restore = db.prepare('UPDATE feedback SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL');
    this.#purge = db.prepare('DELETE FROM feedback WHERE deleted_at IS NOT NULL AND deleted_at < ?');
    this.#report = db.prepare(
      'INSERT INTO reports (created_at, reporter_id, reported_id, reported_name, room_code, text) ' +
        'VALUES (?, ?, ?, ?, ?, ?)',
    );
    this.#reports = db.prepare(
      'SELECT r.id, r.created_at AS createdAt, r.reported_id AS reportedId, r.reported_name AS reportedName, ' +
        'r.room_code AS roomCode, r.text, a.username AS reporter, b.username AS reported, ' +
        'coalesce(b.public_barred, 0) AS reportedBarred FROM reports r LEFT JOIN accounts a ON a.id = r.reporter_id ' +
        'LEFT JOIN accounts b ON b.id = r.reported_id WHERE r.id < ? ORDER BY r.id DESC LIMIT ?',
    );
    this.#reportCount = db.prepare('SELECT count(*) AS count FROM reports');
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

  // How much feedback there is in all, the trash included.
  count(): number {
    return (this.#count.get() as { count: number }).count;
  }

  // The latest feedback first, up to `limit` of it, from before the id `before` when it is given,
  // of one kind when `kind` is, and of one view when `view` is.
  latest(
    limit: number,
    before = Number.MAX_SAFE_INTEGER,
    kind: FeedbackKind | null = null,
    view: FeedbackView = 'all',
  ): Feedback[] {
    return this.#latest.all(before, kind, ...viewParams(view), limit).map((row) => this.#fromRow(row));
  }

  // How much feedback of a view there is of each kind that has any. The table takes any kind and
  // the server only those it knows (shared/src/feedback.ts), so a server that was rolled back from
  // a later one may find others, which are counted too.
  kinds(view: FeedbackView = 'all'): Record<string, number> {
    const rows = this.#kinds.all(...viewParams(view)) as { kind: string; count: number }[];
    return Object.fromEntries(rows.map(({ kind, count }) => [kind, count]));
  }

  // How much feedback there is of each status, of one kind or of every kind, with 0 for a status
  // that has none.
  statuses(kind: FeedbackKind | null = null): Record<FeedbackStatus, number> {
    const counts = Object.fromEntries(FEEDBACK_STATUSES.map((status) => [status, 0])) as Record<FeedbackStatus, number>;
    for (const { status, count } of this.#statuses.all(kind) as { status: FeedbackStatus; count: number }[]) {
      counts[status] = count;
    }
    return counts;
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

  // Records the GitHub issue that the feedback was published as, or with null that it wasn't.
  // Says whether there is such feedback. Only feedback whose player agreed may be published,
  // which admin.ts sees to.
  setIssue(id: number, issue: number | null): boolean {
    return Number(this.#setIssue.run(issue, id).changes) > 0;
  }

  // Records the pull request that resolved the feedback, or with null that none has. Says whether
  // there is such feedback.
  resolve(id: number, pr: number | null): boolean {
    const at = pr === null ? null : new Date(this.now()).toISOString();
    return Number(this.#resolve.run(pr, at, id).changes) > 0;
  }

  // Closes the feedback, as not adopted, and says whether it did: not when it is closed already,
  // in the trash, or not there.
  close(id: number): boolean {
    return Number(this.#close.run(new Date(this.now()).toISOString(), id).changes) > 0;
  }

  // Reopens closed feedback, and says whether it did: not when it is open, in the trash, or not
  // there.
  reopen(id: number): boolean {
    return Number(this.#reopen.run(id).changes) > 0;
  }

  // Puts the feedback in the trash, from which purge() deletes it after 30 days, and says whether
  // it did: not when it is there already, not there at all, or was adopted, since the
  // acknowledgment points at it.
  delete(id: number): boolean {
    return Number(this.#delete.run(new Date(this.now()).toISOString(), id).changes) > 0;
  }

  // Takes the feedback out of the trash, as it was, closed if it was closed, and says whether it
  // did: not when it isn't there.
  restore(id: number): boolean {
    return Number(this.#restore.run(id).changes) > 0;
  }

  // Deletes the feedback that has been in the trash for 30 days, for good, and says how much it
  // deleted. The one way a row ever goes.
  purge(): number {
    const cutoff = new Date(this.now() - this.limits.trashMs).toISOString();
    return Number(this.#purge.run(cutoff).changes);
  }

  // How many days the feedback has left in the trash, or null when it isn't there.
  daysLeft({ deletedAt }: Pick<Feedback, 'deletedAt'>): number | null {
    return deletedAt === null ? null : daysLeft(deletedAt, this.now(), this.limits.trashMs);
  }

  // Keeps a report and returns its id, or null when the database is too large to take it. Reports
  // are few and small, so only the whole database's size stops them, not the limits of feedback.
  report(report: NewReport): number | null {
    if (databaseBytes(this.db) > this.limits.maxDatabaseBytes) return null;
    const { reporterId, reportedId, reportedName, roomCode, text } = report;
    const createdAt = new Date(this.now()).toISOString();
    return Number(this.#report.run(createdAt, reporterId, reportedId, reportedName, roomCode, text).lastInsertRowid);
  }

  // The latest reports first, as latest() gives feedback.
  reports(limit: number, before = Number.MAX_SAFE_INTEGER): Report[] {
    const rows = this.#reports.all(before, limit) as unknown as (Omit<Report, 'reportedBarred'> & {
      reportedBarred: number;
    })[];
    return rows.map((row) => ({ ...row, reportedBarred: row.reportedBarred === 1 }));
  }

  reportCount(): number {
    return (this.#reportCount.get() as { count: number }).count;
  }

  // Clears the contacts that have been kept for 90 days, and says how many it cleared.
  clearContacts(): number {
    const cutoff = new Date(this.now() - this.limits.contactMs).toISOString();
    return Number(this.#clear.run(cutoff).changes);
  }
}

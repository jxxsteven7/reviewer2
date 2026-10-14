import {
  type Contribution,
  type ContributionCount,
  type ContributionSummary,
  FEEDBACK_KINDS,
  type FeedbackKind,
  type FeedbackPage,
  type Language,
  usernameKey,
} from '@reviewer2/shared';
import type { DatabaseSync, SQLOutputValue, StatementSync } from 'node:sqlite';
import { databaseBytes, MAX_DATABASE_BYTES } from './database';

// Feedback from players, kept for the author to read on the status page (docs/architecture.md).
// What is kept is what the player wrote and what came along by itself, and nothing that says who
// they are: no address, nickname, token or room code. The contact, which the player may leave so
// that the author can reply, is cleared after 90 days. The feedback itself is the project's
// archive of suggestions: nothing here changes what the player sent, and the one way a row goes
// is the purge of what the operator put in the trash 30 days before (archive.test.ts). Beside the
// text, the operator keeps notes of what became of it (admin.ts): the GitHub issue it was
// published as, the pull request that resolved it, when it was adopted and what the player
// contributed, whether it was closed, and whether it is in the trash. Feedback that was adopted is
// a feedback contribution, which the home page lists by the name the player left with it, or as
// anonymous, and which counts for the account they were logged in to, if they were
// (docs/architecture.md#feedback-contributions).
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
// in the trash; closed without being adopted; thanked, by being adopted, which lists it among the
// feedback contributions; resolved, by a pull request; published as a GitHub issue; or new. The
// page shows the status, and the whole trail beside it. As views, they go by the facts, and may
// overlap: the resolved feedback is all that a pull request resolved, thanked or not, unless it is
// closed or in the trash, and the thanked is all that was thanked, resolved or not, likewise; the
// others are the feedback of that status.
export const FEEDBACK_STATUSES = ['new', 'issue', 'resolved', 'thanked', 'closed', 'trash'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

// What is read: the feedback of one view above, the open feedback, which still waits for the
// operator, new or published as an issue, or all of it.
export type FeedbackView = 'all' | 'open' | FeedbackStatus;

// How many days feedback that went to the trash at `deletedAt` has left before it is purged,
// rounded up, so that the last day says 1, and 0 once the next purge takes it.
export const daysLeft = (deletedAt: string, now: number, trashMs = DEFAULT_FEEDBACK_LIMITS.trashMs): number =>
  Math.max(0, Math.ceil((Date.parse(deletedAt) + trashMs - now) / DAY_MS));

export interface NewFeedback {
  kind: FeedbackKind;
  text: string;
  contact: string | null;
  // The name for the feedback contributions, if the player left one, and the account they were
  // logged in to, if they were, whether they left a name or not; and whether they let the name
  // link to that account's public profile, which only a name and an account can.
  credit: string | null;
  accountId: number | null;
  linkProfile: boolean;
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
  // When the operator adopted it, or null while they haven't, and what the player contributed, in
  // Chinese and in English, as the operator wrote it then or since.
  adoptedAt: string | null;
  summaryZh: string | null;
  summaryEn: string | null;
  // The username of the account, while it has one.
  username: string | null;
  // The username of another account than the one it came from, when the name for the
  // feedback contributions is that username. The name may be anyone's, but then it may also be someone
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
  "WHEN f.adopted_at IS NOT NULL THEN 'thanked' WHEN f.resolved_pr IS NOT NULL THEN 'resolved' " +
  "WHEN f.issue IS NOT NULL THEN 'issue' ELSE 'new' END AS status";
const COLUMNS =
  'f.id, f.created_at AS createdAt, f.kind, f.text, f.contact, f.credit, f.account_id AS accountId, ' +
  'f.link_profile AS linkProfile, f.issue, ' +
  'f.resolved_pr AS resolvedPr, f.resolved_at AS resolvedAt, f.adopted_at AS adoptedAt, f.summary_zh AS summaryZh, ' +
  'f.summary_en AS summaryEn, f.closed_at AS closedAt, f.deleted_at AS deletedAt, f.version, f.language, f.page, ' +
  `f.user_agent AS userAgent, a.username, ${STATUS}`;
const FROM = 'FROM feedback f LEFT JOIN accounts a ON a.id = f.account_id';
// Every row as Feedback, and the kind and the status of every row, for counting. Both are read as
// subqueries, so that `status` in a WHERE clause names the column above and nothing that a table
// joined in may come to have.
const ROWS = `(SELECT ${COLUMNS} ${FROM})`;
const KINDS_AND_STATUSES = `(SELECT f.kind, f.resolved_pr AS resolvedPr, ${STATUS} ${FROM})`;
// Whether a row is resolved, as the view goes: a pull request resolved it, and it is neither
// closed nor in the trash, whether it was thanked too or not.
const RESOLVED = "resolvedPr IS NOT NULL AND status IN ('resolved', 'thanked')";
// The rows of a view, given twice: every row, the open ones, the resolved ones, or those of the
// status that the view names.
const VIEW =
  "CASE ? WHEN 'all' THEN 1 WHEN 'open' THEN status IN ('new', 'issue') " +
  `WHEN 'resolved' THEN ${RESOLVED} ELSE status = ? END`;

// The parameters of VIEW.
const viewParams = (view: FeedbackView): [string, string] => [view, view];

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
  readonly #adopt: StatementSync;
  readonly #describe: StatementSync;
  readonly #contributions: StatementSync;
  readonly #counts: StatementSync;
  readonly #report: StatementSync;
  readonly #reports: StatementSync;
  readonly #reportCount: StatementSync;

  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
    readonly limits: FeedbackLimits = DEFAULT_FEEDBACK_LIMITS,
  ) {
    this.#insert = db.prepare(
      'INSERT INTO feedback (created_at, kind, text, contact, credit, account_id, link_profile, version, ' +
        'language, page, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    this.#count = db.prepare('SELECT count(*) AS count FROM feedback');
    // What the feedback holds, in bytes of UTF-8, which is what it takes in the file, give or take
    // the pages around it.
    this.#size = db.prepare(
      'SELECT coalesce(sum(length(CAST(text AS BLOB)) + coalesce(length(CAST(contact AS BLOB)), 0) + ' +
        'coalesce(length(CAST(credit AS BLOB)), 0) + coalesce(length(CAST(user_agent AS BLOB)), 0) + ' +
        'length(version)), 0) AS bytes FROM feedback',
    );
    this.#latest = db.prepare(
      `SELECT * FROM ${ROWS} WHERE id < ? AND kind = coalesce(?, kind) AND ${VIEW} ORDER BY id DESC LIMIT ?`,
    );
    this.#kinds = db.prepare(`SELECT kind, count(*) AS count FROM ${KINDS_AND_STATUSES} WHERE ${VIEW} GROUP BY kind`);
    this.#statuses = db.prepare(
      "SELECT coalesce(sum(status = 'new'), 0) AS new, coalesce(sum(status = 'issue'), 0) AS issue, " +
        `coalesce(sum(${RESOLVED}), 0) AS resolved, coalesce(sum(status = 'thanked'), 0) AS thanked, ` +
        "coalesce(sum(status = 'closed'), 0) AS closed, coalesce(sum(status = 'trash'), 0) AS trash " +
        `FROM ${KINDS_AND_STATUSES} WHERE kind = coalesce(?, kind)`,
    );
    this.#byId = db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE f.id = ?`);
    this.#account = db.prepare('SELECT id, username FROM accounts WHERE username_key = ?');
    this.#clear = db.prepare('UPDATE feedback SET contact = NULL WHERE contact IS NOT NULL AND created_at < ?');
    // The operator's notes. Each statement carries its rule, so that it can't be broken by
    // mistake: a row is closed once, unless it was adopted, and reopened once, never in the trash;
    // it is adopted once, as an issue, neither closed nor in the trash, and only what the player
    // contributed is written again afterwards; it goes to the trash once, unless it was adopted or
    // is an issue, and comes back once; and the purge leaves a row that was adopted or is an issue
    // alone, in case the feedback was adopted or recorded as an issue on its way out, which
    // admin.ts refuses, but it reads before it writes, or was in the trash as an issue before
    // issues kept feedback out of it.
    this.#setIssue = db.prepare('UPDATE feedback SET issue = ? WHERE id = ?');
    this.#resolve = db.prepare('UPDATE feedback SET resolved_pr = ?, resolved_at = ? WHERE id = ?');
    this.#close = db.prepare(
      'UPDATE feedback SET closed_at = ? WHERE id = ? AND closed_at IS NULL AND deleted_at IS NULL AND adopted_at IS NULL',
    );
    this.#reopen = db.prepare(
      'UPDATE feedback SET closed_at = NULL WHERE id = ? AND closed_at IS NOT NULL AND deleted_at IS NULL',
    );
    this.#delete = db.prepare(
      'UPDATE feedback SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL AND adopted_at IS NULL AND issue IS NULL',
    );
    this.#restore = db.prepare('UPDATE feedback SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL');
    this.#purge = db.prepare(
      'DELETE FROM feedback WHERE deleted_at IS NOT NULL AND deleted_at < ? AND adopted_at IS NULL AND issue IS NULL',
    );
    this.#adopt = db.prepare(
      'UPDATE feedback SET adopted_at = ?, summary_zh = ?, summary_en = ? ' +
        'WHERE id = ? AND adopted_at IS NULL AND deleted_at IS NULL AND closed_at IS NULL AND issue IS NOT NULL',
    );
    this.#describe = db.prepare(
      'UPDATE feedback SET summary_zh = ?, summary_en = ? WHERE id = ? AND adopted_at IS NOT NULL',
    );
    // The contributions as anyone sees them. The handle of the profile goes with a name left from
    // an account by a player who let it link there, and with nothing else.
    this.#contributions = db.prepare(
      'SELECT f.kind, f.credit AS name, ' +
        'CASE WHEN f.credit IS NOT NULL AND f.link_profile = 1 THEN a.handle END AS profile, ' +
        'f.summary_zh AS summaryZh, f.summary_en AS summaryEn, f.issue, substr(f.adopted_at, 1, 7) AS month ' +
        'FROM feedback f LEFT JOIN accounts a ON a.id = f.account_id ' +
        'WHERE f.adopted_at IS NOT NULL ORDER BY f.adopted_at DESC, f.id DESC',
    );
    this.#counts = db.prepare(
      'SELECT kind, count(*) AS count FROM feedback WHERE account_id = ? AND adopted_at IS NOT NULL GROUP BY kind',
    );
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
    const { kind, text, contact, credit, accountId, linkProfile, version, language, page, userAgent } = feedback;
    const createdAt = new Date(this.now()).toISOString();
    const { lastInsertRowid } = this.#insert.run(
      createdAt,
      kind,
      text,
      contact,
      credit,
      accountId,
      linkProfile ? 1 : 0,
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

  // How much feedback there is in each view of a status (FEEDBACK_STATUSES), of one kind or of
  // every kind, with 0 for one that has none. Feedback that was resolved and thanked counts in both.
  statuses(kind: FeedbackKind | null = null): Record<FeedbackStatus, number> {
    const row = this.#statuses.get(kind) as Record<FeedbackStatus, number>;
    return Object.fromEntries(FEEDBACK_STATUSES.map((status) => [status, row[status]])) as Record<
      FeedbackStatus,
      number
    >;
  }

  byId(id: number): Feedback | undefined {
    const row = this.#byId.get(id);
    return row && this.#fromRow(row);
  }

  // A row as Feedback, with Feedback.nameTakenBy, which is looked up here and not in the query
  // because only usernameKey() (shared/src/accounts.ts) says which username a name is.
  #fromRow(row: Record<string, SQLOutputValue>): Feedback {
    const feedback = { ...row, linkProfile: row.linkProfile === 1 } as unknown as Omit<Feedback, 'nameTakenBy'>;
    const owner =
      feedback.credit === null
        ? undefined
        : (this.#account.get(usernameKey(feedback.credit)) as { id: number; username: string } | undefined);
    return { ...feedback, nameTakenBy: owner && owner.id !== feedback.accountId ? owner.username : null };
  }

  // Records the GitHub issue that the feedback was published as, or with null that it wasn't.
  // Says whether there is such feedback. Adopted feedback keeps an issue, which admin.ts sees to.
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
  // was adopted, is in the trash, or isn't there.
  close(id: number): boolean {
    return Number(this.#close.run(new Date(this.now()).toISOString(), id).changes) > 0;
  }

  // Reopens closed feedback, and says whether it did: not when it is open, in the trash, or not
  // there.
  reopen(id: number): boolean {
    return Number(this.#reopen.run(id).changes) > 0;
  }

  // Adopts the feedback, which lists it among the feedback contributions, with what the player
  // contributed, and says whether it did: not when it was adopted already, is closed, is in the
  // trash, is no GitHub issue, or isn't there.
  adopt(id: number, { zh, en }: ContributionSummary): boolean {
    return Number(this.#adopt.run(new Date(this.now()).toISOString(), zh, en, id).changes) > 0;
  }

  // Writes again what the player contributed, and says whether it did: not when the feedback wasn't
  // adopted or isn't there. Nothing else of a contribution ever changes.
  describe(id: number, { zh, en }: ContributionSummary): boolean {
    return Number(this.#describe.run(zh, en, id).changes) > 0;
  }

  // The feedback contributions, the latest adopted first, of the kinds the server knows.
  contributions(): Contribution[] {
    const rows = this.#contributions.all() as unknown as (Omit<Contribution, 'summary'> & {
      summaryZh: string | null;
      summaryEn: string | null;
    })[];
    return rows.flatMap(({ kind, name, profile, summaryZh, summaryEn, issue, month }) =>
      (FEEDBACK_KINDS as readonly string[]).includes(kind)
        ? [
            {
              kind,
              name,
              profile,
              summary: summaryZh && summaryEn ? { zh: summaryZh, en: summaryEn } : null,
              issue,
              month,
            },
          ]
        : [],
    );
  }

  // How many contributions of each kind count for the account, those without a name included, in
  // the order of the kinds.
  counts(accountId: number): ContributionCount[] {
    const rows = this.#counts.all(accountId) as unknown as ContributionCount[];
    return FEEDBACK_KINDS.flatMap((kind) => rows.filter((row) => row.kind === kind));
  }

  // Puts the feedback in the trash, from which purge() deletes it after 30 days, and says whether
  // it did: not when it is there already, not there at all, was adopted, since the home page lists
  // it, or is a GitHub issue, which is public and is closed instead.
  delete(id: number): boolean {
    return Number(this.#delete.run(new Date(this.now()).toISOString(), id).changes) > 0;
  }

  // Takes the feedback out of the trash, as it was, closed if it was closed, and says whether it
  // did: not when it isn't there.
  restore(id: number): boolean {
    return Number(this.#restore.run(id).changes) > 0;
  }

  // Deletes the feedback that has been in the trash for 30 days, for good, unless it was adopted
  // or is a GitHub issue, and says how much it deleted. The one way a row ever goes.
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

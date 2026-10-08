import type { FeedbackKind, FeedbackPage, Language } from '@reviewer2/shared';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

// Feedback from players, kept for the author to read on the status page (docs/architecture.md).
// What is kept is what the player wrote and what came along by itself, and nothing that says who
// they are: no address, nickname, token or room code. The contact, which the player may leave so
// that the author can reply, is cleared after 90 days; the feedback itself stays.

const DAY_MS = 24 * 60 * 60_000;

export interface FeedbackLimits {
  // Past either of these, no more feedback is taken, so that it can't fill the disk.
  maxEntries: number;
  maxBytes: number;
  // How long a contact is kept.
  contactMs: number;
}

export const DEFAULT_FEEDBACK_LIMITS: FeedbackLimits = {
  maxEntries: 10_000,
  maxBytes: 50 * 2 ** 20,
  contactMs: 90 * DAY_MS,
};

export interface NewFeedback {
  kind: FeedbackKind;
  text: string;
  contact: string | null;
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
}

const COLUMNS = 'id, created_at AS createdAt, kind, text, contact, version, language, page, user_agent AS userAgent';

// The clock is the system's, in milliseconds since 1970, because a contact is kept for 90 days
// of the calendar, across restarts. Tests give it one of their own.
export class FeedbackStore {
  readonly #insert: StatementSync;
  readonly #count: StatementSync;
  readonly #size: StatementSync;
  readonly #latest: StatementSync;
  readonly #clear: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
    readonly limits: FeedbackLimits = DEFAULT_FEEDBACK_LIMITS,
  ) {
    this.#insert = db.prepare(
      'INSERT INTO feedback (created_at, kind, text, contact, version, language, page, user_agent) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    this.#count = db.prepare('SELECT count(*) AS count FROM feedback');
    this.#size = db.prepare('SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()');
    this.#latest = db.prepare(`SELECT ${COLUMNS} FROM feedback WHERE id < ? ORDER BY id DESC LIMIT ?`);
    this.#clear = db.prepare('UPDATE feedback SET contact = NULL WHERE contact IS NOT NULL AND created_at < ?');
  }

  // Why no more feedback can be taken, or null while it can. The size is the whole database's.
  full(): 'entries' | 'size' | null {
    if (this.count() >= this.limits.maxEntries) return 'entries';
    const { bytes } = this.#size.get() as { bytes: number };
    return bytes > this.limits.maxBytes ? 'size' : null;
  }

  // Keeps the feedback and returns its id.
  add(feedback: NewFeedback): number {
    const { kind, text, contact, version, language, page, userAgent } = feedback;
    const createdAt = new Date(this.now()).toISOString();
    const { lastInsertRowid } = this.#insert.run(createdAt, kind, text, contact, version, language, page, userAgent);
    return Number(lastInsertRowid);
  }

  count(): number {
    return (this.#count.get() as { count: number }).count;
  }

  // The latest feedback first, up to `limit` of it, from before the id `before` when it is given.
  latest(limit: number, before = Number.MAX_SAFE_INTEGER): Feedback[] {
    return this.#latest.all(before, limit).map((row) => ({ ...row }) as unknown as Feedback);
  }

  // Clears the contacts that have been kept for 90 days, and says how many it cleared.
  clearContacts(): number {
    const cutoff = new Date(this.now() - this.limits.contactMs).toISOString();
    return Number(this.#clear.run(cutoff).changes);
  }
}

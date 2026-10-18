import {
  AVATAR_PATH,
  CONTRIBUTION_KINDS,
  FEEDBACK_KINDS,
  type Contribution,
  type ContributionKind,
  type ContributionSummary,
} from '@reviewer2/shared';
import type { DatabaseSync, SQLOutputValue, StatementSync } from 'node:sqlite';

// The contributions (docs/architecture.md#feedback-contributions), from the two places they come
// from. The feedback that players sent through the site and the operator adopted stays in the
// feedback table, with the rest of the feedback, which FeedbackStore keeps and adopts. The issues
// that developers opened on GitHub and the operator adopted, and the security advisories published
// once a problem reported privately was fixed, are kept here, in github_contributions (migration
// 25): the issue or the advisory, the kind, the author's GitHub username and account id as they
// were when it was adopted, whether the home page names the author, when it was adopted and what
// they contributed, in both languages. Nothing else of the issue is kept; the issue is its record.
// The home page reads both as one list, from all(), the latest adopted first.
//
// The rows are an archive, as the feedback is (archive.test.ts): no row is ever deleted, and the
// only changes are the operator's: the two sentences are written again, the author is listed
// anonymously at their request, or, at their request too, the username and the id go, which lists
// them anonymously for good, since nothing is left to name them by.

// What names a contribution from GitHub: the number of the issue, or the id of the advisory.
export type GithubRef = { issue: number } | { advisory: string };

// One contribution from GitHub, as the operator reads it. The author is known while `login` and
// `githubId` are there, and named on the home page while `named` is, which it can't be without them.
export interface GithubContribution {
  issue: number | null;
  advisory: string | null;
  kind: ContributionKind;
  login: string | null;
  githubId: number | null;
  named: boolean;
  adoptedAt: string;
  summaryZh: string;
  summaryEn: string;
}

export interface NewGithubContribution {
  ref: GithubRef;
  kind: ContributionKind;
  login: string;
  githubId: number;
  named: boolean;
  summary: ContributionSummary;
}

// Why a contribution couldn't be adopted: it was already, or its issue is a player's feedback,
// which `feedback adopt` adopts.
export type GithubRefusal = 'adopted_already' | 'feedback_issue';

// The columns of a row as GithubContribution.
const COLUMNS =
  'issue, advisory, kind, login, github_id AS githubId, named, adopted_at AS adoptedAt, ' +
  'summary_zh AS summaryZh, summary_en AS summaryEn';
// The parameters of a statement that names a row by its reference, `WHERE issue IS ? AND
// advisory IS ?`: the one of the two that the reference gives, with the other NULL.
const refParams = (ref: GithubRef): [number | null, string | null] =>
  'issue' in ref ? [ref.issue, null] : [null, ref.advisory];

export class ContributionStore {
  readonly #insert: StatementSync;
  readonly #byRef: StatementSync;
  readonly #feedbackIssue: StatementSync;
  readonly #describe: StatementSync;
  readonly #anonymize: StatementSync;
  readonly #forget: StatementSync;
  readonly #list: StatementSync;
  readonly #all: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.#insert = db.prepare(
      'INSERT INTO github_contributions (issue, advisory, kind, login, github_id, named, adopted_at, summary_zh, ' +
        'summary_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    this.#byRef = db.prepare(`SELECT ${COLUMNS} FROM github_contributions WHERE issue IS ? AND advisory IS ?`);
    this.#feedbackIssue = db.prepare('SELECT id FROM feedback WHERE issue = ?');
    // The operator's changes, each with its rule, so that none happens by mistake: the sentences
    // are written again for a row that is there; a row is made anonymous once; the author goes
    // once, with the naming.
    this.#describe = db.prepare(
      'UPDATE github_contributions SET summary_zh = ?, summary_en = ? WHERE issue IS ? AND advisory IS ?',
    );
    this.#anonymize = db.prepare(
      'UPDATE github_contributions SET named = 0 WHERE issue IS ? AND advisory IS ? AND named = 1',
    );
    this.#forget = db.prepare(
      'UPDATE github_contributions SET login = NULL, github_id = NULL, named = 0 ' +
        'WHERE issue IS ? AND advisory IS ? AND login IS NOT NULL',
    );
    this.#list = db.prepare(`SELECT ${COLUMNS} FROM github_contributions ORDER BY adopted_at DESC, rowid DESC`);
    // The contributions as anyone sees them, from both tables, the latest adopted first. Feedback
    // signed with an account is listed by the account as it is now, its username, the handle of
    // its profile and its avatar, and once the account is gone as a deleted player's, by no name;
    // a guest's by the name they left; an issue from GitHub by its author's username while they
    // are named; nothing else has a name, a handle or an avatar. Adopted feedback is a GitHub
    // issue, which FeedbackStore.adopt() and admin.ts see to, so a row without one, which only a
    // hand on the database makes, is left out. Two adopted at the same moment come from the site
    // first, and then the latest row of each.
    this.#all = db.prepare(
      "SELECT 'site' AS source, f.kind, CASE WHEN f.link_profile = 1 THEN a.username ELSE f.credit END AS name, " +
        'CASE WHEN f.link_profile = 1 THEN a.handle END AS profile, ' +
        'CASE WHEN f.link_profile = 1 THEN a.avatar END AS avatar, ' +
        'f.link_profile = 1 AND a.id IS NULL AS deleted, ' +
        'f.summary_zh AS summaryZh, f.summary_en AS summaryEn, f.issue, NULL AS advisory, ' +
        'f.adopted_at AS adoptedAt, f.id AS id ' +
        'FROM feedback f LEFT JOIN accounts a ON a.id = f.account_id ' +
        'WHERE f.adopted_at IS NOT NULL AND f.issue IS NOT NULL ' +
        'UNION ALL ' +
        "SELECT 'github', g.kind, CASE WHEN g.named = 1 THEN g.login END, NULL, NULL, 0, " +
        'g.summary_zh, g.summary_en, g.issue, g.advisory, g.adopted_at, g.rowid FROM github_contributions g ' +
        'ORDER BY adoptedAt DESC, source DESC, id DESC',
    );
  }

  // Adopts an issue or an advisory from GitHub, which lists it on the home page at once, and says
  // why it couldn't: the issue or the advisory was adopted already, or the issue is a player's
  // feedback, which is adopted as feedback.
  adopt({ ref, kind, login, githubId, named, summary }: NewGithubContribution): GithubContribution | GithubRefusal {
    if (this.byRef(ref) !== undefined) return 'adopted_already';
    if ('issue' in ref && this.#feedbackIssue.get(ref.issue) !== undefined) return 'feedback_issue';
    const [issue, advisory] = refParams(ref);
    const adoptedAt = new Date(this.now()).toISOString();
    try {
      this.#insert.run(issue, advisory, kind, login, githubId, named ? 1 : 0, adoptedAt, summary.zh, summary.en);
    } catch (error) {
      // Adopted meanwhile by another command: the issue and the advisory are unique.
      if (error instanceof Error && error.message.includes('UNIQUE')) return 'adopted_already';
      throw error;
    }
    return this.byRef(ref) as GithubContribution;
  }

  byRef(ref: GithubRef): GithubContribution | undefined {
    const row = this.#byRef.get(...refParams(ref));
    return row && fromRow(row);
  }

  // Writes again what the author contributed, and says whether it did: not when there is no such
  // contribution.
  describe(ref: GithubRef, { zh, en }: ContributionSummary): boolean {
    return Number(this.#describe.run(zh, en, ...refParams(ref)).changes) > 0;
  }

  // Lists the author anonymously from now on, at their request, and says whether it did: not when
  // they are listed so already, or there is no such contribution.
  anonymize(ref: GithubRef): boolean {
    return Number(this.#anonymize.run(...refParams(ref)).changes) > 0;
  }

  // Forgets who the author was, at their request: the username and the id go, and the author is
  // listed anonymously. Says whether it did: not when they were forgotten already, or there is no
  // such contribution.
  forget(ref: GithubRef): boolean {
    return Number(this.#forget.run(...refParams(ref)).changes) > 0;
  }

  // Every contribution from GitHub, the latest adopted first.
  list(): GithubContribution[] {
    return this.#list.all().map((row) => fromRow(row));
  }

  // Every contribution, from the site and from GitHub, the latest adopted first, of the kinds the
  // server knows: a kind from a later server, which this one was rolled back from, is left out.
  all(): Contribution[] {
    const rows = this.#all.all() as unknown as (Omit<Contribution, 'summary' | 'deleted' | 'month'> & {
      deleted: number;
      summaryZh: string | null;
      summaryEn: string | null;
      adoptedAt: string;
    })[];
    return rows.flatMap(
      ({ source, kind, name, profile, avatar, deleted, summaryZh, summaryEn, issue, advisory, adoptedAt }) => {
        const known: readonly string[] = source === 'site' ? FEEDBACK_KINDS : CONTRIBUTION_KINDS;
        if (!known.includes(kind)) return [];
        return [
          {
            kind,
            source,
            name,
            profile,
            avatar: avatar === null ? null : `${AVATAR_PATH}${avatar}`,
            deleted: deleted === 1,
            summary: summaryZh && summaryEn ? { zh: summaryZh, en: summaryEn } : null,
            issue,
            advisory,
            month: adoptedAt.slice(0, 7),
          },
        ];
      },
    );
  }
}

const fromRow = (row: Record<string, SQLOutputValue>): GithubContribution =>
  ({ ...row, named: row.named === 1 }) as unknown as GithubContribution;

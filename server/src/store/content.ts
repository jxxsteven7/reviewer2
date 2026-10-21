import type { Content, ContentKind, ContributionSummary } from '@reviewer2/shared';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

// The content that players gave the word library and the operator adopted into it
// (docs/architecture.md#content-contributions, migration 27): a setter's pair of a game of the
// second game, or the chair's own words of a game of the first, with the game they came from, the
// account that gave them, whether it is named, when it was adopted, and what was adopted, in both
// languages. The word library itself is in words/, where an adopted pair or word is added by hand.
//
// The rows are an archive, as the contributions from GitHub are (archive.test.ts): no row is ever
// deleted, and the only change is that the content of an account that is deleted names nobody,
// before the account goes from it by its foreign key.

export interface AdoptedContent {
  id: number;
  kind: ContentKind;
  game: string;
  gameId: string | null;
  content: Content;
  accountId: number | null;
  named: boolean;
  adoptedAt: string;
  summaryZh: string;
  summaryEn: string;
}

export interface NewContent {
  kind: ContentKind;
  game: string;
  gameId: string | null;
  content: Content;
  accountId: number | null;
  named: boolean;
  summary: ContributionSummary;
}

const COLUMNS =
  'id, kind, game, game_id AS gameId, content, account_id AS accountId, named, adopted_at AS adoptedAt, ' +
  'summary_zh AS summaryZh, summary_en AS summaryEn';

export class ContentStore {
  readonly #insert: StatementSync;
  readonly #byId: StatementSync;
  readonly #forget: StatementSync;
  readonly #list: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.#insert = db.prepare(
      'INSERT INTO content_contributions (kind, game, game_id, content, account_id, named, adopted_at, summary_zh, ' +
        'summary_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    this.#byId = db.prepare(`SELECT ${COLUMNS} FROM content_contributions WHERE id = ?`);
    this.#forget = db.prepare('UPDATE content_contributions SET named = 0 WHERE account_id = ? AND named = 1');
    this.#list = db.prepare(`SELECT ${COLUMNS} FROM content_contributions ORDER BY id DESC`);
  }

  // Adopts what a game's players gave the word library. A row without an account names nobody.
  adopt({ kind, game, gameId, content, accountId, named, summary }: NewContent): AdoptedContent {
    const adoptedAt = new Date(this.now()).toISOString();
    const { lastInsertRowid } = this.#insert.run(
      kind,
      game,
      gameId,
      JSON.stringify(content),
      accountId,
      named && accountId !== null ? 1 : 0,
      adoptedAt,
      summary.zh,
      summary.en,
    );
    return this.#row(this.#byId.get(Number(lastInsertRowid)) as Record<string, unknown>);
  }

  // Names nobody any more by an account that is being deleted, which then goes from the rows by its
  // foreign key. The caller runs this in the transaction that deletes it.
  forget(accountId: number): void {
    this.#forget.run(accountId);
  }

  // Everything adopted, the latest first.
  list(): AdoptedContent[] {
    return this.#list.all().map((row) => this.#row(row));
  }

  #row(row: Record<string, unknown>): AdoptedContent {
    return { ...row, content: JSON.parse(String(row.content)) as Content, named: row.named === 1 } as AdoptedContent;
  }
}

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { AcknowledgmentStore } from './acknowledgments';
import { FeedbackStore } from './feedback';
import { MIGRATIONS } from './migrations';

// The feedback and the acknowledgments are archives (docs/architecture.md#feedback): no row is
// ever deleted, and what a player sent and whom an acknowledgment is for are never changed. The
// only changes are the ones that the players were promised and the operator's notes: a contact
// is cleared after 90 days, the GitHub issue that feedback became is recorded, and a deleted
// account is unlinked from both, which its foreign keys do. These tests fail when code that
// breaks that is added; change them only with a maintainer's agreement.

const SOURCE = join(import.meta.dirname, '..');
const MIGRATIONS_FILE = join(import.meta.dirname, 'migrations.ts');

// The server's code, without its tests.
function sources(dir = SOURCE): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

const ALLOWED = [
  'UPDATE feedback SET contact = NULL WHERE contact IS NOT NULL AND created_at < ?',
  'UPDATE feedback SET issue = ? WHERE id = ?',
];

// Migration 5 rebuilt the feedback table, once, while the project's table was still empty, so that
// its kinds are no longer fixed by a CHECK (store/migrations.ts). Its statements that drop the old
// table and put the new one in its place are allowed there and in no other migration, and
// database.test.ts checks that it copies every row as it was.
const REBUILD = {
  migration: 5,
  statements: ['DROP TABLE feedback', 'ALTER TABLE new_feedback RENAME TO feedback'],
};

// SQL on either table that could delete or rewrite a row, as far as the statement goes: to its
// semicolon, in a migration of several, or to the end of its string. INSERT is looked at too, in
// case it updates or replaces on a conflict, and so is a table renamed to take the place of either.
// The table may be named with main. or in quotes.
const SQL =
  /\b(?:DELETE\s+FROM|UPDATE(?:\s+OR\s+\w+)?|REPLACE\s+INTO|INSERT\s+(?:OR\s+\w+\s+)?INTO|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|ALTER\s+TABLE|ALTER\s+TABLE\s+\S+\s+RENAME\s+TO)\s+(?:main\.)?"?(?:feedback|acknowledgments)\b"?[^'`;]*/gi;

// The statements in the code that change the archive, or could, besides what is allowed.
function offending(code: string, allowed: readonly string[] = ALLOWED): string[] {
  const found: string[] = [];
  for (const [statement] of code.matchAll(SQL)) {
    // ALTER TABLE ... ADD COLUMN only adds (store/migrations.ts), and a plain INSERT only adds a row.
    if (/^ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\b/i.test(statement)) continue;
    if (/^INSERT\s+INTO\b/i.test(statement) && !/\bON\s+CONFLICT\b/i.test(statement)) continue;
    if (!allowed.includes(statement)) found.push(statement);
  }
  return found;
}

// The same for each migration, with the rebuild allowed in migration 5 alone.
const offendingMigrations = (migrations: readonly string[]): string[] =>
  migrations.flatMap((migration, index) => {
    const allowed = index + 1 === REBUILD.migration ? [...ALLOWED, ...REBUILD.statements] : ALLOWED;
    return offending(migration, allowed).map((statement) => `migration ${index + 1}: ${statement}`);
  });

describe('the archive', () => {
  test('has no way to delete or rewrite a row in the stores', () => {
    for (const store of [FeedbackStore, AcknowledgmentStore]) {
      const methods = Object.getOwnPropertyNames(store.prototype);
      expect(methods.filter((name) => /delete|remove|drop|purge|erase|update|edit|set(?!Issue)/i.test(name))).toEqual(
        [],
      );
    }
  });

  test('is changed by no SQL in the server but what was promised', () => {
    const found = sources().flatMap((file) => {
      let code = readFileSync(file, 'utf8');
      // The migrations are looked at one by one, below.
      if (file === MIGRATIONS_FILE) {
        for (const migration of MIGRATIONS) {
          expect(code.includes(migration)).toBe(true);
          code = code.replace(migration, '');
        }
      }
      return offending(code).map((sql) => `${file}: ${sql}`);
    });
    expect(found).toEqual([]);
    expect(offendingMigrations(MIGRATIONS)).toEqual([]);
    expect(sources()).toContain(MIGRATIONS_FILE);
    expect(sources().length).toBeGreaterThan(20);
  });

  test('allows the rebuild of migration 5 there and in no other migration', () => {
    const rebuild = MIGRATIONS[REBUILD.migration - 1] as string;
    expect(offending(rebuild)).toEqual(REBUILD.statements);
    // The same rebuild in a later migration.
    expect(offendingMigrations([...MIGRATIONS, rebuild])).toEqual(
      REBUILD.statements.map((statement) => `migration ${MIGRATIONS.length + 1}: ${statement}`),
    );
    // Any other change, in migration 5 too.
    const changed = [
      ...MIGRATIONS.slice(0, REBUILD.migration - 1),
      `${rebuild}\n  DELETE FROM feedback WHERE id > 10;\n  DROP TABLE acknowledgments;\n`,
    ];
    expect(offendingMigrations(changed)).toEqual([
      'migration 5: DELETE FROM feedback WHERE id > 10',
      'migration 5: DROP TABLE acknowledgments',
    ]);
    // A migration that renames the table away, or puts another in its place, in other words.
    expect(
      offendingMigrations([
        ...MIGRATIONS,
        '\n  ALTER TABLE feedback RENAME TO old_feedback;\n  ALTER TABLE "acknowledgments" RENAME TO thanks;\n',
        '\n  DROP TABLE IF EXISTS main.feedback;\n  ALTER TABLE copy RENAME TO "feedback";\n',
      ]),
    ).toEqual([
      `migration ${MIGRATIONS.length + 1}: ALTER TABLE feedback RENAME TO old_feedback`,
      `migration ${MIGRATIONS.length + 1}: ALTER TABLE "acknowledgments" RENAME TO thanks`,
      `migration ${MIGRATIONS.length + 2}: DROP TABLE IF EXISTS main.feedback`,
      `migration ${MIGRATIONS.length + 2}: ALTER TABLE copy RENAME TO "feedback"`,
    ]);
  });

  test('would be found changed, however the SQL is written', () => {
    expect(offending("db.prepare('DELETE FROM feedback WHERE id = ?')")).toEqual(['DELETE FROM feedback WHERE id = ?']);
    // A migration of several statements, after one that only adds a column.
    expect(
      offending(
        '`\n  ALTER TABLE feedback ADD COLUMN x TEXT;\n  DELETE FROM feedback WHERE id < 100;\n  UPDATE acknowledgments SET name = ?;\n  `',
      ),
    ).toEqual(['DELETE FROM feedback WHERE id < 100', 'UPDATE acknowledgments SET name = ?']);
    for (const sql of [
      'INSERT INTO feedback (id, text) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET text = excluded.text',
      'INSERT OR REPLACE INTO feedback (id, text) VALUES (?, ?)',
      'REPLACE INTO acknowledgments (id, name) VALUES (?, ?)',
      'DELETE FROM main.feedback WHERE id = ?',
      'DELETE FROM "feedback" WHERE id = ?',
      'DROP TABLE acknowledgments',
      'DROP TABLE IF EXISTS feedback',
      'UPDATE OR IGNORE feedback SET text = ?',
      'ALTER TABLE feedback RENAME TO old_feedback',
      'ALTER TABLE new_feedback RENAME TO feedback',
      'ALTER TABLE feedback DROP COLUMN text',
    ]) {
      expect(offending(`db.prepare('${sql}')`), sql).toEqual([sql]);
    }
    for (const sql of [
      'INSERT INTO feedback (text) VALUES (?)',
      'ALTER TABLE feedback ADD COLUMN link TEXT',
      'UPDATE feedback SET issue = ? WHERE id = ?',
      'UPDATE accounts SET username = ? WHERE id = ?',
      'SELECT * FROM feedback',
    ]) {
      expect(offending(`db.prepare('${sql}')`), sql).toEqual([]);
    }
  });
});

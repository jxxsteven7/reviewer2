import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { AcknowledgmentStore } from './acknowledgments';
import { FeedbackStore } from './feedback';

// The feedback and the acknowledgments are archives (docs/architecture.md#feedback): no row is
// ever deleted, and what a player sent and whom an acknowledgment is for are never changed. The
// only changes are the ones that the players were promised and the operator's notes: a contact
// is cleared after 90 days, the GitHub issue that feedback became is recorded, and a deleted
// account is unlinked from both, which its foreign keys do. These tests fail when code that
// breaks that is added; change them only with a maintainer's agreement.

const SOURCE = join(import.meta.dirname, '..');

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

// SQL on either table that could delete or rewrite a row, as far as the statement goes: to its
// semicolon, in a migration of several, or to the end of its string. INSERT is looked at too, in
// case it updates or replaces on a conflict. The table may be named with main. or in quotes.
const SQL =
  /\b(?:DELETE\s+FROM|UPDATE|REPLACE\s+INTO|INSERT\s+(?:OR\s+\w+\s+)?INTO|DROP\s+TABLE|ALTER\s+TABLE)\s+(?:main\.)?"?(?:feedback|acknowledgments)\b"?[^'`;]*/gi;

// The statements in the code that change the archive, or could, besides what is allowed.
function offending(code: string): string[] {
  const found: string[] = [];
  for (const [statement] of code.matchAll(SQL)) {
    // ALTER TABLE ... ADD COLUMN only adds (store/migrations.ts), and a plain INSERT only adds a row.
    if (/^ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\b/i.test(statement)) continue;
    if (/^INSERT\s+INTO\b/i.test(statement) && !/\bON\s+CONFLICT\b/i.test(statement)) continue;
    if (!ALLOWED.includes(statement)) found.push(statement);
  }
  return found;
}

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
    const found = sources().flatMap((file) => offending(readFileSync(file, 'utf8')).map((sql) => `${file}: ${sql}`));
    expect(found).toEqual([]);
    expect(sources().length).toBeGreaterThan(20);
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
      'ALTER TABLE feedback RENAME TO old_feedback',
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

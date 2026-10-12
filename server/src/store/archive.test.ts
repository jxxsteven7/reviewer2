import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';
import { AcknowledgmentStore } from './acknowledgments';
import { FeedbackStore } from './feedback';
import { MIGRATIONS } from './migrations';

// The feedback, the acknowledgments and the reports of players are archives
// (docs/architecture.md#feedback): what a player sent, whom an acknowledgment is for and whom a
// report is about are never changed, and no row of the acknowledgments or the reports is ever
// deleted. The only changes are the ones that the players were promised and the operator's
// notes: a contact is cleared after 90 days, what became of the feedback is recorded (the GitHub
// issue, the pull request, closed or not, in the trash or not), and a deleted account is unlinked
// from all three, which its foreign keys do. The one way a row of feedback goes is the purge of
// what has been in the trash for 30 days. These tests fail when code that breaks that is added;
// change them only with a maintainer's agreement.

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

// What was promised, and the operator's notes (store/feedback.ts), each as it is written there.
const ALLOWED = [
  'UPDATE feedback SET contact = NULL WHERE contact IS NOT NULL AND created_at < ?',
  'UPDATE feedback SET issue = ? WHERE id = ?',
  'UPDATE feedback SET resolved_pr = ?, resolved_at = ? WHERE id = ?',
  'UPDATE feedback SET closed_at = ? WHERE id = ? AND closed_at IS NULL AND deleted_at IS NULL',
  'UPDATE feedback SET closed_at = NULL WHERE id = ? AND closed_at IS NOT NULL AND deleted_at IS NULL',
  'UPDATE feedback SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL AND ' +
    'NOT EXISTS (SELECT 1 FROM acknowledgments WHERE feedback_id = feedback.id)',
  'UPDATE feedback SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL',
  'DELETE FROM feedback WHERE deleted_at IS NOT NULL AND deleted_at < ?',
];

// The methods of the stores whose names say that they delete or rewrite, and the ones of the
// feedback that may: the notes and the trash.
const CHANGING = /delete|remove|drop|purge|erase|update|edit|set/i;
const FEEDBACK_METHODS = ['setIssue', 'delete', 'purge'];

// Migration 5 rebuilds the feedback table, once, so that its kinds are no longer fixed by a CHECK
// (store/migrations.ts). Its statements that drop the old table and put the new one in its place
// are allowed there and in no other migration, and database.test.ts checks that it copies every
// row as it was.
const REBUILD = {
  migration: 5,
  statements: ['DROP TABLE feedback', 'ALTER TABLE new_feedback RENAME TO feedback'],
};

// The strings in TypeScript code, as the SQL in them is written: a literal, or literals joined with
// +, as a long statement is, with <expression> for anything else that is joined to them or put in a
// template. Comments, which don't run, are left out.
function strings(code: string): string[] {
  const found: string[] = [];
  const value = (node: ts.Node): string | null => {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isParenthesizedExpression(node)) return value(node.expression);
    if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) visit(span.expression);
      return node.head.text + node.templateSpans.map((span) => `<expression>${span.literal.text}`).join('');
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const [left, right] = [value(node.left), value(node.right)];
      if (left === null && right === null) return null;
      if (left === null) visit(node.left);
      if (right === null) visit(node.right);
      return (left ?? '<expression>') + (right ?? '<expression>');
    }
    return null;
  };
  const visit = (node: ts.Node): void => {
    const text = value(node);
    if (text === null) ts.forEachChild(node, visit);
    else found.push(text);
  };
  visit(ts.createSourceFile('code.ts', code, ts.ScriptTarget.Latest));
  return found;
}

// A name as SQLite takes it: bare, or in double quotes, backticks or brackets.
const named = (names: string) => `(?:${names}|"(?:${names})"|\`(?:${names})\`|\\[(?:${names})\\])`;
// SQL on any of the tables that could delete or rewrite a row, as far as the statement goes: to its
// semicolon, in a migration of several, or to the end of its string. INSERT is looked at too, in
// case it updates or replaces on a conflict, and so is a table renamed to take the place of either.
// The table may be named with main. and in quotes.
const SQL = new RegExp(
  '\\b(?:DELETE\\s+FROM|UPDATE(?:\\s+OR\\s+\\w+)?|REPLACE\\s+INTO|INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO|' +
    'DROP\\s+TABLE(?:\\s+IF\\s+EXISTS)?|ALTER\\s+TABLE|ALTER\\s+TABLE\\s+\\S+\\s+RENAME\\s+TO)\\s+' +
    `(?:${named('main')}\\s*\\.\\s*)?${named('feedback|acknowledgments|reports')}(?![\\w$])[^;]*`,
  'gi',
);

// The statements in SQL that change the archive, or could, besides what is allowed, each on one
// line. ALTER TABLE ... ADD COLUMN only adds, unless the new column's foreign key deletes the row
// with its parent, and a plain INSERT only adds a row.
function offending(sql: string, allowed: readonly string[] = ALLOWED): string[] {
  const found: string[] = [];
  const plain = sql.replace(/\/\*[\s\S]*?\*\/|--[^\n]*/g, ' ');
  for (const [match] of plain.matchAll(SQL)) {
    const statement = match.replace(/\s+/g, ' ').trim();
    if (/^ALTER TABLE \S+ ADD COLUMN /i.test(statement) && !/\bON DELETE CASCADE\b/i.test(statement)) continue;
    if (/^INSERT INTO\b/i.test(statement) && !/\bON CONFLICT\b/i.test(statement)) continue;
    if (!allowed.includes(statement)) found.push(statement);
  }
  return found;
}

// The same for the strings in TypeScript code.
const offendingCode = (code: string): string[] => strings(code).flatMap((sql) => offending(sql));

// The same for each migration, with the rebuild allowed in migration 5 alone.
const offendingMigrations = (migrations: readonly string[]): string[] =>
  migrations.flatMap((migration, index) => {
    const allowed = index + 1 === REBUILD.migration ? [...ALLOWED, ...REBUILD.statements] : ALLOWED;
    return offending(migration, allowed).map((statement) => `migration ${index + 1}: ${statement}`);
  });

describe('the archive', () => {
  test('has no way to delete or rewrite a row in the stores, but the notes on the feedback and its trash', () => {
    const changing = (store: object) =>
      Object.getOwnPropertyNames((store as { prototype: object }).prototype).filter((name) => CHANGING.test(name));
    expect(changing(FeedbackStore).sort()).toEqual([...FEEDBACK_METHODS].sort());
    expect(changing(AcknowledgmentStore)).toEqual([]);
  });

  test('is changed by no SQL in the server but what was promised', () => {
    const all = sources().flatMap((file) => strings(readFileSync(file, 'utf8')).map((sql) => ({ file, sql })));
    // The migrations are looked at one by one, below.
    const found = all
      .filter(({ sql }) => !MIGRATIONS.includes(sql))
      .flatMap(({ file, sql }) => offending(sql).map((statement) => `${file}: ${statement}`));
    expect(found).toEqual([]);
    expect(offendingMigrations(MIGRATIONS)).toEqual([]);
    // The scan sees the server's SQL, the migrations and the statements written in pieces among it.
    const seen = all.map(({ sql }) => sql);
    expect(seen).toEqual(expect.arrayContaining([...MIGRATIONS, ...ALLOWED]));
    expect(seen.some((sql) => /^INSERT INTO feedback \(created_at, .* VALUES \(\?(, \?)+\)$/.test(sql))).toBe(true);
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
    expect(offendingCode("db.prepare('DELETE FROM feedback WHERE id = ?')")).toEqual([
      'DELETE FROM feedback WHERE id = ?',
    ]);
    // A migration of several statements, after one that only adds a column.
    expect(
      offending(
        '\n  ALTER TABLE feedback ADD COLUMN x TEXT;\n  DELETE FROM feedback WHERE id < 100;\n  UPDATE acknowledgments SET name = ?;\n  ',
      ),
    ).toEqual(['DELETE FROM feedback WHERE id < 100', 'UPDATE acknowledgments SET name = ?']);
    // A column whose foreign key deletes the row with its parent.
    expect(
      offending('\n  ALTER TABLE feedback ADD COLUMN room_id INTEGER REFERENCES rooms (id) ON DELETE CASCADE;\n'),
    ).toEqual(['ALTER TABLE feedback ADD COLUMN room_id INTEGER REFERENCES rooms (id) ON DELETE CASCADE']);
    // Written in pieces, as a long statement is, with quotes in it, with more joined to what is
    // allowed, or put together from what isn't a literal.
    expect(
      offendingCode(
        [
          "db.prepare('INSERT INTO feedback (id, text) VALUES (?, ?) ' +",
          "  'ON CONFLICT (id) DO UPDATE SET text = excluded.text');",
          `db.prepare("INSERT INTO feedback (id, kind) VALUES (?, 'idea') ON CONFLICT (id) DO NOTHING");`,
          "db.prepare('UPDATE feedback SET issue = ? WHERE id = ?' + ' OR 1');",
          "db.prepare('UPDATE feedback SET issue = ? WHERE id = ?' + condition);",
          'db.prepare(`DELETE FROM feedback WHERE id IN (${ids.join()})`);',
          "db.exec(clear ? 'DELETE FROM feedback' : 'SELECT 1');",
        ].join('\n'),
      ),
    ).toEqual([
      'INSERT INTO feedback (id, text) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET text = excluded.text',
      "INSERT INTO feedback (id, kind) VALUES (?, 'idea') ON CONFLICT (id) DO NOTHING",
      'UPDATE feedback SET issue = ? WHERE id = ? OR 1',
      'UPDATE feedback SET issue = ? WHERE id = ?<expression>',
      'DELETE FROM feedback WHERE id IN (<expression>)',
      'DELETE FROM feedback',
    ]);
    // With a comment in it.
    expect(
      offendingCode("db.exec('DELETE /* every row */ FROM feedback; DELETE -- all\\n FROM acknowledgments')"),
    ).toEqual(['DELETE FROM feedback', 'DELETE FROM acknowledgments']);
    for (const sql of [
      'INSERT INTO feedback (id, text) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET text = excluded.text',
      'INSERT OR REPLACE INTO feedback (id, text) VALUES (?, ?)',
      'REPLACE INTO acknowledgments (id, name) VALUES (?, ?)',
      'DELETE FROM main.feedback WHERE id = ?',
      'DELETE FROM "feedback" WHERE id = ?',
      'DELETE FROM `feedback` WHERE id = ?',
      'DELETE FROM [feedback] WHERE id = ?',
      'DELETE FROM "main"."feedback" WHERE id = ?',
      'DELETE FROM main . feedback',
      'DROP TABLE acknowledgments',
      'DROP TABLE IF EXISTS feedback',
      'DELETE FROM reports WHERE created_at < ?',
      'UPDATE reports SET text = NULL',
      // The trash, purged without waiting, or emptied by hand.
      'DELETE FROM feedback WHERE deleted_at IS NOT NULL',
      'DELETE FROM feedback WHERE deleted_at IS NOT NULL AND id = ?',
      'UPDATE feedback SET deleted_at = ? WHERE id = ?',
      'UPDATE OR IGNORE feedback SET text = ?',
      'ALTER TABLE feedback RENAME TO old_feedback',
      'ALTER TABLE new_feedback RENAME TO feedback',
      'ALTER TABLE feedback DROP COLUMN text',
    ]) {
      expect(offendingCode(`db.prepare('${sql}')`), sql).toEqual([sql]);
    }
    for (const code of [
      "db.prepare('INSERT INTO feedback (text) VALUES (?)')",
      "db.exec('ALTER TABLE feedback ADD COLUMN link TEXT')",
      "db.exec('ALTER TABLE feedback ADD COLUMN room_id INTEGER REFERENCES rooms (id) ON DELETE SET NULL')",
      "db.prepare('UPDATE feedback SET issue = ? WHERE id = ?')",
      "db.prepare('UPDATE feedback SET contact = NULL WHERE contact IS NOT NULL ' + 'AND created_at < ?')",
      "db.prepare('DELETE FROM feedback WHERE deleted_at IS NOT NULL AND deleted_at < ?')",
      "db.prepare('UPDATE accounts SET username = ? WHERE id = ?')",
      "db.prepare('DELETE FROM feedback_drafts')",
      "db.prepare('INSERT INTO reports (created_at, reporter_id) VALUES (?, ?)')",
      "db.prepare('SELECT * FROM feedback')",
      '// DELETE FROM feedback, in a comment, which never runs',
    ]) {
      expect(offendingCode(code), code).toEqual([]);
    }
  });
});

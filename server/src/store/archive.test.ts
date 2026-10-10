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
    const allowed = [
      'UPDATE feedback SET contact = NULL WHERE contact IS NOT NULL AND created_at < ?',
      'UPDATE feedback SET issue = ? WHERE id = ?',
    ];
    const found: string[] = [];
    for (const file of sources()) {
      const code = readFileSync(file, 'utf8');
      for (const [statement] of code.matchAll(
        /\b(?:DELETE\s+FROM|UPDATE|REPLACE\s+INTO|INSERT\s+OR\s+REPLACE\s+INTO|DROP\s+TABLE|ALTER\s+TABLE)\s+(?:feedback|acknowledgments)\b[^'`]*/gi,
      )) {
        // ALTER TABLE ... ADD COLUMN only adds (store/migrations.ts).
        if (/^ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN\b/i.test(statement)) continue;
        if (!allowed.includes(statement)) found.push(`${file}: ${statement}`);
      }
    }
    expect(found).toEqual([]);
    expect(sources().length).toBeGreaterThan(20);
  });
});

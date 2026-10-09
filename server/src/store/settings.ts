import type { DatabaseSync, StatementSync } from 'node:sqlite';

// Settings that the server keeps between starts (migration 2): one text under one key.

export class SettingStore {
  readonly #get: StatementSync;
  readonly #set: StatementSync;

  constructor(db: DatabaseSync) {
    this.#get = db.prepare('SELECT value FROM settings WHERE key = ?');
    this.#set = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    );
  }

  get(key: string): string | null {
    return (this.#get.get(key) as { value: string } | undefined)?.value ?? null;
  }

  set(key: string, value: string): void {
    this.#set.run(key, value);
  }
}

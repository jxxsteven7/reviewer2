import type { DatabaseSync, StatementSync } from 'node:sqlite';

// The accounts table (migration 2, docs/architecture.md). This module only reads and writes rows:
// the rules for usernames and passwords are in shared/src/accounts.ts and server/src/accounts/,
// and nothing here sees a password, a token or an email address, only their hashes.

export interface Account {
  id: number;
  username: string;
  // usernameKey() of the username, which no other account has.
  key: string;
  // The scrypt hash with its parameters (accounts/passwords.ts).
  password: string;
  // The HMAC of the confirmed email address, or null.
  emailFp: Uint8Array | null;
  // The file name of the uploaded avatar, or null for the default one.
  avatar: string | null;
  // Whether the operator has barred the account from uploading an avatar.
  avatarBanned: boolean;
  createdAt: string;
}

interface Row {
  id: number;
  username: string;
  key: string;
  password: string;
  emailFp: Uint8Array | null;
  avatar: string | null;
  avatarBanned: number;
  createdAt: string;
}

const COLUMNS =
  'id, username, username_key AS key, password, email_fp AS emailFp, avatar, avatar_banned AS avatarBanned, ' +
  'created_at AS createdAt';

const toAccount = (row: Row | undefined): Account | undefined =>
  row && { ...row, avatarBanned: row.avatarBanned === 1 };

// SQLite's extended result code for a UNIQUE constraint that a write would break.
const UNIQUE_FAILED = 2067;

export const isUniqueFailure = (error: unknown): boolean =>
  (error as { errcode?: unknown } | null)?.errcode === UNIQUE_FAILED;

// The clock is the system's, in milliseconds since 1970, for the times that are kept.
export class AccountStore {
  readonly #insert: StatementSync;
  readonly #byId: StatementSync;
  readonly #byKey: StatementSync;
  readonly #byEmail: StatementSync;
  readonly #rename: StatementSync;
  readonly #password: StatementSync;
  readonly #email: StatementSync;
  readonly #unbindAll: StatementSync;
  readonly #avatar: StatementSync;
  readonly #avatarUsers: StatementSync;
  readonly #avatars: StatementSync;
  readonly #ban: StatementSync;
  readonly #delete: StatementSync;
  readonly #count: StatementSync;

  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.#insert = db.prepare(
      'INSERT INTO accounts (username, username_key, password, created_at) VALUES (?, ?, ?, ?)',
    );
    this.#byId = db.prepare(`SELECT ${COLUMNS} FROM accounts WHERE id = ?`);
    this.#byKey = db.prepare(`SELECT ${COLUMNS} FROM accounts WHERE username_key = ?`);
    this.#byEmail = db.prepare(`SELECT ${COLUMNS} FROM accounts WHERE email_fp = ?`);
    this.#rename = db.prepare('UPDATE accounts SET username = ?, username_key = ? WHERE id = ?');
    this.#password = db.prepare('UPDATE accounts SET password = ? WHERE id = ?');
    this.#email = db.prepare('UPDATE accounts SET email_fp = ? WHERE id = ?');
    this.#unbindAll = db.prepare('UPDATE accounts SET email_fp = NULL WHERE email_fp IS NOT NULL');
    this.#avatar = db.prepare('UPDATE accounts SET avatar = ? WHERE id = ?');
    this.#avatarUsers = db.prepare('SELECT count(*) AS count FROM accounts WHERE avatar = ?');
    this.#avatars = db.prepare('SELECT DISTINCT avatar FROM accounts WHERE avatar IS NOT NULL');
    this.#ban = db.prepare('UPDATE accounts SET avatar_banned = ? WHERE id = ?');
    this.#delete = db.prepare(`DELETE FROM accounts WHERE id = ? RETURNING ${COLUMNS}`);
    this.#count = db.prepare('SELECT count(*) AS count FROM accounts');
  }

  // A new account, or null when another has the same key already.
  create(username: string, key: string, password: string): Account | null {
    try {
      const { lastInsertRowid } = this.#insert.run(username, key, password, new Date(this.now()).toISOString());
      return this.byId(Number(lastInsertRowid)) ?? null;
    } catch (error) {
      if (isUniqueFailure(error)) return null;
      throw error;
    }
  }

  byId(id: number): Account | undefined {
    return toAccount(this.#byId.get(id) as Row | undefined);
  }

  byKey(key: string): Account | undefined {
    return toAccount(this.#byKey.get(key) as Row | undefined);
  }

  byEmail(fingerprint: Uint8Array): Account | undefined {
    return toAccount(this.#byEmail.get(fingerprint) as Row | undefined);
  }

  // Whether the account got the name: false when another account has the same key.
  rename(id: number, username: string, key: string): boolean {
    try {
      this.#rename.run(username, key, id);
      return true;
    } catch (error) {
      if (isUniqueFailure(error)) return false;
      throw error;
    }
  }

  setPassword(id: number, password: string): void {
    this.#password.run(password, id);
  }

  // Binds the address with this fingerprint, or unbinds it with null. False when another account
  // has the address.
  setEmail(id: number, fingerprint: Uint8Array | null): boolean {
    try {
      this.#email.run(fingerprint, id);
      return true;
    } catch (error) {
      if (isUniqueFailure(error)) return false;
      throw error;
    }
  }

  // Unbinds every address, and says how many there were.
  unbindAll(): number {
    return Number(this.#unbindAll.run().changes);
  }

  // Sets the avatar's file name, or null for the default avatar, and returns the one it had.
  setAvatar(id: number, file: string | null): string | null {
    const previous = this.byId(id)?.avatar ?? null;
    this.#avatar.run(file, id);
    return previous;
  }

  // How many accounts show this file. Two accounts that upload the same image share it.
  avatarUsers(file: string): number {
    return (this.#avatarUsers.get(file) as { count: number }).count;
  }

  // Every file that an account shows.
  avatarFiles(): Set<string> {
    return new Set((this.#avatars.all() as { avatar: string }[]).map(({ avatar }) => avatar));
  }

  setAvatarBanned(id: number, banned: boolean): void {
    this.#ban.run(banned ? 1 : 0, id);
  }

  // Deletes the account and, through the foreign keys, everything that belongs to it. Returns
  // the account as it was, so that its avatar can go too.
  delete(id: number): Account | undefined {
    return toAccount(this.#delete.get(id) as Row | undefined);
  }

  count(): number {
    return (this.#count.get() as { count: number }).count;
  }

  // Runs `write` in one transaction: all of it happens, or none of it does.
  transaction<T>(write: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = write();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // SQLite may have rolled back by itself already.
      }
      throw error;
    }
  }
}

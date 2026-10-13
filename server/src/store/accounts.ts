import { randomBytes } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { ProfileSettings } from '@reviewer2/shared';
import { DEFAULT_SESSION_LIMITS } from './sessions';

// The accounts table (migration 2, docs/architecture.md). This module only reads and writes rows:
// the rules for usernames and passwords are in shared/src/accounts.ts and server/src/accounts/,
// and nothing here sees a password, a token or an email address, only their hashes.

export interface Account {
  id: number;
  // The key of the public profile (migration 11; HANDLE in shared/src/accounts.ts).
  handle: string;
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
  // Whether the operator has barred the account from public rooms (migration 6).
  publicBarred: boolean;
  // Whether the operator has let the account have AI players in the rooms it chairs (migration 13).
  agents: boolean;
  // The public profile (migration 11): the link and the bio the owner wrote, what else they show
  // there, and whether the operator has barred the account from writing a link or a bio.
  profile: ProfileSettings;
  profileBanned: boolean;
  createdAt: string;
}

interface Row {
  id: number;
  handle: string;
  username: string;
  key: string;
  password: string;
  emailFp: Uint8Array | null;
  avatar: string | null;
  avatarBanned: number;
  publicBarred: number;
  agents: number;
  link: string | null;
  bio: string | null;
  showRecord: number;
  showThanks: number;
  profileBanned: number;
  createdAt: string;
}

const COLUMNS =
  'id, handle, username, username_key AS key, password, email_fp AS emailFp, avatar, ' +
  'avatar_banned AS avatarBanned, public_barred AS publicBarred, agents, link, bio, show_record AS showRecord, ' +
  'show_thanks AS showThanks, profile_banned AS profileBanned, created_at AS createdAt';

function toAccount(row: Row | undefined): Account | undefined {
  if (!row) return undefined;
  const { avatarBanned, publicBarred, agents, link, bio, showRecord, showThanks, profileBanned, ...rest } = row;
  return {
    ...rest,
    avatarBanned: avatarBanned === 1,
    publicBarred: publicBarred === 1,
    agents: agents === 1,
    profile: { link, bio, showRecord: showRecord === 1, showThanks: showThanks === 1 },
    profileBanned: profileBanned === 1,
  };
}

// A new handle: 6 random bytes as 12 hexadecimal digits, as the migration drew them.
export const newHandle = (): string => randomBytes(6).toString('hex');

// What the operator's statistics (admin.ts) say of one account: nothing that could be used to log
// in or to reach the player.
export interface AccountListing {
  id: number;
  username: string;
  createdAt: string;
  // How many games the account has finished, and how many matches.
  games: number;
  matches: number;
  // Whether the operator has barred it from public rooms.
  barred: boolean;
}

const DAY_MS = 24 * 60 * 60_000;

// How many days back activity is known: a login unused for longer is deleted (sessions.ts).
const ACTIVE_DAYS = DEFAULT_SESSION_LIMITS.idleMs / DAY_MS;

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
  readonly #bar: StatementSync;
  readonly #agents: StatementSync;
  readonly #agentUsers: StatementSync;
  readonly #byHandle: StatementSync;
  readonly #profile: StatementSync;
  readonly #profileBan: StatementSync;
  readonly #profiles: StatementSync;
  readonly #delete: StatementSync;
  readonly #count: StatementSync;
  readonly #counts: StatementSync;
  readonly #createdByDay: StatementSync;
  readonly #activeSince: StatementSync;
  readonly #list: StatementSync;

  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.#insert = db.prepare(
      'INSERT INTO accounts (username, username_key, password, handle, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    this.#byHandle = db.prepare(`SELECT ${COLUMNS} FROM accounts WHERE handle = ?`);
    this.#profile = db.prepare('UPDATE accounts SET link = ?, bio = ?, show_record = ?, show_thanks = ? WHERE id = ?');
    this.#profileBan = db.prepare('UPDATE accounts SET profile_banned = ? WHERE id = ?');
    this.#profiles = db.prepare(
      'SELECT id, username, link, bio FROM accounts WHERE link IS NOT NULL OR bio IS NOT NULL ORDER BY id',
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
    this.#bar = db.prepare('UPDATE accounts SET public_barred = ? WHERE id = ?');
    this.#agents = db.prepare('UPDATE accounts SET agents = ? WHERE id = ?');
    this.#agentUsers = db.prepare('SELECT id, username FROM accounts WHERE agents = 1 ORDER BY id');
    this.#delete = db.prepare(`DELETE FROM accounts WHERE id = ? RETURNING ${COLUMNS}`);
    this.#count = db.prepare('SELECT count(*) AS count FROM accounts');
    // The statistics for the operator (admin.ts) and the status page.
    this.#counts = db.prepare(
      'SELECT count(*) AS total, count(*) FILTER (WHERE created_at >= ?) AS recent FROM accounts',
    );
    this.#createdByDay = db.prepare(
      'SELECT substr(created_at, 1, 10) AS day, count(*) AS count FROM accounts WHERE created_at >= ? ' +
        'GROUP BY day ORDER BY day',
    );
    this.#activeSince = db.prepare(
      'SELECT count(*) AS count FROM accounts WHERE ' +
        'EXISTS (SELECT 1 FROM sessions WHERE account_id = accounts.id AND used_at >= ?) OR ' +
        'EXISTS (SELECT 1 FROM game_records WHERE account_id = accounts.id AND ended_at >= ?)',
    );
    this.#list = db.prepare(
      'SELECT id, username, created_at AS createdAt, ' +
        '(SELECT count(*) FROM game_records WHERE account_id = accounts.id) AS games, ' +
        '(SELECT count(*) FROM match_records WHERE account_id = accounts.id) AS matches, ' +
        'public_barred AS barred FROM accounts ORDER BY id',
    );
  }

  // A new account, with a handle of its own, or null when another has the same key already. A
  // handle that another account has, which chance allows once in 2^48 draws, is drawn again.
  create(username: string, key: string, password: string): Account | null {
    for (;;) {
      try {
        const { lastInsertRowid } = this.#insert.run(
          username,
          key,
          password,
          newHandle(),
          new Date(this.now()).toISOString(),
        );
        return this.byId(Number(lastInsertRowid)) ?? null;
      } catch (error) {
        if (!isUniqueFailure(error)) throw error;
        if (this.byKey(key)) return null;
      }
    }
  }

  byId(id: number): Account | undefined {
    return toAccount(this.#byId.get(id) as Row | undefined);
  }

  byHandle(handle: string): Account | undefined {
    return toAccount(this.#byHandle.get(handle) as Row | undefined);
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

  setPublicBarred(id: number, barred: boolean): void {
    this.#bar.run(barred ? 1 : 0, id);
  }

  setAgents(id: number, allowed: boolean): void {
    this.#agents.run(allowed ? 1 : 0, id);
  }

  // The accounts that may have AI players, for the operator (admin.ts).
  agentUsers(): { id: number; username: string }[] {
    return this.#agentUsers.all() as { id: number; username: string }[];
  }

  // What the owner writes on the public profile, and what of the rest they show there.
  setProfile(id: number, { link, bio, showRecord, showThanks }: ProfileSettings): void {
    this.#profile.run(link, bio, showRecord ? 1 : 0, showThanks ? 1 : 0, id);
  }

  setProfileBanned(id: number, banned: boolean): void {
    this.#profileBan.run(banned ? 1 : 0, id);
  }

  // Every account with a link or a bio on its profile, oldest first, for the operator to look over.
  profiles(): { id: number; username: string; link: string | null; bio: string | null }[] {
    return this.#profiles.all() as { id: number; username: string; link: string | null; bio: string | null }[];
  }

  // Deletes the account and, through the foreign keys, everything that belongs to it. Returns
  // the account as it was, so that its avatar can go too.
  delete(id: number): Account | undefined {
    return toAccount(this.#delete.get(id) as Row | undefined);
  }

  count(): number {
    return (this.#count.get() as { count: number }).count;
  }

  // How many accounts there are, and how many of them were created in the last `days` days, read
  // in one statement so that the two agree.
  counts(days: number): { total: number; recent: number } {
    return this.#counts.get(this.#since(days)) as { total: number; recent: number };
  }

  // How many accounts were created on each of the last `days` days, in UTC, oldest first, today
  // included. A day with none is in the list as 0.
  createdByDay(days: number): { day: string; count: number }[] {
    // The clock is read once, so that the days and the query's cutoff agree even across midnight.
    const now = this.now();
    const dayAgo = (ago: number) => new Date(now - ago * DAY_MS).toISOString().slice(0, 10);
    const counts = new Map(
      (this.#createdByDay.all(dayAgo(days - 1)) as { day: string; count: number }[]).map(({ day, count }) => [
        day,
        count,
      ]),
    );
    return Array.from({ length: days }, (_, index) => dayAgo(days - 1 - index)).map((day) => ({
      day,
      count: counts.get(day) ?? 0,
    }));
  }

  // How many accounts were active in the last `days` days: a browser logged in on them was used,
  // or they finished a game. A login that has ended, by logging out, by a password change or by
  // being one too many, is deleted with the time it was last used, so an account that logged in
  // and out again without finishing a game isn't counted. Unused logins are deleted after
  // ACTIVE_DAYS, so a longer window would miss accounts, and asking for one throws.
  activeWithin(days: number): number {
    if (days > ACTIVE_DAYS) throw new RangeError(`activity is known for ${ACTIVE_DAYS} days, not ${days}`);
    const since = this.#since(days);
    return (this.#activeSince.get(since, since) as { count: number }).count;
  }

  // Every account, oldest first, as the operator's statistics list them.
  list(): AccountListing[] {
    return (this.#list.all() as unknown as (Omit<AccountListing, 'barred'> & { barred: number })[]).map((row) => ({
      ...row,
      barred: row.barred === 1,
    }));
  }

  #since(days: number): string {
    return new Date(this.now() - days * DAY_MS).toISOString();
  }

  // Runs `write` in one transaction: all of it happens, or none of it does.
  transaction<T>(write: () => T): T {
    return this.#run('BEGIN IMMEDIATE', write);
  }

  // Runs `read` on one snapshot of the database, so that what it reads agrees with itself while
  // the server writes. It works on a connection that is read-only.
  snapshot<T>(read: () => T): T {
    return this.#run('BEGIN', read);
  }

  #run<T>(begin: string, work: () => T): T {
    this.db.exec(begin);
    try {
      const result = work();
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

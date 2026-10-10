import {
  AVATAR_PATH,
  checkPassword,
  checkUsername,
  cleanName,
  MAIL_LINK_MS,
  usernameKey,
  type AccountError,
  type AccountSummary,
  type Language,
  type MailKind,
  type RecordsView,
} from '@reviewer2/shared';
import type { DatabaseSync } from 'node:sqlite';
import { AccountStore, type Account } from '../store/accounts';
import { databaseBytes, MAX_DATABASE_BYTES } from '../store/database';
import { RecordStore, TitleStore, type NewMatchRecord, type NewRecord } from '../store/records';
import { MailTokenStore, SessionStore, type SessionLimits } from '../store/sessions';
import { SettingStore } from '../store/settings';
import { inspectAvatar, MAX_AVATAR_STORAGE, MemoryAvatars, type AvatarFiles } from './avatars';
import { fingerprint, normalizeEmail } from './email';
import { AccountCounters, confirmKey, DEFAULT_ACCOUNT_LIMITS, type AccountLimits } from './limits';
import type { MailChannel } from './mail';
import { BusyError, PasswordHasher } from './passwords';
import { hashSecret, isSecret, newSecret } from './tokens';

// What accounts can do (docs/architecture.md), whatever carries the request: http.ts in this
// directory reads the requests and the login cookie, and answers them; the socket layer asks who
// a connection is and records the games. Every method checks its limits before it does anything
// that costs, and counts against them before the one thing that is awaited, the password's hash,
// so that requests that arrive together can't all pass a limit before any is counted. Every check
// that a write depends on, the login that the request came with above all, is made again after
// the hash, inside the transaction that writes.

type Log = (event: string, fields?: Record<string, unknown>) => void;

export type AccountFailure = AccountError | 'bad_request' | 'rate_limited' | 'internal';
export type AccountResult<Data extends object = object> = ({ ok: true } & Data) | { ok: false; error: AccountFailure };

const refuse = (error: AccountFailure): { ok: false; error: AccountFailure } => ({ ok: false, error });

// The setting that holds the fingerprint of this text, by which a change of the key is told.
const KEY_SETTING = 'email_fingerprint_key';
const KEY_TEXT = 'the key that the fingerprints of addresses are made with';

// What the socket layer must do when an account changes, which the HTTP side can't do itself.
export interface AccountHooks {
  // These logins have ended: the connections that came with them are no longer the account.
  sessionsEnded(hashes: readonly Uint8Array[]): void;
  // The username or the avatar changed, which the rooms that the account is in show.
  accountChanged(accountId: number): void;
  // The account is gone, and with it its place in every room.
  accountDeleted(accountId: number): void;
}

const NO_HOOKS: AccountHooks = {
  sessionsEnded: () => {},
  accountChanged: () => {},
  accountDeleted: () => {},
};

// A request's login: the account, and the hash of the secret in the cookie.
export interface Login {
  account: Account;
  hash: Buffer;
}

export interface AccountsOptions {
  db: DatabaseSync;
  // The server's clock that only runs forward, for the limits.
  now: () => number;
  // The system's clock, for what is kept: a login lasts 30 days of the calendar.
  clock?: () => number;
  log?: Log;
  limits?: AccountLimits;
  sessionLimits?: SessionLimits;
  hasher?: PasswordHasher;
  maxDatabaseBytes?: number;
  // Called after an account was deleted, so that what it held can be dropped from the WAL too.
  deleted?: () => void;
  // The key that email addresses are fingerprinted with, and the way to the mailer. Without both,
  // accounts have no email: no address can be bound, and no password reset.
  fingerprintKey?: Buffer | null;
  mail?: MailChannel | null;
  // Where the avatars are kept, in memory unless the server has a data directory, and how much
  // room they may take together.
  avatars?: AvatarFiles;
  maxAvatarBytes?: number;
}

export class Accounts {
  readonly store: AccountStore;
  readonly sessions: SessionStore;
  readonly mailTokens: MailTokenStore;
  readonly records: RecordStore;
  readonly titles: TitleStore;
  readonly settings: SettingStore;
  readonly counters: AccountCounters;
  readonly hasher: PasswordHasher;
  // Set by the socket layer once it is there.
  hooks: AccountHooks = NO_HOOKS;
  readonly #db: DatabaseSync;
  readonly #log: Log;
  readonly #maxDatabaseBytes: number;
  readonly #deleted: () => void;
  readonly #fingerprintKey: Buffer | null;
  readonly #mail: MailChannel | null;
  readonly avatars: AvatarFiles;
  readonly #maxAvatarBytes: number;
  // Whether the log has been told that the avatars take all the room they may.
  #avatarsFullLogged = false;
  // Whether the log has been told that the database is full. Once is enough until it isn't.
  #fullLogged = false;

  constructor(options: AccountsOptions) {
    const clock = options.clock ?? (() => Date.now());
    this.#db = options.db;
    this.#log = options.log ?? (() => {});
    this.#maxDatabaseBytes = options.maxDatabaseBytes ?? MAX_DATABASE_BYTES;
    this.#deleted = options.deleted ?? (() => {});
    this.#fingerprintKey = options.fingerprintKey ?? null;
    this.#mail = options.mail ?? null;
    this.avatars = options.avatars ?? new MemoryAvatars();
    this.#maxAvatarBytes = options.maxAvatarBytes ?? MAX_AVATAR_STORAGE;
    this.store = new AccountStore(options.db, clock);
    this.sessions = new SessionStore(options.db, clock, options.sessionLimits);
    this.mailTokens = new MailTokenStore(options.db, clock);
    this.records = new RecordStore(options.db, clock);
    this.titles = new TitleStore(options.db, clock);
    this.settings = new SettingStore(options.db);
    this.counters = new AccountCounters(options.limits ?? DEFAULT_ACCOUNT_LIMITS, options.now);
    this.hasher = options.hasher ?? new PasswordHasher();
  }

  // The login that a cookie's secret stands for, or null when it stands for none or has ended.
  login(secret: string | null): Login | null {
    if (!isSecret(secret)) return null;
    const hash = hashSecret(secret);
    const found = this.sessions.find(hash);
    const account = found ? this.store.byId(found.accountId) : undefined;
    return account ? { account, hash } : null;
  }

  // What the owner sees of their account.
  summary(account: Account): AccountSummary {
    let email: AccountSummary['email'] = 'none';
    if (account.emailFp !== null) email = 'bound';
    else if (this.mailTokens.pending(account.id)) email = 'pending';
    return {
      username: account.username,
      avatar: avatarUrl(account),
      email,
      titles: this.titles.counts(account.id),
    };
  }

  // Whether a guest's nickname is someone's username, compared as usernames are.
  reserved(nickname: string): boolean {
    const name = cleanName(nickname);
    return name !== null && this.store.byKey(usernameKey(name)) !== undefined;
  }

  async register(ip: string, rawName: string, password: string): Promise<AccountResult<{ secret: string }>> {
    const { registrations, failedRegistrations } = this.counters;
    if (!registrations.allowed(ip) || !failedRegistrations.allowed(ip)) return refuse('register_limited');
    const failed = (error: AccountFailure) => {
      failedRegistrations.add(ip);
      return refuse(error);
    };
    const checked = checkUsername(rawName);
    if (checked.problem) return failed(checked.problem);
    const passwordProblem = checkPassword(password);
    if (passwordProblem) return failed(passwordProblem);
    if (this.#full()) return refuse('storage_full');
    const key = usernameKey(checked.username);
    if (this.store.byKey(key)) return failed('username_taken');
    // The account counts against the address from here on, and is given back if nothing comes of it.
    registrations.add(ip);
    const hashed = await this.#hash(password);
    if (!hashed.ok) {
      registrations.refund(ip);
      return hashed;
    }
    const secret = newSecret();
    const account = this.store.transaction(() => {
      const created = this.store.create(checked.username, key, hashed.hash);
      if (created) this.sessions.create(hashSecret(secret), created.id);
      return created;
    });
    // Someone else took the name while the password was being hashed.
    if (!account) {
      registrations.refund(ip);
      return failed('username_taken');
    }
    this.#log('account_created', { id: account.id });
    return { ok: true, secret };
  }

  // Logs a browser in. The login it had before, if any, ends, and the new one gets a new secret,
  // so that a secret that someone else planted in the browser is never logged in.
  async logIn(
    ip: string,
    rawName: string,
    password: string,
    previous: Login | null,
  ): Promise<AccountResult<{ secret: string }>> {
    const name = typeof rawName === 'string' ? cleanName(rawName) : null;
    if (name === null || typeof password !== 'string') return refuse('login_failed');
    const key = usernameKey(name);
    // The try counts as a wrong password until it proves right.
    if (!this.counters.tryPassword(ip, key)) return refuse('login_limited');
    const account = this.store.byKey(key);
    const verified = await this.#verify(password, account?.password ?? null);
    if (!verified.ok) {
      this.counters.rightPassword(ip, key);
      return verified;
    }
    if (!verified.match || account === undefined) return refuse('login_failed');
    // A hash made with older parameters is made again with the current ones. One that can't be
    // right now, for the hasher being busy, is left as it is.
    const rehashed = verified.outdated ? await this.#hash(password) : null;
    const secret = newSecret();
    const ended = this.store.transaction(() => {
      // The account may have gone, or its password changed, while the password was being checked
      // and hashed. The hash that was checked is written back over nothing else.
      const current = this.store.byId(account.id);
      if (current === undefined || current.password !== account.password) return null;
      if (rehashed?.ok) this.store.setPassword(current.id, rehashed.hash);
      if (previous) this.sessions.delete(previous.hash);
      return this.sessions.create(hashSecret(secret), current.id);
    });
    if (ended === null) return refuse('login_failed');
    this.counters.rightPassword(ip, key);
    this.hooks.sessionsEnded(previous ? [previous.hash, ...ended] : ended);
    return { ok: true, secret };
  }

  logOut(login: Login): void {
    this.sessions.delete(login.hash);
    this.hooks.sessionsEnded([login.hash]);
  }

  rename(login: Login, rawName: string): AccountResult {
    const checked = checkUsername(rawName);
    if (checked.problem) return refuse(checked.problem);
    const { account } = login;
    if (checked.username === account.username) return { ok: true };
    if (!this.store.rename(account.id, checked.username, usernameKey(checked.username))) {
      return refuse('username_taken');
    }
    this.hooks.accountChanged(account.id);
    return { ok: true };
  }

  // Changes the password. Every login ends, this browser's with the others, and this browser gets
  // a new one, so that a secret that has leaked is no use either: not for a request, and not for a
  // connection that someone else opened with it, which the server can't tell from this browser's
  // own. This browser's connections come back with the new login. The links in mails that are
  // still out are no use either, so that one asked for while someone else had the password can't
  // bind their address after it has been changed.
  async changePassword(
    ip: string,
    login: Login,
    current: string,
    password: string,
  ): Promise<AccountResult<{ secret: string }>> {
    const problem = checkPassword(password);
    if (problem) return refuse(problem);
    const confirmed = await this.#confirm(ip, login, current);
    if (!confirmed.ok) return confirmed;
    const hashed = await this.#hash(password);
    if (!hashed.ok) return hashed;
    const secret = newSecret();
    const hash = hashSecret(secret);
    const ended = this.store.transaction(() => {
      // Another request may have logged this browser out, or deleted the account, meanwhile.
      if (!this.sessions.delete(login.hash)) return null;
      this.store.setPassword(login.account.id, hashed.hash);
      const others = this.sessions.deleteForAccount(login.account.id);
      this.mailTokens.deleteForAccount(login.account.id, 'bind');
      this.mailTokens.deleteForAccount(login.account.id, 'reset');
      this.sessions.create(hash, login.account.id);
      return others;
    });
    if (ended === null) return refuse('not_logged_in');
    this.hooks.sessionsEnded([login.hash, ...ended]);
    return { ok: true, secret };
  }

  // Deletes the account and everything of it. Returns the file of its avatar, which may go too.
  async remove(ip: string, login: Login, password: string): Promise<AccountResult<{ avatar: string | null }>> {
    const confirmed = await this.#confirm(ip, login, password);
    if (!confirmed.ok) return confirmed;
    const id = login.account.id;
    const removed = this.store.transaction(() => {
      if (!this.#stillLoggedIn(login)) return null;
      const ended = this.sessions.deleteForAccount(id);
      const account = this.store.delete(id);
      return account ? { ended, account } : null;
    });
    if (!removed) return refuse('not_logged_in');
    this.hooks.sessionsEnded(removed.ended);
    this.hooks.accountDeleted(id);
    this.#release(removed.account.avatar);
    this.#log('account_deleted', { id });
    this.#deleted();
    return { ok: true, avatar: removed.account.avatar };
  }

  // Takes an avatar that the browser cropped and encoded, if it is one (avatars.ts), and makes it the
  // account's, in its rooms too. The one it had goes, unless another account shows the same.
  setAvatar(login: Login, bytes: Buffer): AccountResult<{ avatar: string }> {
    const { account } = login;
    if (account.avatarBanned) return refuse('avatar_banned');
    const key = String(account.id);
    if (!this.counters.avatars.allowed(key)) return refuse('avatar_limited');
    const kind = inspectAvatar(bytes);
    if (kind === null) return refuse('avatar_invalid');
    if (this.avatars.bytes() + bytes.length > this.#maxAvatarBytes) {
      if (!this.#avatarsFullLogged) this.#log('avatars_full', { limit: this.#maxAvatarBytes });
      this.#avatarsFullLogged = true;
      return refuse('avatars_full');
    }
    this.#avatarsFullLogged = false;
    this.counters.avatars.add(key);
    const file = this.avatars.save(bytes, kind);
    if (!this.store.byId(account.id)) {
      this.#release(file);
      return refuse('not_logged_in');
    }
    const previous = this.store.setAvatar(account.id, file);
    if (previous !== file) this.#release(previous);
    this.hooks.accountChanged(account.id);
    return { ok: true, avatar: `${AVATAR_PATH}${file}` };
  }

  // Back to the default avatar.
  removeAvatar(login: Login): AccountResult {
    this.#release(this.store.setAvatar(login.account.id, null));
    this.hooks.accountChanged(login.account.id);
    return { ok: true };
  }

  // The operator takes an account's avatar down, as for a picture that breaks the rules, and may bar
  // the account from uploading another (admin.ts). Returns the file that went, if there was one.
  takeDownAvatar(accountId: number, ban: boolean): string | null {
    const previous = this.store.setAvatar(accountId, null);
    if (ban) this.store.setAvatarBanned(accountId, true);
    this.#release(previous);
    this.hooks.accountChanged(accountId);
    return previous;
  }

  // Deletes the files that no account shows, as one left behind when the server stopped between
  // keeping a file and naming it in the database, and says how many.
  clearAvatars(): number {
    const shown = this.store.avatarFiles();
    const unused = this.avatars.names().filter((name) => !shown.has(name));
    for (const name of unused) this.avatars.remove(name);
    return unused.length;
  }

  // Deletes an avatar's file once no account shows it.
  #release(file: string | null): void {
    if (file !== null && this.store.avatarUsers(file) === 0) this.avatars.remove(file);
  }

  // Whether accounts have email on this server.
  get mailAvailable(): boolean {
    return this.#fingerprintKey !== null && this.#mail !== null;
  }

  // Makes sure that the fingerprints in the database were made with the key that the server has
  // now, which comes from the server's secret. A new secret makes a new key, against which the old
  // fingerprints can never match: an account would seem to have an address, and a forgotten password
  // could never be reset. So they go, with the links that were to bind an address, and every account
  // is without an address until its owner binds one again. The database keeps the fingerprint of a
  // fixed text, by which the change is told. Returns how many addresses were unbound, or null when
  // the server has no key, and nothing is touched.
  adoptFingerprintKey(): number | null {
    if (this.#fingerprintKey === null) return null;
    const check = fingerprint(this.#fingerprintKey, KEY_TEXT).toString('base64url');
    return this.store.transaction(() => {
      const known = this.settings.get(KEY_SETTING);
      if (known === check) return 0;
      let unbound = 0;
      if (known !== null) {
        unbound = this.store.unbindAll();
        this.mailTokens.deleteAll('bind');
      }
      this.settings.set(KEY_SETTING, check);
      return unbound;
    });
  }

  // Asks for a link that binds an address to the account, which takes effect once it is opened.
  // The password is asked for, since an address can reset the password: whoever has a login and
  // not the password must not be able to bind an address of their own. Whether or not another
  // account has the address, the answer is the same and the account has an address waiting to be
  // confirmed; only the mail isn't sent when another account has it, so that nobody learns from
  // any of it which addresses are bound. An address that this account has already is mailed to
  // as any other: that tells its owner nothing new.
  async bindEmail(
    ip: string,
    login: Login,
    rawEmail: string,
    password: string,
    language: Language,
  ): Promise<AccountResult> {
    if (!this.mailAvailable) return refuse('mail_unavailable');
    const email = normalizeEmail(rawEmail);
    if (email === null) return refuse('email_invalid');
    const { binds, mails } = this.counters;
    const account = String(login.account.id);
    if (!binds.allowed(account) || !mails.allowed(ip)) return refuse('email_limited');
    // The mail counts from here on, and is given back when the password is wrong.
    binds.add(account);
    mails.add(ip);
    const confirmed = await this.#confirm(ip, login, password);
    if (!confirmed.ok) {
      binds.refund(account);
      mails.refund(ip);
      return confirmed;
    }
    const address = fingerprint(this.#fingerprintKey as Buffer, email);
    const secret = newSecret();
    const owner = this.store.transaction(() => {
      if (!this.#stillLoggedIn(login)) return null;
      this.mailTokens.deleteForAccount(login.account.id, 'bind');
      this.mailTokens.create(hashSecret(secret), login.account.id, 'bind', address, MAIL_LINK_MS.bind);
      return this.store.byEmail(address)?.id ?? 'nobody';
    });
    if (owner === null) return refuse('not_logged_in');
    if (owner === 'nobody' || owner === login.account.id) this.#send('bind', email, secret, language);
    return { ok: true };
  }

  // Binds the address that the link was for, unless another account has bound it meanwhile. The
  // link works without a login: the mail may be opened on another device. The links that reset the
  // password, which went to the address the account had before, are used up with the other links
  // to bind an address: the address they went to is no longer the account's.
  confirmEmail(token: string): AccountResult {
    if (!isSecret(token)) return refuse('link_invalid');
    const hash = hashSecret(token);
    const bound = this.store.transaction(() => {
      const link = this.mailTokens.find(hash, 'bind');
      if (!link?.emailFp) return false;
      this.mailTokens.delete(hash);
      if (!this.store.setEmail(link.accountId, link.emailFp)) return false;
      this.mailTokens.deleteForAccount(link.accountId, 'bind');
      this.mailTokens.deleteForAccount(link.accountId, 'reset');
      return true;
    });
    return bound ? { ok: true } : refuse('link_invalid');
  }

  // Unbinds the address, and forgets one that waits for its link, and the links to reset the
  // password that went to the address. Asks for the password, since without an address a
  // forgotten password can't be reset.
  async unbindEmail(ip: string, login: Login, password: string): Promise<AccountResult> {
    const confirmed = await this.#confirm(ip, login, password);
    if (!confirmed.ok) return confirmed;
    const unbound = this.store.transaction(() => {
      if (!this.#stillLoggedIn(login)) return false;
      this.store.setEmail(login.account.id, null);
      this.mailTokens.deleteForAccount(login.account.id, 'bind');
      this.mailTokens.deleteForAccount(login.account.id, 'reset');
      return true;
    });
    return unbound ? { ok: true } : refuse('not_logged_in');
  }

  // Sends a link that resets the password to the address, if an account has it. The answer is the
  // same either way, and comes before anything is looked up, so that not even the time it takes
  // says whether an account has the address.
  forgotPassword(ip: string, rawEmail: string, language: Language): AccountResult {
    if (!this.mailAvailable) return refuse('mail_unavailable');
    const email = normalizeEmail(rawEmail);
    if (email === null) return refuse('email_invalid');
    const address = fingerprint(this.#fingerprintKey as Buffer, email);
    const key = address.toString('base64url');
    const { resets, mails } = this.counters;
    if (!resets.allowed(key) || !mails.allowed(ip)) return refuse('email_limited');
    resets.add(key);
    mails.add(ip);
    setImmediate(() => {
      try {
        const account = this.store.byEmail(address);
        if (!account) return;
        const secret = newSecret();
        this.mailTokens.create(hashSecret(secret), account.id, 'reset', null, MAIL_LINK_MS.reset);
        this.#send('reset', email, secret, language);
      } catch (error) {
        this.#log('error', { where: 'forgot', message: error instanceof Error ? error.message : String(error) });
      }
    });
    return { ok: true };
  }

  // Sets a new password with a link from a mail. The link works once: setting the password uses it
  // up, with every other link to reset this account's password, and logs the account out
  // everywhere. The browser that set it is logged in.
  async resetPassword(token: string, password: string): Promise<AccountResult<{ secret: string; accountId: number }>> {
    if (!isSecret(token)) return refuse('link_invalid');
    const problem = checkPassword(password);
    if (problem) return refuse(problem);
    const hash = hashSecret(token);
    if (!this.mailTokens.find(hash, 'reset')) return refuse('link_invalid');
    const hashed = await this.#hash(password);
    if (!hashed.ok) return hashed;
    const secret = newSecret();
    // The link may have been used, or the account deleted, while the password was being hashed.
    const reset = this.store.transaction(() => {
      const link = this.mailTokens.find(hash, 'reset');
      const account = link && this.store.byId(link.accountId);
      if (!account) return null;
      this.store.setPassword(account.id, hashed.hash);
      this.mailTokens.deleteForAccount(account.id, 'reset');
      this.mailTokens.deleteForAccount(account.id, 'bind');
      const ended = this.sessions.deleteForAccount(account.id);
      this.sessions.create(hashSecret(secret), account.id);
      return { account, ended };
    });
    if (!reset) return refuse('link_invalid');
    this.counters.forgive(reset.account.key, reset.account.id);
    this.hooks.sessionsEnded(reset.ended);
    this.#log('password_reset', { id: reset.account.id });
    return { ok: true, secret, accountId: reset.account.id };
  }

  // Hands a mail to the mailer, and logs how that went, without the address or the secret.
  #send(kind: MailKind, to: string, token: string, language: Language): void {
    this.#log('mail_requested', { kind });
    void (this.#mail as MailChannel).send({ v: 1, kind, to, token, language }).then((outcome) => {
      if (outcome !== 'sent') this.#log('mail_not_sent', { kind, outcome });
    });
  }

  // Deletes the logins and the links that have ended, and says how many of each.
  prune(): { sessions: number; links: number } {
    return { sessions: this.sessions.prune(), links: this.mailTokens.prune() };
  }

  recordsOf(login: Login): RecordsView {
    return this.records.view(login.account.id);
  }

  // Keeps a game on an account's record, as the game module described it, unless the database is
  // full. Says whether it was kept.
  record(accountId: number, record: NewRecord): boolean {
    if (this.#full()) return false;
    return this.store.byId(accountId) !== undefined && this.records.add(accountId, record);
  }

  // Keeps a match that has run its course on an account's record, with the title that it awarded,
  // in one transaction, unless the database is full. A match is kept, and its title awarded, once
  // for each account, however often this is called. Says whether the match was new.
  recordMatch(accountId: number, record: NewMatchRecord): boolean {
    if (this.#full() || this.store.byId(accountId) === undefined) return false;
    return this.store.transaction(() => {
      const added = this.records.addMatch(accountId, record);
      if (added && record.title) this.titles.award(accountId, record.title, record.matchId);
      return added;
    });
  }

  // Checks the password of the account that is logged in, for an action that asks for it. A wrong
  // one counts as a failed login, against the address and the account (limits.ts).
  async #confirm(ip: string, login: Login, password: string): Promise<AccountResult> {
    const key = confirmKey(login.account.id);
    if (typeof password !== 'string') return refuse('password_wrong');
    if (!this.counters.tryPassword(ip, key)) return refuse('login_limited');
    const verified = await this.#verify(password, login.account.password);
    if (!verified.ok) {
      this.counters.rightPassword(ip, key);
      return verified;
    }
    if (!verified.match) return refuse('password_wrong');
    this.counters.rightPassword(ip, key);
    return { ok: true };
  }

  // Whether the login that a request came with is still there, for the write that the request
  // asks for, after the wait for the password's hash: another request may have logged the browser
  // out, changed the password or deleted the account meanwhile. Every change of the password ends
  // every login, so a login that is still there was made with the password that is there now.
  #stillLoggedIn(login: Login): boolean {
    return this.store.byId(login.account.id) !== undefined && this.sessions.find(login.hash) !== null;
  }

  async #hash(password: string): Promise<AccountResult<{ hash: string }>> {
    try {
      return { ok: true, hash: await this.hasher.hash(password) };
    } catch (error) {
      if (error instanceof BusyError) return refuse('busy');
      throw error;
    }
  }

  async #verify(
    password: string,
    stored: string | null,
  ): Promise<AccountResult<{ match: boolean; outdated: boolean }>> {
    try {
      const { ok, outdated } = await this.hasher.verify(password, stored);
      return { ok: true, match: ok, outdated };
    } catch (error) {
      if (error instanceof BusyError) return refuse('busy');
      throw error;
    }
  }

  // Whether the database has grown past its limit, so that nothing new is kept.
  #full(): boolean {
    const full = databaseBytes(this.#db) > this.#maxDatabaseBytes;
    if (full && !this.#fullLogged) this.#log('storage_full', { limit: this.#maxDatabaseBytes });
    this.#fullLogged = full;
    return full;
  }
}

export const avatarUrl = (account: Pick<Account, 'avatar'>): string | null =>
  account.avatar === null ? null : `${AVATAR_PATH}${account.avatar}`;

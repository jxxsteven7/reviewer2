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
import { RecordStore, TitleStore, type NewRecord } from '../store/records';
import { MailTokenStore, SessionStore, type SessionLimits } from '../store/sessions';
import { fingerprint, normalizeEmail } from './email';
import { AccountCounters, DEFAULT_ACCOUNT_LIMITS, type AccountLimits } from './limits';
import type { MailChannel } from './mail';
import { BusyError, PasswordHasher } from './passwords';
import { hashSecret, isSecret, newSecret } from './tokens';

// What accounts can do (docs/architecture.md), whatever carries the request: http.ts in this
// directory reads the requests and the login cookie, and answers them; the socket layer asks who
// a connection is and records the games. Every method checks its limits before it does anything
// that costs, and every check that a write depends on is made again after the one thing that is
// awaited, the password's hash, inside the transaction that writes.

type Log = (event: string, fields?: Record<string, unknown>) => void;

export type AccountFailure = AccountError | 'bad_request' | 'rate_limited' | 'internal';
export type AccountResult<Data extends object = object> = ({ ok: true } & Data) | { ok: false; error: AccountFailure };

const refuse = (error: AccountFailure): { ok: false; error: AccountFailure } => ({ ok: false, error });

// What the socket layer must do when an account changes, which the HTTP side can't do itself.
export interface AccountHooks {
  // These logins have ended: the connections that came with them are no longer the account.
  sessionsEnded(hashes: readonly Uint8Array[]): void;
  // This browser's login was replaced by a new one, as when its password was changed.
  sessionReplaced(from: Uint8Array, to: Uint8Array): void;
  // The username or the avatar changed, which the rooms that the account is in show.
  accountChanged(accountId: number): void;
  // The account is gone, and with it its place in every room.
  accountDeleted(accountId: number): void;
}

const NO_HOOKS: AccountHooks = {
  sessionsEnded: () => {},
  sessionReplaced: () => {},
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
}

export class Accounts {
  readonly store: AccountStore;
  readonly sessions: SessionStore;
  readonly mailTokens: MailTokenStore;
  readonly records: RecordStore;
  readonly titles: TitleStore;
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
    this.store = new AccountStore(options.db, clock);
    this.sessions = new SessionStore(options.db, clock, options.sessionLimits);
    this.mailTokens = new MailTokenStore(options.db, clock);
    this.records = new RecordStore(options.db, clock);
    this.titles = new TitleStore(options.db, clock);
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
    const hashed = await this.#hash(password);
    if (!hashed.ok) return hashed;
    const secret = newSecret();
    const account = this.store.transaction(() => {
      const created = this.store.create(checked.username, key, hashed.hash);
      if (created) this.sessions.create(hashSecret(secret), created.id);
      return created;
    });
    // Someone else took the name while the password was being hashed.
    if (!account) return failed('username_taken');
    registrations.add(ip);
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
    if (!this.counters.mayTryPassword(ip, key)) return refuse('login_limited');
    const account = this.store.byKey(key);
    const verified = await this.#verify(password, account?.password ?? null);
    if (!verified.ok) return verified;
    // The account may have gone, or its password changed, while the password was being checked.
    const current = account === undefined ? undefined : this.store.byId(account.id);
    if (!verified.match || current === undefined || current.password !== account?.password) {
      this.counters.wrongPassword(ip, key);
      return refuse('login_failed');
    }
    if (verified.outdated) {
      const rehashed = await this.#hash(password);
      if (rehashed.ok) this.store.setPassword(current.id, rehashed.hash);
    }
    const secret = newSecret();
    const ended = this.store.transaction(() => {
      if (previous) this.sessions.delete(previous.hash);
      return this.sessions.create(hashSecret(secret), current.id);
    });
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

  // Changes the password. Every other browser is logged out, and this one gets a new secret, so
  // that a secret that has leaked is no use either.
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
      this.sessions.create(hash, login.account.id);
      return others;
    });
    if (ended === null) return refuse('not_logged_in');
    this.hooks.sessionReplaced(login.hash, hash);
    this.hooks.sessionsEnded(ended);
    return { ok: true, secret };
  }

  // Deletes the account and everything of it. Returns the file of its avatar, which may go too.
  async remove(ip: string, login: Login, password: string): Promise<AccountResult<{ avatar: string | null }>> {
    const confirmed = await this.#confirm(ip, login, password);
    if (!confirmed.ok) return confirmed;
    const id = login.account.id;
    const removed = this.store.transaction(() => {
      const ended = this.sessions.deleteForAccount(id);
      const account = this.store.delete(id);
      return account ? { ended, account } : null;
    });
    if (!removed) return refuse('not_logged_in');
    this.hooks.sessionsEnded(removed.ended);
    this.hooks.accountDeleted(id);
    this.#log('account_deleted', { id });
    this.#deleted();
    return { ok: true, avatar: removed.account.avatar };
  }

  // Whether accounts have email on this server.
  get mailAvailable(): boolean {
    return this.#fingerprintKey !== null && this.#mail !== null;
  }

  // Asks for a link that binds an address to the account, which takes effect once it is opened.
  // The password is asked for, since an address can reset the password: whoever has a login and
  // not the password must not be able to bind an address of their own. Whether or not another
  // account has the address, the answer is the same and the account has an address waiting to be
  // confirmed; only the mail isn't sent when another account has it, so that nobody learns from
  // any of it which addresses are bound.
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
    const confirmed = await this.#confirm(ip, login, password);
    if (!confirmed.ok) return confirmed;
    binds.add(account);
    mails.add(ip);
    const address = fingerprint(this.#fingerprintKey as Buffer, email);
    const secret = newSecret();
    const owner = this.store.transaction(() => {
      if (!this.store.byId(login.account.id)) return null;
      this.mailTokens.deleteForAccount(login.account.id, 'bind');
      this.mailTokens.create(hashSecret(secret), login.account.id, 'bind', address, MAIL_LINK_MS.bind);
      return this.store.byEmail(address) ?? 'nobody';
    });
    if (owner === null) return refuse('not_logged_in');
    if (owner === 'nobody') this.#send('bind', email, secret, language);
    return { ok: true };
  }

  // Binds the address that the link was for, unless another account has bound it meanwhile. The
  // link works without a login: the mail may be opened on another device.
  confirmEmail(token: string): AccountResult {
    if (!isSecret(token)) return refuse('link_invalid');
    const hash = hashSecret(token);
    const bound = this.store.transaction(() => {
      const link = this.mailTokens.find(hash, 'bind');
      if (!link?.emailFp) return false;
      this.mailTokens.delete(hash);
      if (!this.store.setEmail(link.accountId, link.emailFp)) return false;
      this.mailTokens.deleteForAccount(link.accountId, 'bind');
      return true;
    });
    return bound ? { ok: true } : refuse('link_invalid');
  }

  // Unbinds the address, and forgets one that waits for its link. Asks for the password, since
  // without an address a forgotten password can't be reset.
  async unbindEmail(ip: string, login: Login, password: string): Promise<AccountResult> {
    const confirmed = await this.#confirm(ip, login, password);
    if (!confirmed.ok) return confirmed;
    this.store.transaction(() => {
      this.store.setEmail(login.account.id, null);
      this.mailTokens.deleteForAccount(login.account.id, 'bind');
    });
    return { ok: true };
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
      const ended = this.sessions.deleteForAccount(account.id);
      this.sessions.create(hashSecret(secret), account.id);
      return { account, ended };
    });
    if (!reset) return refuse('link_invalid');
    this.counters.forgive(reset.account.key);
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

  // Checks the password of the account that is logged in, for an action that asks for it. A wrong
  // one counts as a failed login.
  async #confirm(ip: string, login: Login, password: string): Promise<AccountResult> {
    const { key } = login.account;
    if (typeof password !== 'string') return refuse('password_wrong');
    if (!this.counters.mayTryPassword(ip, key)) return refuse('login_limited');
    const verified = await this.#verify(password, login.account.password);
    if (!verified.ok) return verified;
    if (!verified.match) {
      this.counters.wrongPassword(ip, key);
      return refuse('password_wrong');
    }
    return { ok: true };
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

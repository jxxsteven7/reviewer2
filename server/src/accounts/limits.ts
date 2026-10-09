import { WindowCounter } from '../core/rateLimit';

// How much one address, one name and one account may ask of the account API
// (docs/architecture.md). The counts are kept in memory, on the server's clock that only runs
// forward, and start again when the server does.

export interface AccountLimits {
  // Per address and hour: accounts created, and attempts to create one that were refused, such as
  // for a name that is taken, which keeps anyone from trying names until one is free.
  registrationsPerHour: number;
  failedRegistrationsPerHour: number;
  // Wrong passwords, at a login or where an action asks for the password: per address and minute,
  // and per name in 15 minutes and in a day. At a login they are counted by the key of the name
  // typed, whether or not an account has it, so that being refused tells nobody whether it does.
  // Where an action of an account that is logged in asks for the password, they are counted by
  // the account instead (confirmKey), so that whoever types wrong passwords at the login page
  // doesn't keep the owner from changing theirs.
  loginFailuresPerMinute: number;
  loginFailuresPer15Minutes: number;
  loginFailuresPerDay: number;
  // Per address and minute: every request that changes something, whatever it is.
  requestsPerMinute: number;
  // Mails: per account and day, addresses to confirm; per address and hour, mails of either kind
  // that were asked for; per fingerprint of an address and hour, links to reset a password. The
  // last is counted whether or not an account has the address.
  bindsPerDay: number;
  mailsPerHour: number;
  resetsPerHour: number;
  // Per account and day: avatars uploaded.
  avatarsPerDay: number;
}

export const DEFAULT_ACCOUNT_LIMITS: Readonly<AccountLimits> = Object.freeze({
  registrationsPerHour: 5,
  failedRegistrationsPerHour: 30,
  loginFailuresPerMinute: 20,
  loginFailuresPer15Minutes: 10,
  loginFailuresPerDay: 50,
  requestsPerMinute: 60,
  bindsPerDay: 3,
  mailsPerHour: 10,
  resetsPerHour: 3,
  avatarsPerDay: 10,
});

// The key that an account's wrong passwords are counted under where an action asks for the
// password. A username's key has no line break (cleanName folds whitespace), so no name is this.
export const confirmKey = (accountId: number): string => `account\n${accountId}`;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export class AccountCounters {
  readonly registrations: WindowCounter;
  readonly failedRegistrations: WindowCounter;
  readonly failuresByAddress: WindowCounter;
  readonly failuresByName: WindowCounter;
  readonly dailyFailuresByName: WindowCounter;
  readonly requests: WindowCounter;
  readonly binds: WindowCounter;
  readonly mails: WindowCounter;
  readonly resets: WindowCounter;
  readonly avatars: WindowCounter;

  constructor(limits: AccountLimits, now: () => number) {
    this.registrations = new WindowCounter(limits.registrationsPerHour, HOUR, now);
    this.failedRegistrations = new WindowCounter(limits.failedRegistrationsPerHour, HOUR, now);
    this.failuresByAddress = new WindowCounter(limits.loginFailuresPerMinute, MINUTE, now);
    this.failuresByName = new WindowCounter(limits.loginFailuresPer15Minutes, 15 * MINUTE, now);
    this.dailyFailuresByName = new WindowCounter(limits.loginFailuresPerDay, DAY, now);
    this.requests = new WindowCounter(limits.requestsPerMinute, MINUTE, now);
    this.binds = new WindowCounter(limits.bindsPerDay, DAY, now);
    this.mails = new WindowCounter(limits.mailsPerHour, HOUR, now);
    this.resets = new WindowCounter(limits.resetsPerHour, HOUR, now);
    this.avatars = new WindowCounter(limits.avatarsPerDay, DAY, now);
  }

  // Takes one try at a password for this key from this address, or refuses it. The try counts as
  // a wrong password from here on, until rightPassword() says otherwise: the hash takes a while,
  // and tries that arrive together must not all pass the check before any is counted.
  tryPassword(ip: string, key: string): boolean {
    if (
      !this.failuresByAddress.allowed(ip) ||
      !this.failuresByName.allowed(key) ||
      !this.dailyFailuresByName.allowed(key)
    ) {
      return false;
    }
    this.failuresByAddress.add(ip);
    this.failuresByName.add(key);
    this.dailyFailuresByName.add(key);
    return true;
  }

  // The password was right after all: the try no longer counts.
  rightPassword(ip: string, key: string): void {
    this.failuresByAddress.refund(ip);
    this.failuresByName.refund(key);
    this.dailyFailuresByName.refund(key);
  }

  // A password that was reset clears what its name, and the account, had against them.
  forgive(nameKey: string, accountId: number): void {
    for (const key of [nameKey, confirmKey(accountId)]) {
      this.failuresByName.forget(key);
      this.dailyFailuresByName.forget(key);
    }
  }

  prune(): void {
    for (const counter of Object.values(this)) if (counter instanceof WindowCounter) counter.prune();
  }
}

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
  // and per name in 15 minutes and in a day. They are counted by the key of the name typed,
  // whether or not an account has it, so that being refused tells nobody whether it does.
  loginFailuresPerMinute: number;
  loginFailuresPer15Minutes: number;
  loginFailuresPerDay: number;
  // Per address and minute: every request that changes something, whatever it is.
  requestsPerMinute: number;
}

export const DEFAULT_ACCOUNT_LIMITS: Readonly<AccountLimits> = Object.freeze({
  registrationsPerHour: 5,
  failedRegistrationsPerHour: 30,
  loginFailuresPerMinute: 20,
  loginFailuresPer15Minutes: 10,
  loginFailuresPerDay: 50,
  requestsPerMinute: 60,
});

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

  constructor(limits: AccountLimits, now: () => number) {
    this.registrations = new WindowCounter(limits.registrationsPerHour, HOUR, now);
    this.failedRegistrations = new WindowCounter(limits.failedRegistrationsPerHour, HOUR, now);
    this.failuresByAddress = new WindowCounter(limits.loginFailuresPerMinute, MINUTE, now);
    this.failuresByName = new WindowCounter(limits.loginFailuresPer15Minutes, 15 * MINUTE, now);
    this.dailyFailuresByName = new WindowCounter(limits.loginFailuresPerDay, DAY, now);
    this.requests = new WindowCounter(limits.requestsPerMinute, MINUTE, now);
  }

  // Whether another password may be tried for this name from this address.
  mayTryPassword(ip: string, nameKey: string): boolean {
    return (
      this.failuresByAddress.allowed(ip) &&
      this.failuresByName.allowed(nameKey) &&
      this.dailyFailuresByName.allowed(nameKey)
    );
  }

  wrongPassword(ip: string, nameKey: string): void {
    this.failuresByAddress.add(ip);
    this.failuresByName.add(nameKey);
    this.dailyFailuresByName.add(nameKey);
  }

  // A password that was reset clears what its name had against it.
  forgive(nameKey: string): void {
    this.failuresByName.forget(nameKey);
    this.dailyFailuresByName.forget(nameKey);
  }

  prune(): void {
    for (const counter of Object.values(this)) if (counter instanceof WindowCounter) counter.prune();
  }
}

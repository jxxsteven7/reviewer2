import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { MailKind } from '@reviewer2/shared';

// How many mails the mailer sends: at most 50 in any 24 hours, of which at most 40 confirm an
// address, so that at least 10 are left to reset passwords whatever anyone does with new accounts
// (docs/architecture.md). Every mail that is handed to the mail service counts, whether or not it
// arrives. The count is kept in a file, so that a restart doesn't start it again; the clock is the
// system's.

export interface QuotaLimits {
  total: number;
  bind: number;
  windowMs: number;
}

export const DEFAULT_QUOTA: QuotaLimits = { total: 50, bind: 40, windowMs: 24 * 60 * 60_000 };

interface Sent {
  at: number;
  kind: MailKind;
}

const isSent = (value: unknown): value is Sent =>
  typeof value === 'object' &&
  value !== null &&
  Number.isFinite((value as Sent).at) &&
  ((value as Sent).kind === 'bind' || (value as Sent).kind === 'reset');

export class Quota {
  #sent: Sent[] = [];

  // `file` keeps the count, or null keeps it in memory, which only the print transport may do.
  // A file that can't be read stops the mailer, rather than start the count again.
  constructor(
    private readonly file: string | null,
    private readonly now: () => number = () => Date.now(),
    readonly limits: QuotaLimits = DEFAULT_QUOTA,
  ) {
    if (file === null || !existsSync(file)) return;
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(value) || !value.every(isSent)) throw new Error(`${file} does not hold a count of mails`);
    this.#sent = value;
  }

  // Counts a mail, and says whether it may be sent.
  take(kind: MailKind): boolean {
    const now = this.now();
    // A mail sent "in the future", before the system's clock was set back, counts until then.
    this.#sent = this.#sent.filter(({ at }) => now - at < this.limits.windowMs);
    if (this.#sent.length >= this.limits.total) return false;
    if (kind === 'bind' && this.#sent.filter((sent) => sent.kind === 'bind').length >= this.limits.bind) return false;
    this.#sent.push({ at: now, kind });
    this.#save();
    return true;
  }

  #save(): void {
    if (this.file === null) return;
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.#sent));
    renameSync(temporary, this.file);
  }
}

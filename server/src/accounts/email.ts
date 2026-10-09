import { createHmac, hkdfSync } from 'node:crypto';
import { domainToASCII } from 'node:url';
import { MAIL_ADDRESS, MAX_EMAIL_LENGTH } from '@reviewer2/shared';

// Email addresses are never kept (docs/architecture.md). An account keeps the fingerprint of its
// address instead: an HMAC-SHA256 of the address, normalized, with a key that comes from the
// server's secret, which is not in the database. Whoever reads the database can't tell from it
// which addresses are there, not even by trying a list of them.

// The secret must be long enough not to be guessed: 32 bytes of randomness in base64 are 44
// characters.
export const MIN_SECRET_LENGTH = 32;

// The key for fingerprints, from the server's secret. Other uses of the secret, should there be
// any, get keys of their own from other labels.
export const fingerprintKey = (secret: string): Buffer =>
  Buffer.from(hkdfSync('sha256', secret, 'reviewer2', 'email fingerprint', 32));

// An address as it is fingerprinted and mailed to, or null when it can't be one: normalized with
// NFKC and in lower case, with the domain in punycode, and in the form the mailer takes
// (shared/src/mail.ts). Mail servers treat the local part as the same in any case, and so does
// this; "+tags" and dots are left as they are, since they mean different addresses at most
// providers.
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 4 * MAX_EMAIL_LENGTH) return null;
  const email = raw.normalize('NFKC').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const domain = domainToASCII(email.slice(at + 1));
  const address = `${email.slice(0, at)}@${domain}`;
  return domain !== '' && address.length <= MAX_EMAIL_LENGTH && MAIL_ADDRESS.test(address) ? address : null;
}

export const fingerprint = (key: Buffer, email: string): Buffer => createHmac('sha256', key).update(email).digest();

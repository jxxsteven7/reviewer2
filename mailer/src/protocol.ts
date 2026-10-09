import { LANGUAGES, MAIL_ADDRESS, MAIL_KINDS, MAX_EMAIL_LENGTH, type MailRequest } from '@reviewer2/shared';

// Reads a request from the game server (shared/src/mail.ts), or refuses it. The mailer trusts the
// game server no further than this: a request has exactly the five fields, each exactly what it
// should be, or nothing is sent.

const FIELDS = ['kind', 'language', 'to', 'token', 'v'];
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function parseRequest(line: string): MailRequest | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (Object.keys(request).sort().join() !== FIELDS.join()) return null;
  const { v, kind, to, token, language } = request;
  if (v !== 1) return null;
  if (!MAIL_KINDS.includes(kind as MailRequest['kind'])) return null;
  if (!LANGUAGES.includes(language as MailRequest['language'])) return null;
  if (typeof token !== 'string' || !TOKEN.test(token)) return null;
  if (typeof to !== 'string' || to.length > MAX_EMAIL_LENGTH || !MAIL_ADDRESS.test(to)) return null;
  return request as unknown as MailRequest;
}

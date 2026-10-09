import type { Language } from './language';

// What the game server asks the mailer for (docs/architecture.md). The game server can't reach the
// internet, so a separate program, the mailer, sends the mails, and only it holds the key of the
// mail service. It writes nothing but these two mails, from its own templates, in Chinese or in
// English: one that confirms an address for an account, and one that resets a password. All the
// game server can choose is which of them, to whom, with which secret and in which language; the
// mailer builds the link itself, from its own address.

export const MAIL_KINDS = ['bind', 'reset'] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

// One request, on one line of JSON, over a Unix socket. The mailer answers with one line too.
export interface MailRequest {
  v: 1;
  kind: MailKind;
  to: string;
  token: string;
  language: Language;
}

export type MailReply = { ok: true } | { ok: false; error: 'quota' | 'bad_request' | 'failed' };

// Where each link leads: a page of the site, with the secret after a "#", so that it never goes to
// a server, a proxy or a log as part of an address. The page reads it and sends it in a request.
export const MAIL_PAGES: Record<MailKind, string> = {
  bind: '/account/confirm',
  reset: '/account/reset',
};

// How long the links work.
export const MAIL_LINK_MS: Record<MailKind, number> = {
  bind: 24 * 60 * 60_000,
  reset: 30 * 60_000,
};

// An address as the game server sends it and the mailer takes it: ASCII, with the domain in
// punycode, and nothing that a mail header could read as a second address or a name, such as
// spaces, commas, angle brackets or quotes.
export const MAIL_ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})+$/;

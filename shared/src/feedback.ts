import { isReservedName } from './accounts';
import type { Language } from './language';
import { cleanName } from './names';
import { cleanLine, showsSomething, textLength } from './text';

// Feedback from players to the author (docs/architecture.md). The client runs these rules while a
// player types, and the server runs them again before it keeps what was sent. What shows and what
// doesn't is decided in text.ts, which nicknames and the chat share.

// What the feedback is about: an idea, a game for the project to make next, a bug, or the word
// lists. The database doesn't fix them (store/migrations.ts on the server), so a kind is added here
// and in the locale files alone, and the schema refuses any other.
export const FEEDBACK_KINDS = ['idea', 'game', 'bug', 'words'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

// The page it was sent from. A room's code is never sent along.
export const FEEDBACK_PAGES = ['home', 'room'] as const;
export type FeedbackPage = (typeof FEEDBACK_PAGES)[number];

// The longest feedback and the longest contact, in the characters that a reader sees once they
// have been cleaned, and the longest texts that are looked at at all, in UTF-16 units as they
// arrive. Cleaning never makes a text longer, so these also bound what is kept. A Chinese
// character is one unit and three bytes, so the longest feedback with the longest contact still
// fits in a message of 16 KB.
export const MAX_FEEDBACK_LENGTH = 1000;
export const MAX_FEEDBACK_INPUT = 4000;
export const MAX_CONTACT_LENGTH = 100;
export const MAX_CONTACT_INPUT = 400;
// The longest link for the acknowledgments as it is kept, and the longest that is looked at.
export const MAX_LINK_LENGTH = 200;
export const MAX_LINK_INPUT = 400;
// The note that may come with a report of a player (room:report), and the longest that is looked at.
export const MAX_REPORT_LENGTH = 300;
export const MAX_REPORT_INPUT = 1200;

// What the server may answer meta:feedback with besides the codes that every message can get.
// `feedback_limited` is the limit per address; `feedback_full` means that the server takes no more
// feedback for now.
export const FEEDBACK_ERRORS = [
  'feedback_empty',
  'feedback_too_long',
  'contact_too_long',
  'credit_invalid',
  'credit_reserved',
  'credit_link_invalid',
  'credit_link_too_long',
  'feedback_limited',
  'feedback_full',
] as const;
export type FeedbackError = (typeof FEEDBACK_ERRORS)[number];

// What the server may answer room:report with: the room isn't public, the note is too long, the
// account has sent its reports for the hour, or the server takes no more for now.
export const REPORT_ERRORS = ['not_public', 'report_too_long', 'report_limited', 'report_full'] as const;
export type ReportError = (typeof REPORT_ERRORS)[number];

// What the client sends with meta:feedback: what the player wrote, and what comes along by itself.
// `credit` is the name to list in the acknowledgments should the feedback be adopted
// (acknowledgments.ts), and `link` a page about them that goes with it. `publicIssue` says that the
// player agrees to the feedback being published as a GitHub issue, with the name if there is one
// and never the contact. `version` is the build of the page, which may be older than the server's.
export interface FeedbackMessage {
  kind: FeedbackKind;
  text: string;
  contact?: string;
  credit?: string;
  link?: string;
  publicIssue?: boolean;
  version: string;
  language: Language;
  page: FeedbackPage;
}

// Feedback as it is kept. Unlike a chat message it keeps its line breaks, because the steps that
// lead to a bug are easier to follow one to a line. Each line is cleaned on its own, blank lines
// at the start and the end are dropped, and a run of blank lines becomes one.
export function cleanFeedback(text: string): string {
  const lines = text.split(/\r\n?|\n/).map(cleanLine);
  const kept: string[] = [];
  for (const line of lines) {
    if (line === '' && (kept.length === 0 || kept.at(-1) === '')) continue;
    kept.push(line);
  }
  if (kept.at(-1) === '') kept.pop();
  return kept.join('\n');
}

export interface FeedbackCheck {
  // The feedback as it is kept and shown.
  text: string;
  problem: 'feedback_empty' | 'feedback_too_long' | null;
}

export function checkFeedback(text: string): FeedbackCheck {
  // The types promise a string, but the message comes from a player.
  if (typeof text !== 'string') return { text: '', problem: 'feedback_empty' };
  if (text.length > MAX_FEEDBACK_INPUT) return { text: '', problem: 'feedback_too_long' };
  const cleaned = cleanFeedback(text);
  if (!showsSomething(cleaned)) return { text: '', problem: 'feedback_empty' };
  if (textLength(cleaned) > MAX_FEEDBACK_LENGTH) return { text: cleaned, problem: 'feedback_too_long' };
  return { text: cleaned, problem: null };
}

export interface ContactCheck {
  // The contact as it is kept, on one line, or null when there is none.
  contact: string | null;
  problem: 'contact_too_long' | null;
}

// The contact is optional: one that shows nothing once it is cleaned is no contact at all.
export function checkContact(text: string | undefined): ContactCheck {
  if (typeof text !== 'string') return { contact: null, problem: null };
  if (text.length > MAX_CONTACT_INPUT) return { contact: null, problem: 'contact_too_long' };
  const cleaned = cleanLine(text);
  if (!showsSomething(cleaned)) return { contact: null, problem: null };
  if (textLength(cleaned) > MAX_CONTACT_LENGTH) return { contact: cleaned, problem: 'contact_too_long' };
  return { contact: cleaned, problem: null };
}

export interface CreditCheck {
  // The name as it is kept and shown, or null when none was given.
  credit: string | null;
  problem: 'credit_invalid' | 'credit_reserved' | null;
}

// The name for the acknowledgments is optional, and follows the rules of a nickname (names.ts):
// it is shown beside other names, so it is refused, not cleaned, when it holds something hidden or
// is longer than 16 characters, and it may not be a reserved name (accounts.ts), which nobody may
// pass for. One that shows nothing is none.
export function checkCredit(text: string | undefined): CreditCheck {
  if (typeof text !== 'string' || !showsSomething(text)) return { credit: null, problem: null };
  const credit = cleanName(text);
  if (credit === null) return { credit: null, problem: 'credit_invalid' };
  if (isReservedName(credit)) return { credit: null, problem: 'credit_reserved' };
  return { credit, problem: null };
}

export interface LinkCheck {
  // The link as it is kept, or null when there is none.
  link: string | null;
  problem: 'credit_link_invalid' | 'credit_link_too_long' | null;
}

// A web address of https: a host name with a dot in it, a port perhaps, and then nothing but
// printable ASCII. No user name may come before the host, so email addresses are refused, whether
// as mailto: or as https://name@host, and so are hosts in other scripts than Latin, which the
// operator could take for others; a browser copies a link with its path already percent-encoded.
// Nor may it hold a backslash, which a browser reads as / in a path, so that the link would lead
// elsewhere than it says, and which a browser never copies there.
const LINK =
  /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?(?::\d{1,5})?(?:[/?#][!-[\]-~]*)?$/i;
// An HTML character reference, such as &amp;, which Markdown would turn into the character, so
// that ACKNOWLEDGMENTS.md on GitHub and the home page would link to different addresses.
const REFERENCE = /&#?\w+;/;
// What Markdown reads as markup in a link, which is kept percent-encoded; a browser reads it the
// same, and a link with a parenthesis, as Wikipedia's, is common enough not to be refused.
const LINK_MARKUP = /[()]/g;

// A web address that a player gives of themselves, as it is kept, or null for none, or why it
// can't be one: the link that may go with the name for the acknowledgments, and the link on a
// public profile (accounts.ts) take the same rules. One that is only spaces is none.
export interface WebLinkCheck {
  link: string | null;
  problem: 'web_link_invalid' | 'web_link_too_long' | null;
}

export function checkWebLink(text: string | undefined): WebLinkCheck {
  if (typeof text !== 'string') return { link: null, problem: null };
  if (text.length > MAX_LINK_INPUT) return { link: null, problem: 'web_link_too_long' };
  const typed = text.trim();
  if (typed === '') return { link: null, problem: null };
  if (!LINK.test(typed) || REFERENCE.test(typed)) return { link: null, problem: 'web_link_invalid' };
  const link = typed.replace(LINK_MARKUP, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  if (link.length > MAX_LINK_LENGTH) return { link: null, problem: 'web_link_too_long' };
  return { link, problem: null };
}

// The link that may go with the name for the acknowledgments, to a page about the player, such as
// a homepage or a profile on GitHub, ORCID or Google Scholar. It goes with a name only, and is
// dropped without one. ACKNOWLEDGMENTS.md takes links by the same rules, as they are kept here
// (acknowledgments.ts).
export function checkLink(text: string | undefined, credit: string | null): LinkCheck {
  if (credit === null) return { link: null, problem: null };
  const { link, problem } = checkWebLink(text);
  if (problem === 'web_link_invalid') return { link, problem: 'credit_link_invalid' };
  if (problem === 'web_link_too_long') return { link, problem: 'credit_link_too_long' };
  return { link, problem: null };
}

export function checkReport(text: string | undefined): { text: string | null; problem: 'report_too_long' | null } {
  if (typeof text !== 'string') return { text: null, problem: null };
  if (text.length > MAX_REPORT_INPUT) return { text: null, problem: 'report_too_long' };
  const cleaned = cleanFeedback(text);
  if (!showsSomething(cleaned)) return { text: null, problem: null };
  if (textLength(cleaned) > MAX_REPORT_LENGTH) return { text: cleaned, problem: 'report_too_long' };
  return { text: cleaned, problem: null };
}

import type { FeedbackKind } from './feedback';
import { cleanLine, showsSomething, textLength } from './text';

// Feedback contributions (docs/architecture.md#feedback-contributions): feedback that the operator
// adopted, which the home page lists and an account's page counts. They are the rows of the
// feedback table that were adopted, and nothing else: a contribution is the feedback, its kind is
// the feedback's kind, and the name is the one the player left with it. No file lists them; the
// GitHub issue that every adopted piece of feedback becomes is their record there.

// Where the home page asks for them, which the server answers with { ok: true, contributions }.
export const CONTRIBUTIONS_API = '/api/contributions';

// The repository, whose issues a contribution links to.
export const REPOSITORY_URL = 'https://github.com/jxxsteven7/reviewer2';

// The longest description of what a player contributed, in either language, in the characters
// that a reader sees, and the longest that is looked at.
export const MAX_SUMMARY_LENGTH = 100;
export const MAX_SUMMARY_INPUT = 400;

// What the operator writes, when adopting feedback, of what the player contributed: the idea, the
// bug or the words, rather than what was made of it, in both languages of the page.
export interface ContributionSummary {
  zh: string;
  en: string;
}

// One contribution as anyone sees it: the kind of feedback; who it is from: for feedback signed
// with an account (`linkProfile`, feedback.ts), the account as it is now, its username, the
// handle of its public profile and the address of its avatar, or null for the default one, which
// the page draws from the name, or once the account is gone, `deleted` and nothing else; for a
// guest, the name they left; or no name, for an anonymous player; what they contributed, or null
// until the operator writes it; the GitHub issue it became; and the month it was adopted, YYYY-MM
// in UTC. Never the text or the contact, nor the account of a contribution that wasn't signed
// with it.
export interface Contribution {
  kind: FeedbackKind;
  name: string | null;
  profile: string | null;
  avatar: string | null;
  deleted: boolean;
  summary: ContributionSummary | null;
  issue: number;
  month: string;
}

// How many contributions of each kind an account has, those without a name included, as its page
// shows them.
export interface ContributionCount {
  kind: FeedbackKind;
  count: number;
}

export interface SummaryCheck {
  // The sentence as it is kept, on one line, or null when none was given.
  summary: string | null;
  problem: 'summary_missing' | 'summary_too_long' | null;
}

// One sentence of a summary, cleaned as a bio is (accounts.ts): one line, without hidden
// characters, and shown as plain text.
export function checkSummary(text: string | undefined): SummaryCheck {
  if (typeof text !== 'string') return { summary: null, problem: 'summary_missing' };
  if (text.length > MAX_SUMMARY_INPUT) return { summary: null, problem: 'summary_too_long' };
  const cleaned = cleanLine(text);
  if (!showsSomething(cleaned)) return { summary: null, problem: 'summary_missing' };
  if (textLength(cleaned) > MAX_SUMMARY_LENGTH) return { summary: cleaned, problem: 'summary_too_long' };
  return { summary: cleaned, problem: null };
}

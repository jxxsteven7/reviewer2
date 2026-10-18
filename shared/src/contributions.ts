import { FEEDBACK_KINDS, type FeedbackKind } from './feedback';
import { cleanLine, showsSomething, textLength } from './text';

// The contributions (docs/architecture.md#feedback-contributions): what players and developers
// gave the project and the operator adopted, which the home page lists and an account's page
// counts. They come from two places, and nothing else: the rows of the feedback table that were
// adopted, which players sent through the site, and the GitHub issues and security advisories
// that the operator adopted, which developers opened on GitHub. A contribution is the feedback or
// the issue, its kind is the feedback's kind or the issue's label, and the name is the one the
// player left with it or the GitHub username of the issue's author. No file lists them; the GitHub
// issue that every contribution is, or became, is their record there.

// Where the home page asks for them, which the server answers with { ok: true, contributions }.
export const CONTRIBUTIONS_API = '/api/contributions';

// The repository, whose issues and advisories a contribution links to, and GitHub itself, where
// the page of an issue's author is, at GITHUB_URL/<username>.
export const REPOSITORY_URL = 'https://github.com/jxxsteven7/reviewer2';
export const GITHUB_URL = 'https://github.com';

// What a contribution is about: the kinds of feedback, and the code, which players don't see and
// which only an issue on GitHub is about. The database doesn't fix them, as it doesn't fix the
// kinds of feedback, so a kind is added here and in the locale files alone.
export const CONTRIBUTION_KINDS = [...FEEDBACK_KINDS, 'code'] as const;
export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];

// Where a contribution came from: the site's feedback form, or GitHub.
export type ContributionSource = 'site' | 'github';

// A GitHub username, as GitHub allows them: letters, digits and single hyphens between them, at
// most 39 characters; and the number of a GitHub security advisory, GHSA- and three groups of four
// from GitHub's own alphabet.
export const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
export const GITHUB_ADVISORY = /^GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}$/;

// The longest description of what a player contributed, in either language, in the characters
// that a reader sees, and the longest that is looked at.
export const MAX_SUMMARY_LENGTH = 100;
export const MAX_SUMMARY_INPUT = 400;

// What the operator writes, when adopting a contribution, of what the player contributed: the
// idea, the bug or the words, rather than what was made of it, in both languages of the page.
export interface ContributionSummary {
  zh: string;
  en: string;
}

// One contribution as anyone sees it: its kind; where it came from; who it is from: for feedback
// signed with an account (`linkProfile`, feedback.ts), the account as it is now, its username, the
// handle of its public profile and the address of its avatar, or null for the default one, which
// the page draws from the name, or once the account is gone, `deleted` and nothing else; for a
// guest, the name they left; for an issue on GitHub whose author asked to be named, their GitHub
// username, which the page links to their GitHub page, with no profile or avatar of the site's; or
// no name, for an anonymous player; what they contributed, or null until the operator writes it;
// the GitHub issue it is or became, or, for a security problem reported privately, the advisory
// that was published once it was fixed; and the month it was adopted, YYYY-MM in UTC. Never the
// text or the contact, nor the account of a contribution that wasn't signed with it, nor the
// GitHub account of one whose author asked to stay anonymous.
export interface Contribution {
  kind: ContributionKind;
  source: ContributionSource;
  name: string | null;
  profile: string | null;
  avatar: string | null;
  deleted: boolean;
  summary: ContributionSummary | null;
  issue: number | null;
  advisory: string | null;
  month: string;
}

// How many contributions of each kind an account has, those without a name included, as its page
// shows them: the feedback the player sent from the site while logged in, which alone counts for
// an account.
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

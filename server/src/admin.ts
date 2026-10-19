import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  checkSummary,
  cleanName,
  CONTRIBUTION_KINDS,
  escapeName,
  formatCode,
  GITHUB_ADVISORY,
  GITHUB_LOGIN,
  GITHUB_URL,
  isGuestName,
  MAX_SUMMARY_LENGTH,
  REPOSITORY_URL,
  usernameKey,
  type ContributionKind,
  type ContributionSummary,
  type FeedbackKind,
} from '@reviewer2/shared';
import { AVATAR_DIR, DirectoryAvatars } from './accounts/avatars';
import { Accounts } from './accounts/service';
import { loadConfig } from './config';
import { GAMES } from './games';
import { AccountStore } from './store/accounts';
import { checkData } from './store/check';
import { ContributionStore, type GithubContribution, type GithubRef } from './store/contributions';
import { BUSY_TIMEOUT_MS, DATABASE_FILE, schemaVersion } from './store/database';
import { FeedbackStore, type Feedback, type FeedbackView, type Report } from './store/feedback';
import { MIGRATIONS } from './store/migrations';
import { describeBrowser } from './userAgent';

// The operator's commands (docs/development.md), which run beside the server on its data:
//
//   node server/dist/admin.cjs avatar remove <username> [--ban]
//   node server/dist/admin.cjs avatar allow <username>
//   node server/dist/admin.cjs profile clear <username> [--ban]
//   node server/dist/admin.cjs profile allow <username>
//   node server/dist/admin.cjs profile list
//   node server/dist/admin.cjs accounts [--json]
//   node server/dist/admin.cjs accounts bar <username>
//   node server/dist/admin.cjs accounts unbar <username>
//   node server/dist/admin.cjs agents allow <username>
//   node server/dist/admin.cjs agents deny <username>
//   node server/dist/admin.cjs agents list
//   node server/dist/admin.cjs feedback list [--status <view>] [--json]
//   node server/dist/admin.cjs feedback adopt <id> --zh <sentence> --en <sentence>
//   node server/dist/admin.cjs feedback describe <id> --zh <sentence> --en <sentence>
//   node server/dist/admin.cjs feedback draft <id> [--json]
//   node server/dist/admin.cjs feedback issue <id> <number>|--clear
//   node server/dist/admin.cjs feedback resolve <id> <pr>|--clear
//   node server/dist/admin.cjs feedback close <id>
//   node server/dist/admin.cjs feedback reopen <id>
//   node server/dist/admin.cjs feedback delete <id>
//   node server/dist/admin.cjs feedback restore <id>
//   node server/dist/admin.cjs feedback trash
//   node server/dist/admin.cjs github adopt <issue>|--advisory <GHSA> --kind <kind> --login <username> --id <number>
//                                          [--anonymous] --zh <sentence> --en <sentence>
//   node server/dist/admin.cjs github describe <issue>|--advisory <GHSA> --zh <sentence> --en <sentence>
//   node server/dist/admin.cjs github anonymous <issue>|--advisory <GHSA>
//   node server/dist/admin.cjs github forget <issue>|--advisory <GHSA>
//   node server/dist/admin.cjs github list
//   node server/dist/admin.cjs reports list
//   node server/dist/admin.cjs data check
//
// adminCli.ts runs this, as index.ts runs main.ts.
//
// `avatar remove` takes an account's avatar down, as for a picture that breaks the rules, and with
// --ban bars the account from uploading another; `avatar allow` lifts that. `profile clear` does
// the same for the link and the bio on an account's public profile
// (docs/architecture.md#public-profiles), `profile allow` lifts the bar, and `profile list` shows
// every profile with a link or a bio, for the operator to look over.
//
// `feedback list` shows the feedback that players sent, all of it or the feedback of one status,
// the open feedback by default, the newest first: each piece with what became of it, who it is
// from, the contact while it is kept, the text, and the browser of a bug, for people to read, or as
// JSON for scripts. `feedback draft` writes the title and the body of the GitHub issue for a piece
// of feedback, from a template, with the player's text and name alone: the operator creates the
// issue from them on a machine that reaches GitHub, which the server needn't, and then records its
// number with `feedback issue`. The other `feedback` commands are the operator's notes on what
// became of the feedback, which `feedback list` shows (docs/architecture.md#feedback) and which
// only these commands change: `issue` records the GitHub issue it was published as; `resolve` the
// pull request that resolved it; `adopt` adopts it, which lists it among the feedback contributions
// on the home page at once (docs/architecture.md#feedback-contributions), by the account that
// signed it as the account is now, or as a deleted player once it is gone, by a guest's name, or as
// anonymous, counted for the account the player was logged in to, if any, with a sentence in each
// language on what they contributed, and says when a guest's name is an account's username. Only
// feedback that is a GitHub issue may be adopted, and it keeps one; closed feedback is reopened
// first. `describe` writes those sentences again; `close` and `reopen` record whether it was closed
// without being adopted, which adopted feedback can't be; `delete` puts it in the trash, from which
// `restore` takes it back and the server deletes it for good after 30 days, and `trash` lists what
// is there. Feedback that was adopted can't be deleted, since the home page lists it, nor can
// feedback that is an issue, which is public and is closed instead. Nothing changes what a player
// sent, or deletes reports: those are archives (docs/architecture.md#feedback).
//
// The `github` commands are the contributions from GitHub
// (docs/architecture.md#feedback-contributions): `github adopt` adopts an issue that a developer
// opened on GitHub, or, for a security problem reported privately, the advisory published once it
// was fixed, which lists it on the home page at once beside the adopted feedback, by the author's
// GitHub username, linked to their GitHub page, or as an anonymous player with --anonymous, as the
// author chose on the form, with a sentence in each language on what they contributed, and keeps
// the username and the id of the author's GitHub account as they are then: the operator reads them
// from GitHub, which the server never talks to. An issue that a player's feedback was published as
// is adopted as feedback, never here. `github describe` writes the sentences again; `github
// anonymous` lists the author anonymously from then on, at their request; `github forget` also
// drops their username and id, at their request, so that nothing names them any more; `github
// list` shows every contribution from GitHub. No command deletes one.
//
// `accounts` prints statistics of the accounts, counted as AccountStore says (store/accounts.ts),
// and never what the database keeps in place of passwords, email addresses and logins; `accounts
// bar` keeps an account out of public rooms, as for a player others reported, and `accounts unbar`
// lets it back in. `reports list` shows the latest reports that players sent of each other, and
// says when the account reported has been deleted since, whose username may be someone else's by
// now. `data check` holds every row against the rules that the code takes for granted of the data
// (store/check.ts, docs/rules/constraints.md#data), and prints each rule broken with the rows that
// break it, by id alone, or that every check passed; it exits with 1 when any is broken.
// `accounts`, `feedback list`, `feedback draft`, `trash`, `github list`, `reports list`, `profile
// list` and `data check` only read.
// DATA_DIR names the server's data, as it does for the server. The database is opened as it is,
// never migrated, and the server may go on running meanwhile.

const USAGE = [
  'usage: admin.cjs <command>, one of',
  '  avatar remove <username> [--ban]',
  '  avatar allow <username>',
  '  profile clear <username> [--ban]',
  '  profile allow <username>',
  '  profile list',
  '  accounts [--json]',
  '  accounts bar <username>',
  '  accounts unbar <username>',
  '  agents allow <username>',
  '  agents deny <username>',
  '  agents list',
  '  feedback list [--status <view>] [--json]',
  '  feedback adopt <id> --zh <sentence> --en <sentence>',
  '  feedback describe <id> --zh <sentence> --en <sentence>',
  '  feedback draft <id> [--json]',
  '  feedback issue <id> <number>|--clear',
  '  feedback resolve <id> <pr>|--clear',
  '  feedback close <id>',
  '  feedback reopen <id>',
  '  feedback delete <id>',
  '  feedback restore <id>',
  '  feedback trash',
  '  github adopt <issue>|--advisory <GHSA> --kind <kind> --login <username> --id <number> [--anonymous]',
  '               --zh <sentence> --en <sentence>',
  '  github describe <issue>|--advisory <GHSA> --zh <sentence> --en <sentence>',
  '  github anonymous <issue>|--advisory <GHSA>',
  '  github forget <issue>|--advisory <GHSA>',
  '  github list',
  '  reports list',
  '  data check',
].join('\n');

const ALONE = ['ban', 'json', 'anonymous'] as const;
const VALUED = ['zh', 'en', 'kind', 'login', 'id', 'advisory', 'status'] as const;
type Flags = Partial<Record<(typeof ALONE)[number], true> & Record<(typeof VALUED)[number], string>>;

// The words of a command and its flags: --ban, --json and --anonymous stand alone, and the others
// take a value. Anything else is a word, even when it begins with --, as a name may. Null for a
// flag that has no value.
function parse(args: readonly string[]): { words: string[]; flags: Flags } | null {
  const words: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    const name = arg.slice(2);
    if (arg.startsWith('--') && (ALONE as readonly string[]).includes(name)) {
      flags[name as (typeof ALONE)[number]] = true;
    } else if (arg.startsWith('--') && (VALUED as readonly string[]).includes(name)) {
      if (i + 1 >= args.length) return null;
      flags[name as (typeof VALUED)[number]] = args[(i += 1)] as string;
    } else {
      words.push(arg);
    }
  }
  return { words, flags };
}

interface Data {
  db: DatabaseSync;
  dataDir: string;
  accounts: Accounts;
  feedback: FeedbackStore;
  contributions: ContributionStore;
}

type Print = (line: string) => void;

interface Command {
  // How many words follow the one or two that name it, or the counts that will do.
  words: number | readonly number[];
  flags: readonly (keyof Flags)[];
  // Only reads, so that the connection refuses to write (admin()), and the command can't by mistake.
  readOnly?: true;
  run(data: Data, words: string[], flags: Flags, print: Print): number;
}

// A number as typed, from 1, or null.
const numberOf = (word: string): number | null => (/^[1-9]\d{0,14}$/.test(word) ? Number(word) : null);

function accountNamed({ accounts }: Data, name: string, print: Print) {
  const account = accounts.store.byKey(usernameKey(cleanName(name) ?? name));
  if (!account) print(`No account is called ${name}.`);
  return account;
}

function feedbackNumbered({ feedback }: Data, word: string, print: Print) {
  const id = numberOf(word);
  const found = id === null ? undefined : feedback.byId(id);
  if (!found) print(`There is no feedback #${word}.`);
  return found;
}

const counted = (username: string | null | undefined) =>
  username ? `counted for the account ${username}` : 'counted for no account';

// The statistics, in the order that `--json` prints them. They are read on one snapshot, so that
// the counts agree with the list while the server writes, and on a clock that the command reads
// once, so that every count is cut off at the same moment.
function accountStats(store: AccountStore) {
  return store.snapshot(() => ({
    total: store.count(),
    active: { last7Days: store.activeWithin(7), last30Days: store.activeWithin(30) },
    createdByDay: store.createdByDay(30),
    accounts: store.list(),
  }));
}

// The statistics as text: the counts, the days, and the accounts in a table with the username
// last, so that the columns line up whatever the username is made of.
function printAccountStats(store: AccountStore, print: Print): void {
  const { total, active, createdByDay, accounts } = accountStats(store);
  print(
    `${total} accounts, ${active.last7Days} active in the last 7 days and ${active.last30Days} in the last 30, ` +
      'by a login used or a game finished',
  );
  print('');
  print('New accounts by day, UTC, last 30 days');
  for (const { day, count } of createdByDay) print(`${day}  ${count}`);
  print('');
  // The accounts come by id, so the last has the widest number; the heading needs two columns.
  const width = Math.max(2, String(accounts.at(-1)?.id ?? 0).length + 1);
  print(`${'Id'.padStart(width)}  Registered  Games  Matches  Username`);
  for (const { id, username, createdAt, games, matches, barred } of accounts) {
    print(
      `${`#${id}`.padStart(width)}  ${day(createdAt)}  ${String(games).padStart(5)}  ` +
        `${String(matches).padStart(7)}  ${username}` +
        (barred ? '  (barred from public rooms)' : ''),
    );
  }
}

// How many reports `reports list` shows, and how much feedback `feedback trash` shows, the latest.
const REPORTS_SHOWN = 100;
const TRASH_SHOWN = 100;

// "2026-10-09 13:05 UTC" from the ISO time that the database keeps, and "2026-10-09" alone.
const when = (iso: string) => iso.replace('T', ' ').replace(/:\d{2}(\.\d+)?Z$/, ' UTC');
const day = (iso: string) => iso.slice(0, 10);

// Why the purge leaves a piece of feedback in the trash, or null when it doesn't: it was adopted,
// or is a GitHub issue, which only feedback adopted or recorded on its way to the trash is, or
// feedback that was in the trash as an issue before issues kept feedback out of it
// (store/feedback.ts).
const keptInTrash = ({ adoptedAt, issue }: Feedback): 'adopted' | 'issue' | null =>
  adoptedAt !== null ? 'adopted' : issue !== null ? 'issue' : null;

// How long feedback in the trash has left: "27 days left", "1 day left", or "0 days left" on the
// day the next purge takes it; or that it is kept, and why.
function trashTime(feedback: Feedback, daysLeft: number): string {
  const kept = keptInTrash(feedback);
  return kept === null ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : `kept: ${kept}`;
}

// Feedback in the trash as the operator reads it, one line each: the id, the day it went in, how
// long it has left, its kind, and the start of its text on one line.
function trashLine(feedback: Feedback, daysLeft: number): string {
  // Cut by code points, so that an emoji isn't cut in two.
  const chars = Array.from(feedback.text.replace(/\n/g, ' / '));
  const text = chars.length > 60 ? `${chars.slice(0, 60).join('')}...` : chars.join('');
  return `#${feedback.id}  ${day(feedback.deletedAt as string)}  ${trashTime(feedback, daysLeft)}  ${feedback.kind}  ${text}`;
}

// Characters that a terminal may take for a command rather than show: the control characters,
// among them the C1 controls that clear the screen, move the cursor or set the title, which Node
// reads a header's bytes of 0x80 to 0x9f as; and the format characters, such as the ones that turn
// the direction of text around. What a player writes loses them on its way in
// (shared/src/text.ts), but a bug's user agent is kept as the browser sent it. The backslash is
// among them so that it can be written out too, and a user agent that holds the text `\u{9b}`
// isn't taken for one that holds the character.
const UNSEEN = /[\\\p{Cc}\p{Cf}]/gu;

// Text for people on the terminal, with each such character written out as its code point, as
// `\u{9b}`, so that it is seen and does nothing, and each backslash as `\\`.
const seen = (text: string): string =>
  text.replace(UNSEEN, (char) => (char === '\\' ? '\\\\' : `\\u{${(char.codePointAt(0) as number).toString(16)}}`));

// The same in JSON text, but for the C0 controls, which JSON.stringify escapes inside every string
// already: the ones left are the newlines between the lines.
const UNSEEN_IN_JSON = /[\x7f-\x9f\p{Cf}]/gu;

// JSON for scripts, with each such character escaped as JSON does, as `\u009b`, one escape for each
// half of a surrogate pair: it parses to the same value, and is safe to print.
const seenJson = (json: string): string =>
  json.replace(UNSEEN_IN_JSON, (char) =>
    char
      .split('')
      .map((half) => `\\u${half.charCodeAt(0).toString(16).padStart(4, '0')}`)
      .join(''),
  );

// The way out of the trash, which a command that needs the feedback out of it points to.
const inTrash = (print: Print, { id }: Feedback) =>
  print(`Feedback #${id} is in the trash. Restore it first: feedback restore ${id}.`);

// A note taken on feedback in the trash, which may be a mistake, says where the feedback is.
const trashNote = (print: Print, { id, deletedAt }: Feedback) => {
  if (deletedAt !== null) print(`It is in the trash, by the way: feedback restore ${id} brings it back.`);
};

// What `feedback list` and the title of an issue call the kinds.
const KINDS: Record<FeedbackKind, string> = { idea: 'Idea', game: 'New game', bug: 'Bug', words: 'Word lists' };

// What `feedback list` shows, chosen with --status: all of it, in the trash too until it is
// purged; the open feedback, which nobody has dealt with yet, that is, the new, which it shows
// unless told otherwise; or the feedback of one of the other statuses (store/feedback.ts). None
// overlaps another but all.
const FEEDBACK_VIEWS = ['all', 'open', 'issue', 'resolved', 'closed', 'trash'] as const;
type ListView = (typeof FEEDBACK_VIEWS)[number];

// The feedback that a view reads.
const storeView = (view: ListView): FeedbackView => (view === 'open' ? 'new' : view);

// What `feedback list` calls the feedback of each view.
const VIEW_NAMES: Record<ListView, string> = {
  all: 'feedback',
  open: 'open feedback',
  issue: 'issued feedback, waiting to be adopted',
  resolved: 'resolved feedback',
  closed: 'closed feedback',
  trash: 'feedback in the trash',
};

// The status of a piece of feedback in a few words, with what it stands for written out: for
// feedback that waits as an issue, the issue's number and the pull request's, when one was recorded
// without the adoption, such as "Issue #77 · PR #76", which tells the operator that the adoption is
// still to come; for resolved feedback, that is, adopted, the pull request's number and the
// issue's, such as "Resolved · PR #76 · issue #77".
function statusLabel({ status, issue, resolvedPr }: Feedback): string {
  const pr = resolvedPr === null ? [] : [`PR #${resolvedPr}`];
  if (status === 'issue') return [...(issue === null ? [] : [`Issue #${issue}`]), ...pr].join(' · ');
  if (status === 'resolved') return ['Resolved', ...pr, ...(issue === null ? [] : [`issue #${issue}`])].join(' · ');
  return { new: 'New', closed: 'Closed', trash: 'Trash' }[status];
}

// Everything that became of the feedback, in the order it happens, or nothing for feedback that is
// new, with how long it has left in the trash, if it is there.
function trail(feedback: Feedback, daysLeft: number | null): string[] {
  const { issue, resolvedPr, adoptedAt, closedAt, deletedAt } = feedback;
  return [
    ...(issue === null ? [] : [`published as issue #${issue}`]),
    ...(resolvedPr === null ? [] : [`resolved by PR #${resolvedPr}`]),
    ...(adoptedAt === null ? [] : [`adopted ${day(adoptedAt)}`]),
    ...(closedAt === null ? [] : [`closed ${day(closedAt)}`]),
    ...(deletedAt === null ? [] : [`in the trash since ${day(deletedAt)}, ${trashTime(feedback, daysLeft ?? 0)}`]),
  ];
}

// Who a piece of feedback is from: the account that signed it, by its username as it is now, or
// that the account is gone; a guest's name, and an account whose username the name is, which may
// be someone passing for that account's owner; or no name, with the account it was sent from, if
// any.
function sender({ linkProfile, username, credit, nameTakenBy }: Feedback): string {
  if (linkProfile) {
    return username === null ? 'an account since deleted, which signed it' : `the account ${username}, which signed it`;
  }
  if (credit === null) return username === null ? 'anonymous' : `anonymous, sent from the account ${username}`;
  return (
    `${credit}, a guest's name` +
    (nameTakenBy === null ? '' : `, also the username of the account ${nameTakenBy}, which didn't send it`)
  );
}

// A piece of feedback as `feedback list` shows it to people: the id, the time, the kind, as this
// build calls it, or as it is, from a later server that this one was rolled back from, and the
// status on the first line; then, indented, what became of it, who it is from, the contact, the
// browser of a bug, with what a terminal would obey written out (seen), and the text, each of its
// lines quoted, so that none passes for another entry.
function feedbackLines(feedback: Feedback, daysLeft: number | null): string[] {
  const kind = (KINDS as Partial<Record<string, string>>)[feedback.kind] ?? feedback.kind;
  const steps = trail(feedback, daysLeft);
  return [
    `#${feedback.id}  ${when(feedback.createdAt)}  ${kind}  ${statusLabel(feedback)}`,
    ...(steps.length === 0 ? [] : [`    ${steps.join(' · ')}`]),
    `    from: ${sender(feedback)}`,
    `    contact: ${feedback.contact ?? '(none)'}`,
    ...(feedback.userAgent === null ? [] : [`    browser: ${seen(feedback.userAgent)}`]),
    ...feedback.text.split('\n').map((line) => `    > ${line}`.trimEnd()),
  ];
}

// A piece of feedback as `feedback list --json` gives it to scripts, with the fields of the
// feedback that the text shows. `daysLeft` is how long it has left in the trash, or null when it
// isn't there or is kept there, as adopted feedback and an issue are.
function feedbackJson(feedback: Feedback, daysLeft: number | null) {
  const { id, createdAt, kind, status, issue, resolvedPr, adoptedAt, closedAt, deletedAt } = feedback;
  const { linkProfile, username, credit, nameTakenBy, contact, text, userAgent } = feedback;
  return {
    id,
    createdAt,
    kind,
    status,
    issue,
    resolvedPr,
    adoptedAt,
    closedAt,
    deletedAt,
    daysLeft: keptInTrash(feedback) === null ? daysLeft : null,
    linkProfile,
    username,
    credit,
    nameTakenBy,
    contact,
    text,
    userAgent,
  };
}

// One report as the operator reads it: the id, the date, who reported whom, in which room, and the
// note. The player reported is named as they were in the room, with their account, if they had one.
// A report keeps no account that is gone, so a name that no guest has with no account is of an
// account deleted since, which is said, so that whoever has the username now isn't taken for them.
function reportLine({
  id,
  createdAt,
  reporter,
  reported,
  reportedBarred,
  reportedName,
  roomCode,
  text,
}: Report): string {
  let who = `${reportedName} (account ${reported}${reportedBarred ? ', barred' : ''})`;
  if (reported === null) who = isGuestName(reportedName) ? reportedName : `${reportedName} (deleted account)`;
  return (
    `#${id}  ${day(createdAt)}  ${reporter ?? '(deleted account)'} reported ${who} in ${formatCode(roomCode)}` +
    (text === null ? '' : `: ${text.replace(/\n/g, ' / ')}`)
  );
}

// The issue that `feedback draft` writes holds what the form says may be published
// (feedback.privacy in the locales): the player's text and the name they left, if any, and
// nothing else that came with the feedback, neither contact, link, account, version, browser nor
// time, nor the feedback's id. The body opens with what the feedback is, by its kind, quotes
// the text, and says who sent it.
const OPENINGS: Record<FeedbackKind, string> = {
  idea: 'An idea',
  game: 'An idea for a new game',
  bug: 'A bug report',
  words: 'A suggestion for the word lists',
};

// How much of the first line of the text the title takes, in the characters that a reader sees,
// and in code points, which GitHub counts, taking a title of at most 256: a character that a reader
// sees may be several, so this bound leaves room for the kind and the zero-width spaces.
const TITLE_LENGTH = 60;
const TITLE_POINTS = 120;
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

// The player's text and name go to GitHub as they are, and GitHub reads more in text than
// Markdown: it mentions a user or a team written as @name, links an email address, refers to an
// issue, a pull request or a discussion written as #12, GH-12 or owner/repo/issues/12, with or
// without the address of the site in front, which then shows the reference, links a commit written
// as seven or more hexadecimal digits on their own, and shows :boom: as an emoji, in a title as
// much as in a body; and in a body it shows $x^2$ or $$x^2$$ as a formula, in any size or color
// that LaTeX gives it, and a quotation whose first line is [!NOTE], [!TIP], [!IMPORTANT],
// [!WARNING] or [!CAUTION] alone, in any case, as an alert, with a title and an icon of GitHub's
// own in place of that line. Those patterns need the name, the number, the rest of the digits, the
// shortcode or the ! right after their first character, and a formula needs nothing but a space or
// punctuation before its opening $, so a zero-width space after that character, or before the $,
// which shows nothing, keeps them from matching; a backslash wouldn't, since GitHub reads the
// signs in the text once Markdown has taken the backslash away. A slash or a colon after a digit,
// as in a date or a time, is left alone: no reference or shortcode starts that way.
const ZERO_WIDTH_SPACE = '\u200b';
const LINKED =
  /@(?=[a-z0-9])|(?:#|GH-|(?<!\d)\/)(?=\d)|\b[0-9a-f](?=[0-9a-f]{6,}\b)|(?<!\d):(?=[\w+-]+:)|(?=\$)|\[(?=!)/gi;
const unlinked = (text: string): string => text.replace(LINKED, `$&${ZERO_WIDTH_SPACE}`);

// A line of the text, or the name, as the body's Markdown shows it as it is: unlinked, and then
// with every ASCII punctuation character escaped, as a name is in SPONSORS.md
// (shared/src/lists.ts), so that no line is a heading, a list item, a quotation of its own, a
// rule, emphasis, code, a link, an image, a tag or a web address.
const literal = (text: string): string => escapeName(unlinked(text));

// The title: the kind, as `feedback list` calls it, and the first line of the text, on one line
// with its spaces collapsed, cut after TITLE_LENGTH characters, or fewer when they are more than
// TITLE_POINTS code points, with an ellipsis. The characters are the ones that a reader sees, as
// textLength counts them (shared/src/text.ts), so that a Chinese character or an emoji is never
// cut in two, unless the first character alone is more than TITLE_POINTS code points, as many
// emoji joined into one are, which is cut after that many. GitHub renders no Markdown in a title
// but a code span between backticks, so nothing is escaped, and the signs are unlinked all the
// same.
function issueTitle({ kind, text }: Feedback): string {
  const line = (text.split('\n')[0] ?? '').replace(/\s+/g, ' ').trim();
  const chars = [...graphemes.segment(line)].map(({ segment }) => segment);
  const kept = chars.slice(0, TITLE_LENGTH);
  while ([...kept.join('')].length > TITLE_POINTS) kept.pop();
  const head = kept.length > 0 ? kept.join('') : [...line].slice(0, TITLE_POINTS).join('');
  const cut = kept.length < chars.length ? `${head.trimEnd()}\u2026` : line;
  return `${KINDS[kind]}: ${unlinked(cut)}`;
}

// The body, in Markdown: the opening sentence, the text as one quotation, line by line, with a
// blank line kept as a bare >, and who sent it: the username of the account that signed it, as it
// is when the draft is written, or a deleted player once the account is gone; a guest's name; or
// that the player left none. A bug report then says which build of the page it came from and
// which browser, as the form promises: the names and the versions of the browser and the system
// alone (userAgent.ts), never the model or the user agent itself. The version came from the page,
// so it is written as the text is.
function issueBody({ kind, text, credit, linkProfile, username, version, userAgent }: Feedback): string {
  const quoted = text.split('\n').map((line) => (line === '' ? '>' : `> ${literal(line)}`));
  const sent = kind === 'bug' ? 'Reported' : 'Suggested';
  const name = linkProfile ? (username === null ? 'a deleted player' : literal(username)) : credit && literal(credit);
  const who = name === null ? 'Sent by an anonymous player.' : `${sent} by ${name}.`;
  const browser = kind === 'bug' && userAgent !== null ? describeBrowser(userAgent) : null;
  const facts =
    kind === 'bug' ? ['', `Version: ${literal(version)}`, ...(browser === null ? [] : [`Browser: ${browser}`])] : [];
  return [`${OPENINGS[kind]} that a player sent through the feedback form:`, '', ...quoted, '', who, ...facts].join(
    '\n',
  );
}

// What a contribution from GitHub is adopted as, by its kind, in the command's answer.
const ADOPTED_AS: Record<ContributionKind, string> = {
  idea: 'an idea',
  game: 'an idea for a new game',
  bug: 'a bug report',
  words: 'a contribution to the word lists',
  code: 'a contribution to the code or the docs',
};

// What a `github` command is about: the issue, by its number as the command's one word, or the
// security advisory, by its id after --advisory and no word; or null, said, for neither or both.
function githubRef(words: string[], { advisory }: Flags, print: Print): GithubRef | null {
  if (advisory !== undefined) {
    if (words.length > 0) {
      print('Name the issue by its number, or the advisory with --advisory, not both.');
      return null;
    }
    if (!GITHUB_ADVISORY.test(advisory)) {
      print(`${advisory} is not the id of a GitHub security advisory, which is GHSA- and three groups of four.`);
      return null;
    }
    return { advisory };
  }
  const [word] = words;
  if (word === undefined) {
    print('Name the issue by its number, or an advisory with --advisory GHSA-xxxx-xxxx-xxxx.');
    return null;
  }
  const issue = numberOf(word);
  if (issue === null) {
    print(`${word} is not the number of an issue.`);
    return null;
  }
  return { issue };
}

// How a `github` command names what it is about, and the way to refer to it in the next command.
const refName = (ref: GithubRef) => ('issue' in ref ? `Issue #${ref.issue}` : `Advisory ${ref.advisory}`);
const refNamed = (ref: GithubRef) => ('issue' in ref ? `issue #${ref.issue}` : `advisory ${ref.advisory}`);
const refWord = (ref: GithubRef) => ('issue' in ref ? String(ref.issue) : `--advisory ${ref.advisory}`);

// A contribution from GitHub as `github list` shows it, on one line: the issue or the advisory, the
// day it was adopted, its kind, who made it, with the id of their GitHub account, and how the home
// page lists them, and then the two sentences.
function githubLine({
  issue,
  advisory,
  adoptedAt,
  kind,
  login,
  githubId,
  named,
  summaryZh,
  summaryEn,
}: GithubContribution) {
  const author = login === null ? 'author forgotten' : `${login} (${githubId})${named ? '' : ', listed anonymously'}`;
  return `${issue === null ? advisory : `#${issue}`}  ${day(adoptedAt)}  ${kind}  ${author}  ${summaryZh} · ${summaryEn}`;
}

// What the player contributed, from --zh and --en, which `feedback adopt` and `feedback describe`
// take both of, by the rules of shared/src/contributions.ts; or the code to end with when they are
// missing (a usage error) or break the rules.
function summaryOf({ zh, en }: Flags, print: Print): ContributionSummary | 1 | 2 {
  if (zh === undefined || en === undefined) {
    print(
      'Say what the player contributed in both languages: --zh "<a sentence in Chinese>" --en "<a sentence in English>".',
    );
    return 2;
  }
  const zhCheck = checkSummary(zh);
  const enCheck = checkSummary(en);
  let wrong = false;
  for (const [flag, { problem }] of [
    ['--zh', zhCheck],
    ['--en', enCheck],
  ] as const) {
    if (problem === 'summary_missing') print(`${flag} shows nothing.`);
    if (problem === 'summary_too_long') print(`${flag} has more than ${MAX_SUMMARY_LENGTH} characters.`);
    wrong ||= problem !== null;
  }
  return wrong ? 1 : { zh: zhCheck.summary as string, en: enCheck.summary as string };
}

// What a contribution says the player contributed, on two lines.
function printSummary(print: Print, zh: string | null, en: string | null): void {
  print(`  zh: ${zh ?? '(nothing yet)'}`);
  print(`  en: ${en ?? '(nothing yet)'}`);
}

const COMMANDS: Record<string, Command> = {
  accounts: {
    words: 0,
    flags: ['json'],
    readOnly: true,
    run({ db }, _words, { json }, print) {
      const now = Date.now();
      const store = new AccountStore(db, () => now);
      if (json) print(JSON.stringify(accountStats(store), null, 2));
      else printAccountStats(store, print);
      return 0;
    },
  },
  'accounts bar': {
    words: 1,
    flags: [],
    run(data, [name], _flags, print) {
      const account = accountNamed(data, name as string, print);
      if (!account) return 1;
      data.accounts.store.setPublicBarred(account.id, true);
      print(`${account.username} may not create or join public rooms. Private rooms are still open to them.`);
      return 0;
    },
  },
  'accounts unbar': {
    words: 1,
    flags: [],
    run(data, [name], _flags, print) {
      const account = accountNamed(data, name as string, print);
      if (!account) return 1;
      data.accounts.store.setPublicBarred(account.id, false);
      print(`${account.username} may create and join public rooms again.`);
      return 0;
    },
  },
  // AI players (docs/architecture.md#ai-players) are for the accounts that the operator lets have
  // them while they are tried out: in the private rooms that such an account chairs.
  'agents allow': {
    words: 1,
    flags: [],
    run(data, [name], _flags, print) {
      const account = accountNamed(data, name as string, print);
      if (!account) return 1;
      data.accounts.store.setAgents(account.id, true);
      print(`${account.username} may invite AI players to the private rooms they chair.`);
      return 0;
    },
  },
  'agents deny': {
    words: 1,
    flags: [],
    run(data, [name], _flags, print) {
      const account = accountNamed(data, name as string, print);
      if (!account) return 1;
      data.accounts.store.setAgents(account.id, false);
      print(`${account.username} may not invite AI players any more. Those in their rooms now stay.`);
      return 0;
    },
  },
  'agents list': {
    words: 0,
    flags: [],
    readOnly: true,
    run({ accounts }, _words, _flags, print) {
      const users = accounts.store.agentUsers();
      if (users.length === 0) print('No account may invite AI players.');
      for (const { id, username } of users) print(`${id}\t${username}`);
      return 0;
    },
  },
  'reports list': {
    words: 0,
    flags: [],
    readOnly: true,
    run({ feedback }, _words, _flags, print) {
      const reports = feedback.reports(REPORTS_SHOWN);
      const total = feedback.reportCount();
      if (total === 0) {
        print('No reports yet.');
        return 0;
      }
      print(total === 1 ? '1 report:' : `${total} reports in all, the latest ${Math.min(total, REPORTS_SHOWN)} first:`);
      for (const report of reports) print(reportLine(report));
      return 0;
    },
  },
  'data check': {
    words: 0,
    flags: [],
    readOnly: true,
    run({ db, dataDir }, _words, _flags, print) {
      // The avatar files are looked for where the server keeps them; a copy of the database alone,
      // as a snapshot is, has none to look for.
      const avatarDir = join(dataDir, AVATAR_DIR);
      const avatars = existsSync(avatarDir);
      if (!avatars) print(`There is no ${AVATAR_DIR} directory in ${dataDir}, so the avatar files were not checked.`);
      const problems = checkData(db, { games: GAMES, avatarDir: avatars ? avatarDir : null });
      if (problems.length === 0) {
        print('Every check passed.');
        return 0;
      }
      for (const { rule, count, ids } of problems) {
        const shown = count > ids.length ? `${ids.join(', ')} and ${count - ids.length} more` : ids.join(', ');
        print(`${rule}: ${count === 1 ? '1 row' : `${count} rows`}: ${shown}`);
      }
      print(`${problems.length === 1 ? '1 check' : `${problems.length} checks`} failed.`);
      return 1;
    },
  },
  'avatar remove': {
    words: 1,
    flags: ['ban'],
    run(data, [name], { ban }, print) {
      const account = accountNamed(data, name as string, print);
      if (!account) return 1;
      const file = data.accounts.takeDownAvatar(account.id, ban === true);
      print(
        file === null
          ? `${account.username} has the default avatar.`
          : `Took down /avatars/${file} of ${account.username}. Browsers, and a CDN in front of the site, ` +
              "may keep a copy for up to a year: purge that address from the CDN's cache too.",
      );
      if (ban) print(`${account.username} may not upload another avatar.`);
      return 0;
    },
  },
  'avatar allow': {
    words: 1,
    flags: [],
    run(data, [name], _flags, print) {
      const account = accountNamed(data, name as string, print);
      if (!account) return 1;
      data.accounts.store.setAvatarBanned(account.id, false);
      print(`${account.username} may upload an avatar again.`);
      return 0;
    },
  },
  'profile clear': {
    words: 1,
    flags: ['ban'],
    run(data, [name], { ban }, print) {
      const account = accountNamed(data, name as string, print);
      if (!account) return 1;
      const cleared = data.accounts.takeDownProfile(account.id, ban === true);
      print(
        cleared
          ? `Cleared the link and the bio on the profile of ${account.username}.`
          : `${account.username} has no link or bio on their profile.`,
      );
      if (ban) print(`${account.username} may not write a link or a bio again.`);
      return 0;
    },
  },
  'profile allow': {
    words: 1,
    flags: [],
    run(data, [name], _flags, print) {
      const account = accountNamed(data, name as string, print);
      if (!account) return 1;
      data.accounts.store.setProfileBanned(account.id, false);
      print(`${account.username} may write a link and a bio again.`);
      return 0;
    },
  },
  'profile list': {
    words: 0,
    flags: [],
    readOnly: true,
    run({ accounts }, _words, _flags, print) {
      const profiles = accounts.store.profiles();
      if (profiles.length === 0) {
        print('No profile has a link or a bio.');
        return 0;
      }
      print(
        profiles.length === 1 ? '1 profile with a link or a bio:' : `${profiles.length} profiles with a link or a bio:`,
      );
      for (const { id, username, link, bio } of profiles) {
        print(`#${id}  ${username}`);
        if (link !== null) print(`    link: ${link}`);
        if (bio !== null) print(`    bio: ${bio}`);
      }
      return 0;
    },
  },
  'feedback list': {
    words: 0,
    flags: ['status', 'json'],
    readOnly: true,
    run({ feedback }, _words, { status = 'open', json }, print) {
      if (!(FEEDBACK_VIEWS as readonly string[]).includes(status)) {
        print(`${status} is not a status to list: one of ${FEEDBACK_VIEWS.join(', ')}.`);
        return 1;
      }
      const view = status as ListView;
      // All of it, the newest first: the feedback is read whole, never a page of it.
      const entries = feedback.latest(Number.MAX_SAFE_INTEGER, storeView(view));
      const listed = entries.map((entry) => ({ entry, daysLeft: feedback.daysLeft(entry) }));
      if (json) {
        const rows = listed.map(({ entry, daysLeft }) => feedbackJson(entry, daysLeft));
        print(seenJson(JSON.stringify(rows, null, 2)));
        return 0;
      }
      const name = VIEW_NAMES[view];
      if (entries.length === 0) {
        print(`No ${name}.`);
        return 0;
      }
      print(entries.length === 1 ? `1 piece of ${name}:` : `${entries.length} pieces of ${name}, the newest first:`);
      for (const { entry, daysLeft } of listed) {
        print('');
        for (const line of feedbackLines(entry, daysLeft)) print(line);
      }
      return 0;
    },
  },
  'feedback adopt': {
    words: 1,
    flags: ['zh', 'en'],
    run(data, [word], flags, print) {
      const summary = summaryOf(flags, print);
      if (typeof summary === 'number') return summary;
      const found = feedbackNumbered(data, word as string, print);
      if (!found) return 1;
      if (found.adoptedAt !== null) {
        print(
          `Feedback #${found.id} was adopted already, on ${day(found.adoptedAt)}. To say again what the ` +
            `player contributed: feedback describe ${found.id} --zh <sentence> --en <sentence>.`,
        );
        return 1;
      }
      // Adopted feedback would be listed while on its way out; the purge leaves it alone
      // (store/feedback.ts), but it shouldn't be adopted in the first place.
      if (found.deletedAt !== null) {
        inTrash(print, found);
        return 1;
      }
      // Closed feedback was set aside as not adopted, and `feedback list` files it as closed, so it
      // is reopened first.
      if (found.closedAt !== null) {
        print(`Feedback #${found.id} is closed. Reopen it first: feedback reopen ${found.id}.`);
        return 1;
      }
      if (found.issue === null) {
        print(
          `Feedback #${found.id} is no GitHub issue. Every adopted piece of feedback is one: publish it first, or ` +
            `record one made by hand with feedback issue ${found.id} <number>.`,
        );
        return 1;
      }
      // The feedback was read a moment ago, so it has changed since only if someone else is running
      // a command at the same time.
      if (!data.feedback.adopt(found.id, summary)) {
        print(
          `Feedback #${found.id} was adopted, closed or moved to the trash just now, or its issue was taken back. ` +
            'Look at it again.',
        );
        return 1;
      }
      // Signed with the account, it is listed by the account's username, with its avatar, or as a
      // deleted player once the account is gone.
      const as = found.linkProfile
        ? found.username === null
          ? 'as a deleted player'
          : `as ${found.username}, with the account's avatar`
        : found.credit === null
          ? 'as an anonymous player'
          : `as ${found.credit}`;
      print(
        `Adopted feedback #${found.id}, issue #${found.issue}. The home page lists it now, ${as}, ` +
          `${counted(found.username)}, saying that the player contributed:`,
      );
      printSummary(print, summary.zh, summary.en);
      // A guest's name may be anyone's, but one that is an account's username may be someone
      // passing for its owner, which `feedback list` points out too.
      if (found.nameTakenBy !== null) {
        print(
          `${found.credit} is also the username of the account ${found.nameTakenBy}, which didn't send the ` +
            'feedback. Make sure that they are the same person.',
        );
      }
      return 0;
    },
  },
  'feedback describe': {
    words: 1,
    flags: ['zh', 'en'],
    run(data, [word], flags, print) {
      const summary = summaryOf(flags, print);
      if (typeof summary === 'number') return summary;
      const found = feedbackNumbered(data, word as string, print);
      if (!found) return 1;
      if (found.adoptedAt === null || !data.feedback.describe(found.id, summary)) {
        print(
          `Feedback #${found.id} isn't adopted. Adopt it with feedback adopt ${found.id} --zh <sentence> --en <sentence>.`,
        );
        return 1;
      }
      print(`Feedback #${found.id} now says that the player contributed:`);
      printSummary(print, summary.zh, summary.en);
      print('It said:');
      printSummary(print, found.summaryZh, found.summaryEn);
      return 0;
    },
  },
  'feedback draft': {
    words: 1,
    flags: ['json'],
    readOnly: true,
    run(data, [word], { json }, print) {
      const found = feedbackNumbered(data, word as string, print);
      if (!found) return 1;
      if (found.deletedAt !== null) {
        inTrash(print, found);
        return 1;
      }
      if (found.issue !== null) {
        print(
          `Feedback #${found.id} is issue #${found.issue} already. To publish it again, take that back first: ` +
            `feedback issue ${found.id} --clear.`,
        );
        return 1;
      }
      // A kind from a later server, which this one was rolled back from, has no name or opening.
      if (!Object.hasOwn(KINDS, found.kind)) {
        print(`This build doesn't know the kind ${found.kind} of feedback #${found.id}.`);
        return 1;
      }
      const title = issueTitle(found);
      const body = issueBody(found);
      if (json) {
        print(JSON.stringify({ id: found.id, kind: found.kind, title, body }));
        return 0;
      }
      print(title);
      print('');
      for (const line of body.split('\n')) print(line);
      print('');
      print(
        `Create the issue on GitHub with this title and body, then record its number: feedback issue ${found.id} <number>.`,
      );
      return 0;
    },
  },
  'feedback issue': {
    words: 2,
    flags: [],
    run(data, [word, numberWord], _flags, print) {
      const found = feedbackNumbered(data, word as string, print);
      if (!found) return 1;
      if (numberWord === '--clear') {
        if (found.issue === null) {
          print(`Feedback #${found.id} has no issue recorded.`);
          return 1;
        }
        if (found.adoptedAt !== null) {
          print(
            `Feedback #${found.id} was adopted, and keeps an issue, which the home page links. Record another ` +
              `number in its place if #${found.issue} is wrong: feedback issue ${found.id} <number>.`,
          );
          return 1;
        }
        data.feedback.setIssue(found.id, null);
        print(`Feedback #${found.id} is no longer recorded as issue #${found.issue}.`);
        trashNote(print, found);
        return 0;
      }
      const issue = numberOf(numberWord as string);
      if (issue === null) {
        print(`${numberWord} is not the number of an issue.`);
        return 1;
      }
      // Feedback in the trash would be deleted with its issue still public, which feedback that is an
      // issue never is, so it comes out first, as `feedback draft` asks too.
      if (found.deletedAt !== null) {
        inTrash(print, found);
        return 1;
      }
      // An issue is a player's feedback or a developer's, never both.
      if (data.contributions.byRef({ issue }) !== undefined) {
        print(`Issue #${issue} is a contribution from GitHub (github list), so it can't be a player's feedback too.`);
        return 1;
      }
      data.feedback.setIssue(found.id, issue);
      print(
        `Feedback #${found.id} is issue #${issue}, ${REPOSITORY_URL}/issues/${issue}` +
          (found.issue === null || found.issue === issue ? '.' : `, no longer #${found.issue}.`),
      );
      return 0;
    },
  },
  'feedback resolve': {
    words: 2,
    flags: [],
    run(data, [word, numberWord], _flags, print) {
      const found = feedbackNumbered(data, word as string, print);
      if (!found) return 1;
      if (numberWord === '--clear') {
        if (found.resolvedPr === null) {
          print(`Feedback #${found.id} has no pull request recorded.`);
          return 1;
        }
        data.feedback.resolve(found.id, null);
        print(`Feedback #${found.id} is no longer recorded as resolved by PR #${found.resolvedPr}.`);
        trashNote(print, found);
        return 0;
      }
      const pr = numberOf(numberWord as string);
      if (pr === null) {
        print(`${numberWord} is not the number of a pull request.`);
        return 1;
      }
      data.feedback.resolve(found.id, pr);
      print(
        `Feedback #${found.id} is resolved by PR #${pr}, ${REPOSITORY_URL}/pull/${pr}` +
          (found.resolvedPr === null || found.resolvedPr === pr ? '.' : `, no longer #${found.resolvedPr}.`),
      );
      trashNote(print, found);
      return 0;
    },
  },
  'feedback close': {
    words: 1,
    flags: [],
    run(data, [word], _flags, print) {
      const found = feedbackNumbered(data, word as string, print);
      if (!found) return 1;
      if (found.deletedAt !== null) {
        inTrash(print, found);
        return 1;
      }
      // Closing says that the feedback wasn't adopted; adopted feedback stays on the home page.
      if (found.adoptedAt !== null) {
        print(`Feedback #${found.id} was adopted, and the home page lists it, so it can't be closed.`);
        return 1;
      }
      if (!data.feedback.close(found.id)) {
        print(`Feedback #${found.id} is closed already${found.closedAt === null ? ', or adopted just now' : ''}.`);
        return 1;
      }
      print(`Closed feedback #${found.id}. It stays, for the record; feedback reopen ${found.id} opens it again.`);
      return 0;
    },
  },
  'feedback reopen': {
    words: 1,
    flags: [],
    run(data, [word], _flags, print) {
      const found = feedbackNumbered(data, word as string, print);
      if (!found) return 1;
      if (found.deletedAt !== null) {
        inTrash(print, found);
        return 1;
      }
      if (!data.feedback.reopen(found.id)) {
        print(`Feedback #${found.id} is open.`);
        return 1;
      }
      print(`Reopened feedback #${found.id}.`);
      return 0;
    },
  },
  'feedback delete': {
    words: 1,
    flags: [],
    run(data, [word], _flags, print) {
      const found = feedbackNumbered(data, word as string, print);
      if (!found) return 1;
      if (found.deletedAt !== null) {
        print(
          `Feedback #${found.id} is in the trash already, ${trashTime(found, data.feedback.daysLeft(found) as number)}.`,
        );
        return 1;
      }
      // The home page lists adopted feedback, which must stay for it.
      if (found.adoptedAt !== null) {
        print(`Feedback #${found.id} was adopted, and the home page lists it, so it can't be deleted.`);
        return 1;
      }
      // An issue is public, and the feedback stays with it, closed if it is to be left alone.
      if (found.issue !== null) {
        print(
          `Feedback #${found.id} is issue #${found.issue}, which is public, so it can't be deleted: close it ` +
            `instead with feedback close ${found.id}. If the issue was recorded by mistake, take it back ` +
            `first with feedback issue ${found.id} --clear.`,
        );
        return 1;
      }
      // Read a moment ago, it has changed since only if someone else is running a command at the
      // same time: `feedback adopt` or `feedback issue`, or `feedback delete` too. Read again to say which.
      if (!data.feedback.delete(found.id)) {
        const again = data.feedback.byId(found.id);
        if (again !== undefined && again.adoptedAt !== null) {
          print(`Feedback #${found.id} was adopted just now, so it stays.`);
        } else if (again !== undefined && again.issue !== null) {
          print(`Feedback #${found.id} was recorded as an issue just now, so it stays.`);
        } else if (again !== undefined && again.deletedAt !== null) {
          print(`Feedback #${found.id} was moved to the trash just now.`);
        } else {
          print(`Feedback #${found.id} couldn't be moved to the trash. Look at it again.`);
        }
        return 1;
      }
      print(
        `Moved feedback #${found.id} to the trash. The server deletes it for good in 30 days; ` +
          `feedback restore ${found.id} brings it back before then.`,
      );
      return 0;
    },
  },
  'feedback restore': {
    words: 1,
    flags: [],
    run(data, [word], _flags, print) {
      const found = feedbackNumbered(data, word as string, print);
      if (!found) return 1;
      if (!data.feedback.restore(found.id)) {
        print(`Feedback #${found.id} isn't in the trash.`);
        return 1;
      }
      print(`Restored feedback #${found.id} from the trash.` + (found.closedAt === null ? '' : ' It is still closed.'));
      return 0;
    },
  },
  'feedback trash': {
    words: 0,
    flags: [],
    readOnly: true,
    run({ feedback }, _words, _flags, print) {
      const entries = feedback.latest(TRASH_SHOWN, 'trash');
      const total = feedback.statuses().trash;
      if (total === 0) {
        print('The trash is empty.');
        return 0;
      }
      print(
        (total === 1 ? '1 piece of feedback' : `${total} pieces of feedback`) +
          ' in the trash, each deleted for good 30 days after it went in' +
          (total > TRASH_SHOWN ? `, the latest ${TRASH_SHOWN} first:` : ':'),
      );
      for (const entry of entries) print(trashLine(entry, feedback.daysLeft(entry) as number));
      return 0;
    },
  },
  'github adopt': {
    words: [0, 1],
    flags: ['advisory', 'kind', 'login', 'id', 'anonymous', 'zh', 'en'],
    run(data, words, flags, print) {
      const ref = githubRef(words, flags, print);
      if (ref === null) return 1;
      const { login, id, anonymous } = flags;
      // An advisory is a bug report, published once the problem was fixed.
      const kind = flags.kind ?? ('advisory' in ref ? 'bug' : undefined);
      if (kind === undefined || login === undefined || id === undefined) {
        print(
          'Say what kind of contribution it is and who made it: --kind <kind> --login <GitHub username> ' +
            '--id <id of the GitHub account>.',
        );
        return 2;
      }
      const summary = summaryOf(flags, print);
      if (typeof summary === 'number') return summary;
      if (!(CONTRIBUTION_KINDS as readonly string[]).includes(kind)) {
        print(`${kind} is not a kind of contribution: one of ${CONTRIBUTION_KINDS.join(', ')}.`);
        return 1;
      }
      if ('advisory' in ref && kind !== 'bug') {
        print('An advisory is adopted as a bug report: --kind bug.');
        return 1;
      }
      if (!GITHUB_LOGIN.test(login)) {
        print(`${login} is not a GitHub username.`);
        return 1;
      }
      const githubId = numberOf(id);
      if (githubId === null) {
        print(`${id} is not the id of a GitHub account.`);
        return 1;
      }
      const named = anonymous !== true;
      const adopted = data.contributions.adopt({
        ref,
        kind: kind as ContributionKind,
        login,
        githubId,
        named,
        summary,
      });
      if (adopted === 'adopted_already') {
        print(
          `${refName(ref)} was adopted already. To say again what was contributed: github describe ${refWord(ref)} ` +
            '--zh <sentence> --en <sentence>.',
        );
        return 1;
      }
      if (adopted === 'feedback_issue') {
        print(
          `${refName(ref)} is a player's feedback, which is adopted as feedback: feedback adopt <id> --zh <sentence> ` +
            '--en <sentence>.',
        );
        return 1;
      }
      const as = named ? `as ${login}, linked to ${GITHUB_URL}/${login}` : 'as an anonymous player';
      print(
        `Adopted ${refNamed(ref)} as ${ADOPTED_AS[kind as ContributionKind]}. The home page lists it ` +
          `now, ${as}, saying that the player contributed:`,
      );
      printSummary(print, summary.zh, summary.en);
      return 0;
    },
  },
  'github describe': {
    words: [0, 1],
    flags: ['advisory', 'zh', 'en'],
    run(data, words, flags, print) {
      const ref = githubRef(words, flags, print);
      if (ref === null) return 1;
      const summary = summaryOf(flags, print);
      if (typeof summary === 'number') return summary;
      const found = data.contributions.byRef(ref);
      if (found === undefined || !data.contributions.describe(ref, summary)) {
        print(
          `${refName(ref)} isn't adopted. Adopt it with github adopt ${refWord(ref)} --kind <kind> --login <username> --id <number> --zh <sentence> --en <sentence>.`,
        );
        return 1;
      }
      print(`${refName(ref)} now says that the player contributed:`);
      printSummary(print, summary.zh, summary.en);
      print('It said:');
      printSummary(print, found.summaryZh, found.summaryEn);
      return 0;
    },
  },
  'github anonymous': {
    words: [0, 1],
    flags: ['advisory'],
    run(data, words, flags, print) {
      const ref = githubRef(words, flags, print);
      if (ref === null) return 1;
      const found = data.contributions.byRef(ref);
      if (found === undefined) {
        print(`${refName(ref)} isn't adopted.`);
        return 1;
      }
      if (!data.contributions.anonymize(ref)) {
        print(`${refName(ref)} is listed anonymously already.`);
        return 1;
      }
      print(
        `${refName(ref)} is listed as an anonymous player from now on. Its author, ${found.login}, stays on record; ` +
          `github forget ${refWord(ref)} drops them too.`,
      );
      return 0;
    },
  },
  'github forget': {
    words: [0, 1],
    flags: ['advisory'],
    run(data, words, flags, print) {
      const ref = githubRef(words, flags, print);
      if (ref === null) return 1;
      const found = data.contributions.byRef(ref);
      if (found === undefined) {
        print(`${refName(ref)} isn't adopted.`);
        return 1;
      }
      if (!data.contributions.forget(ref)) {
        print(`The author of ${refNamed(ref)} was forgotten already.`);
        return 1;
      }
      print(
        `Forgot that ${found.login} made ${refNamed(ref)}: it is listed as an anonymous player, and ` +
          'nothing names its author any more.',
      );
      return 0;
    },
  },
  'github list': {
    words: 0,
    flags: [],
    readOnly: true,
    run({ contributions }, _words, _flags, print) {
      const rows = contributions.list();
      if (rows.length === 0) {
        print('No contribution from GitHub yet.');
        return 0;
      }
      print(
        rows.length === 1
          ? '1 contribution from GitHub:'
          : `${rows.length} contributions from GitHub, the latest first:`,
      );
      for (const row of rows) print(githubLine(row));
      return 0;
    },
  },
};

export function admin(args: readonly string[], env: NodeJS.ProcessEnv, print: Print): number {
  const parsed = parse(args);
  // A command is named by two words, as `avatar remove`, or by one, as `accounts`.
  const all = parsed?.words ?? [];
  const named = Object.hasOwn(COMMANDS, all.slice(0, 2).join(' ')) ? 2 : 1;
  const key = all.slice(0, named).join(' ');
  const command = Object.hasOwn(COMMANDS, key) ? COMMANDS[key] : undefined;
  const words = all.slice(named);
  const counts = typeof command?.words === 'number' ? [command.words] : command?.words;
  if (
    !parsed ||
    !command ||
    !counts?.includes(words.length) ||
    Object.keys(parsed.flags).some((flag) => !command.flags.includes(flag as keyof Flags))
  ) {
    print(USAGE);
    return 2;
  }
  const { dataDir } = loadConfig(env);
  if (dataDir === null) {
    print("Set DATA_DIR to the server's data directory.");
    return 1;
  }
  const file = join(dataDir, DATABASE_FILE);
  // Opening a database that isn't there would make an empty one.
  if (!existsSync(file)) {
    print(`There is no database in ${dataDir}.`);
    return 1;
  }
  const db = new DatabaseSync(file);
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON`);
    // A command that only reads says so, and the connection then refuses to write, so that it can't
    // by mistake. It isn't opened read-only: that would leave the WAL's two files behind on a
    // database that no server has open, owned by whoever ran the command, and the server might not
    // be able to write them.
    if (command.readOnly) db.exec('PRAGMA query_only = ON');
    if (schemaVersion(db) !== MIGRATIONS.length) {
      print(`The database is at schema version ${schemaVersion(db)}, and this build knows ${MIGRATIONS.length}.`);
      return 1;
    }
    // Made on first use, so that a command that only reads never makes the avatars' directory.
    let accounts: Accounts | undefined;
    let feedback: FeedbackStore | undefined;
    let contributions: ContributionStore | undefined;
    const data: Data = {
      db,
      dataDir,
      get accounts() {
        return (accounts ??= new Accounts({
          db,
          feedback: this.feedback,
          now: () => performance.now(),
          avatars: new DirectoryAvatars(join(dataDir, AVATAR_DIR), { owner: false }),
        }));
      },
      get feedback() {
        return (feedback ??= new FeedbackStore(db));
      },
      get contributions() {
        return (contributions ??= new ContributionStore(db));
      },
    };
    return command.run(data, words, parsed.flags, print);
  } finally {
    db.close();
  }
}

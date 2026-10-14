import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  checkSummary,
  cleanName,
  escapeName,
  formatCode,
  MAX_SUMMARY_LENGTH,
  REPOSITORY_URL,
  usernameKey,
  type ContributionSummary,
  type FeedbackKind,
} from '@reviewer2/shared';
import { AVATAR_DIR, DirectoryAvatars } from './accounts/avatars';
import { Accounts } from './accounts/service';
import { loadConfig } from './config';
import { AccountStore } from './store/accounts';
import { BUSY_TIMEOUT_MS, DATABASE_FILE, schemaVersion } from './store/database';
import { FeedbackStore, type Feedback, type Report } from './store/feedback';
import { MIGRATIONS } from './store/migrations';
import { KINDS } from './statusPage';

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
//   node server/dist/admin.cjs reports list
//
// adminCli.ts runs this, as index.ts runs main.ts.
//
// `avatar remove` takes an account's avatar down, as for a picture that breaks the rules, and with
// --ban bars the account from uploading another; `avatar allow` lifts that. `profile clear` does
// the same for the link and the bio on an account's public profile
// (docs/architecture.md#public-profiles), `profile allow` lifts the bar, and `profile list` shows
// every profile with a link or a bio, for the operator to look over.
//
// `feedback draft` writes the title and the body of the GitHub issue for a piece of feedback, from
// a template, with the player's text and name alone: the operator creates the issue from them on a
// machine that reaches GitHub, which the server needn't, and then records its number with
// `feedback issue`. The other `feedback` commands are the operator's notes on what became of the
// feedback, which the status page shows (docs/architecture.md#feedback) and which only these
// commands change: `issue` records the GitHub issue it was published as; `resolve` the pull
// request that resolved it; `adopt` adopts it, which lists it among the feedback contributions on
// the home page at once (docs/architecture.md#feedback-contributions), by the name the player left
// or as anonymous, counted for the account they were logged in to, if any, with a sentence in
// each language on what they contributed, and says when the name is another account's username.
// Only feedback that is a GitHub issue may be adopted, and it keeps one. `describe` writes those
// sentences again; `close` and `reopen` record whether it was closed without being adopted;
// `delete` puts it in the trash, from which `restore` takes it back and the server deletes it for
// good after 30 days, and `trash` lists what is there. Feedback that was adopted can't be deleted,
// since the home page lists it, nor can feedback that is an issue, which is public and is closed
// instead. Nothing changes what a player sent, or deletes reports: those are archives
// (docs/architecture.md#feedback).
// `accounts` prints statistics of the accounts, counted as AccountStore says (store/accounts.ts),
// and never what the database keeps in place of passwords, email addresses and logins; `accounts
// bar` keeps an account out of public rooms, as for a player others reported, and `accounts unbar`
// lets it back in. `reports list` shows the latest reports that players sent of each other.
// `accounts`, `feedback draft`, `trash`, `reports list` and `profile list` only read.
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
  '  reports list',
].join('\n');

type Flags = { ban?: true; json?: true; zh?: string; en?: string };

// The words of a command and its flags: --ban and --json stand alone, and --zh and --en take a
// value. Anything else is a word, even when it begins with --, as a name may. Null for a flag that
// has no value.
function parse(args: readonly string[]): { words: string[]; flags: Flags } | null {
  const words: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === '--ban' || arg === '--json') {
      flags[arg.slice(2) as 'ban' | 'json'] = true;
    } else if (arg === '--zh' || arg === '--en') {
      if (i + 1 >= args.length) return null;
      flags[arg.slice(2) as 'zh' | 'en'] = args[(i += 1)] as string;
    } else {
      words.push(arg);
    }
  }
  return { words, flags };
}

interface Data {
  db: DatabaseSync;
  accounts: Accounts;
  feedback: FeedbackStore;
}

type Print = (line: string) => void;

interface Command {
  // How many words follow the one or two that name it.
  words: number;
  flags: (keyof Flags)[];
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
      `${`#${id}`.padStart(width)}  ${createdAt.slice(0, 10)}  ${String(games).padStart(5)}  ` +
        `${String(matches).padStart(7)}  ${username}` +
        (barred ? '  (barred from public rooms)' : ''),
    );
  }
}

// How many reports `reports list` shows, and how much feedback `feedback trash` shows, the latest.
const REPORTS_SHOWN = 100;
const TRASH_SHOWN = 100;

// How long feedback in the trash has left: "27 days left", "1 day left", or "0 days left" on the
// day the next purge takes it; or that it is kept, since it was adopted, which only feedback
// adopted on its way to the trash is (store/feedback.ts).
function trashTime(feedback: Feedback, daysLeft: number): string {
  if (feedback.adoptedAt !== null) return 'kept: thanked';
  return `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
}

// Feedback in the trash as the operator reads it, one line each: the id, the day it went in, how
// long it has left, its kind, and the start of its text on one line.
function trashLine(feedback: Feedback, daysLeft: number): string {
  // Cut by code points, so that an emoji isn't cut in two.
  const chars = Array.from(feedback.text.replace(/\n/g, ' / '));
  const text = chars.length > 60 ? `${chars.slice(0, 60).join('')}...` : chars.join('');
  return `#${feedback.id}  ${(feedback.deletedAt as string).slice(0, 10)}  ${trashTime(feedback, daysLeft)}  ${feedback.kind}  ${text}`;
}

// The way out of the trash, which a command that needs the feedback out of it points to.
const inTrash = (print: Print, { id }: Feedback) =>
  print(`Feedback #${id} is in the trash. Restore it first: feedback restore ${id}.`);

// A note taken on feedback in the trash, which may be a mistake, says where the feedback is.
const trashNote = (print: Print, { id, deletedAt }: Feedback) => {
  if (deletedAt !== null) print(`It is in the trash, by the way: feedback restore ${id} brings it back.`);
};

// One report as the operator reads it: the id, the date, who reported whom, in which room, and the
// note. The player reported is named as they were in the room, with their account, if they had one.
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
  const who =
    reported === null ? reportedName : `${reportedName} (account ${reported}${reportedBarred ? ', barred' : ''})`;
  return (
    `#${id}  ${createdAt.slice(0, 10)}  ${reporter ?? '(deleted account)'} reported ${who} in ${formatCode(roomCode)}` +
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

// The title: the kind, as the status page calls it, and the first line of the text, on one line
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
// blank line kept as a bare >, and who sent it: the name, or that the player left none.
function issueBody({ kind, text, credit }: Feedback): string {
  const quoted = text.split('\n').map((line) => (line === '' ? '>' : `> ${literal(line)}`));
  const sent = kind === 'bug' ? 'Reported' : 'Suggested';
  const who = credit === null ? 'Sent by an anonymous player.' : `${sent} by ${literal(credit)}.`;
  return [`${OPENINGS[kind]} that a player sent through the feedback form:`, '', ...quoted, '', who].join('\n');
}

// What the player contributed, from --zh and --en, which `feedback adopt` and `feedback describe`
// take both of, by the rules of shared/src/contributions.ts; or the code to end with when they are
// missing (a usage error) or break the rules.
function summaryOf({ zh, en }: Flags, print: Print): ContributionSummary | 1 | 2 {
  if (zh === undefined || en === undefined) {
    print('Say what the player contributed in both languages: --zh "<一句>" --en "<a sentence>".');
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
          `Feedback #${found.id} was adopted already, on ${found.adoptedAt.slice(0, 10)}. To say again what the ` +
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
      if (found.issue === null) {
        print(
          `Feedback #${found.id} is no GitHub issue. Every adopted piece of feedback is one: publish it first, or ` +
            `record one made by hand with feedback issue ${found.id} <number>.`,
        );
        return 1;
      }
      // The feedback was read a moment ago, so it has been adopted or put in the trash since only if
      // someone else is running a command at the same time.
      if (!data.feedback.adopt(found.id, summary)) {
        print(`Feedback #${found.id} was adopted or moved to the trash just now. Look at it again.`);
        return 1;
      }
      const as = found.credit === null ? 'as an anonymous player' : `as ${found.credit}`;
      print(
        `Adopted feedback #${found.id}, issue #${found.issue}. The home page lists it now, ${as}, ` +
          `${counted(found.username)}, saying that the player contributed:`,
      );
      printSummary(print, summary.zh, summary.en);
      // The name may be anyone's, but one that is another account's username may be someone passing
      // for its owner, which the status page points out too.
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
      if (!data.feedback.close(found.id)) {
        print(`Feedback #${found.id} is closed already.`);
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
      const entries = feedback.latest(TRASH_SHOWN, undefined, null, 'trash');
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
};

export function admin(args: readonly string[], env: NodeJS.ProcessEnv, print: Print): number {
  const parsed = parse(args);
  // A command is named by two words, as `avatar remove`, or by one, as `accounts`.
  const all = parsed?.words ?? [];
  const named = Object.hasOwn(COMMANDS, all.slice(0, 2).join(' ')) ? 2 : 1;
  const key = all.slice(0, named).join(' ');
  const command = Object.hasOwn(COMMANDS, key) ? COMMANDS[key] : undefined;
  const words = all.slice(named);
  if (
    !parsed ||
    !command ||
    words.length !== command.words ||
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
    const data: Data = {
      db,
      get accounts() {
        return (accounts ??= new Accounts({
          db,
          now: () => performance.now(),
          avatars: new DirectoryAvatars(join(dataDir, AVATAR_DIR), { owner: false }),
        }));
      },
      get feedback() {
        return (feedback ??= new FeedbackStore(db));
      },
    };
    return command.run(data, words, parsed.flags, print);
  } finally {
    db.close();
  }
}

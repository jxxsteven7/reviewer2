import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ACKNOWLEDGMENT_HEADINGS,
  ACKNOWLEDGMENT_KINDS,
  acknowledgmentLine,
  checkCredit,
  cleanName,
  formatCode,
  MAX_NAME_LENGTH,
  REPOSITORY_URL,
  usernameKey,
  type Acknowledgment,
  type AcknowledgmentKind,
} from '@reviewer2/shared';
import { AVATAR_DIR, DirectoryAvatars } from './accounts/avatars';
import { Accounts } from './accounts/service';
import { loadConfig } from './config';
import { AcknowledgmentStore, kindOfFeedback, type AcknowledgmentEntry } from './store/acknowledgments';
import { AccountStore } from './store/accounts';
import { BUSY_TIMEOUT_MS, DATABASE_FILE, schemaVersion } from './store/database';
import { FeedbackStore, type Feedback, type Report } from './store/feedback';
import { MIGRATIONS } from './store/migrations';

// The operator's commands (docs/development.md), which run beside the server on its data:
//
//   node server/dist/admin.cjs avatar remove <username> [--ban]
//   node server/dist/admin.cjs avatar allow <username>
//   node server/dist/admin.cjs accounts [--json]
//   node server/dist/admin.cjs accounts bar <username>
//   node server/dist/admin.cjs accounts unbar <username>
//   node server/dist/admin.cjs feedback adopt <id>
//   node server/dist/admin.cjs feedback issue <id> <number>|--clear
//   node server/dist/admin.cjs feedback resolve <id> <pr>|--clear
//   node server/dist/admin.cjs feedback close <id>
//   node server/dist/admin.cjs feedback reopen <id>
//   node server/dist/admin.cjs feedback delete <id>
//   node server/dist/admin.cjs feedback restore <id>
//   node server/dist/admin.cjs feedback trash
//   node server/dist/admin.cjs reports list
//   node server/dist/admin.cjs acknowledgments list
//   node server/dist/admin.cjs acknowledgments add <name> --kind <kind> [--account <username>]
//
// adminCli.ts runs this, as index.ts runs main.ts.
//
// `avatar remove` takes an account's avatar down, as for a picture that breaks the rules, and with
// --ban bars the account from uploading another; `avatar allow` lifts that. `feedback adopt`
// records that the feedback was adopted, counted for the account the player was logged in to if
// they left a name, and says when the name is another account's username; `acknowledgments add`
// thanks someone by hand, such as a playtester. Both print the entry for ACKNOWLEDGMENTS.md, the
// public list, which the operator completes and adds to the file. `list` shows the
// acknowledgments.
//
// The other `feedback` commands are the operator's notes on what became of the feedback, which
// the status page shows (docs/architecture.md#feedback) and which only these commands change:
// `issue` records the GitHub issue it was published as, which only feedback whose player agreed
// may be; `resolve` the pull request that resolved it, for any feedback; `close` and `reopen`
// whether it was closed without being adopted; `delete` puts it in the trash, from which `restore`
// takes it back and the server deletes it for good after 30 days, and `trash` lists what is there.
// Feedback that was adopted can't be deleted, since the acknowledgment points at it. Nothing
// changes what a player sent, deletes acknowledgments or reports, or changes who an
// acknowledgment is for or counted for: those are archives (docs/architecture.md#feedback).
// `accounts` prints statistics of the accounts, counted as AccountStore says (store/accounts.ts),
// and never what the database keeps in place of passwords, email addresses and logins; `accounts
// bar` keeps an account out of public rooms, as for a player others reported, and `accounts unbar`
// lets it back in. `reports list` shows the latest reports that players sent of each other.
// `accounts`, `list`, `trash` and `reports list` only read. DATA_DIR names the server's data, as
// it does for the server. The database is opened as it is, never migrated, and the server may go
// on running meanwhile.

const USAGE = [
  'usage: admin.cjs <command>, one of',
  '  avatar remove <username> [--ban]',
  '  avatar allow <username>',
  '  accounts [--json]',
  '  accounts bar <username>',
  '  accounts unbar <username>',
  '  feedback adopt <id>',
  '  feedback issue <id> <number>|--clear',
  '  feedback resolve <id> <pr>|--clear',
  '  feedback close <id>',
  '  feedback reopen <id>',
  '  feedback delete <id>',
  '  feedback restore <id>',
  '  feedback trash',
  '  reports list',
  '  acknowledgments list',
  `  acknowledgments add <name> --kind ${ACKNOWLEDGMENT_KINDS.join('|')} [--account <username>]`,
].join('\n');

type Flags = { ban?: true; json?: true; kind?: string; account?: string };

// The words of a command and its flags: --ban and --json stand alone, and --kind and --account
// take a value. Anything else is a word, even when it begins with --, as a name may. Null for a flag
// that has no value.
function parse(args: readonly string[]): { words: string[]; flags: Flags } | null {
  const words: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === '--ban' || arg === '--json') {
      flags[arg.slice(2) as 'ban' | 'json'] = true;
    } else if (arg === '--kind' || arg === '--account') {
      if (i + 1 >= args.length) return null;
      flags[arg.slice(2) as 'kind' | 'account'] = args[(i += 1)] as string;
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
  acknowledgments: AcknowledgmentStore;
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

// The entry for ACKNOWLEDGMENTS.md, under the heading of its kind, for the operator to say what
// the player did and to add it to the file.
function printEntry(print: Print, kind: AcknowledgmentKind, entry: Acknowledgment) {
  print(`For ACKNOWLEDGMENTS.md, under "## ${ACKNOWLEDGMENT_HEADINGS[kind]}", once you say what they did in English:`);
  print(acknowledgmentLine(entry));
}

const counted = (username: string | null | undefined) =>
  username ? `counted for the account ${username}` : 'counted for no account';

// The list as the operator reads it, one line each: the id, the date, the kind and the feedback it
// came from in columns, then the name and the account it is counted for. Those two come last, as
// the username does in `accounts`, so that the columns line up whatever the names are made of: a
// terminal shows a Chinese character two columns wide.
function listing(entries: readonly AcknowledgmentEntry[]): string {
  const rows = entries.map(({ id, creditedAt, kind, feedbackId }) => [
    `#${id}`,
    creditedAt.slice(0, 10),
    kind,
    feedbackId === null ? '-' : `feedback #${feedbackId}`,
  ]);
  const widths = rows[0]?.map((_, column) => Math.max(...rows.map((row) => (row[column] as string).length))) ?? [];
  return entries
    .map(({ name, username }, index) =>
      [
        ...(rows[index] as string[]).map((cell, column) => cell.padEnd(widths[column] as number)),
        (name === '' ? '(anonymous)' : name) + (username === null ? '' : `  (account ${username})`),
      ].join('  '),
    )
    .join('\n');
}

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
  print('Registered  Games  Matches  Username');
  for (const { username, createdAt, games, matches, barred } of accounts) {
    print(
      `${createdAt.slice(0, 10)}  ${String(games).padStart(5)}  ${String(matches).padStart(7)}  ${username}` +
        (barred ? '  (barred from public rooms)' : ''),
    );
  }
}

// How many reports `reports list` shows, and how much feedback `feedback trash` shows, the latest.
const REPORTS_SHOWN = 100;
const TRASH_SHOWN = 100;

// "27 days left", "1 day left", or "0 days left" on the day the next purge takes it.
const daysLeftText = (days: number) => `${days} day${days === 1 ? '' : 's'} left`;

// Feedback in the trash as the operator reads it, one line each: the id, the day it went in, how
// long it has left, its kind, and the start of its text on one line.
function trashLine(feedback: Feedback, daysLeft: number): string {
  const line = feedback.text.replace(/\n/g, ' / ');
  const text = line.length > 60 ? `${line.slice(0, 60)}...` : line;
  return `#${feedback.id}  ${(feedback.deletedAt as string).slice(0, 10)}  ${daysLeftText(daysLeft)}  ${feedback.kind}  ${text}`;
}

// The way out of the trash, which a command that needs the feedback out of it points to.
const inTrash = (print: Print, { id }: Feedback) =>
  print(`Feedback #${id} is in the trash. Restore it first: feedback restore ${id}.`);

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
  'feedback adopt': {
    words: 1,
    flags: [],
    run(data, [word], _flags, print) {
      const found = feedbackNumbered(data, word as string, print);
      if (!found) return 1;
      if (found.acknowledgmentId !== null) {
        print(`Feedback #${found.id} was adopted already, as acknowledgment #${found.acknowledgmentId}.`);
        return 1;
      }
      const kind = kindOfFeedback(found.kind);
      // Only a player who left a name is counted, for the account they were logged in to.
      const named = found.credit !== null;
      const made = data.acknowledgments.add({
        name: found.credit ?? '',
        kind,
        feedbackId: found.id,
        accountId: named ? found.accountId : null,
      });
      // The feedback was read a moment ago, so it has been adopted since only if someone else is
      // running this command at the same time.
      if (made === null) {
        print(`Feedback #${found.id} was adopted already.`);
        return 1;
      }
      print(
        `Adopted feedback #${found.id} as acknowledgment #${made}, for ${ACKNOWLEDGMENT_HEADINGS[kind]}, ` +
          (named ? `${counted(found.username)}.` : 'from a player who left no name.'),
      );
      // The name may be anyone's, but one that is another account's username may be someone passing
      // for its owner, which the status page points out too.
      if (found.nameTakenBy !== null) {
        print(
          `${found.credit} is also the username of the account ${found.nameTakenBy}, which didn't send the ` +
            'feedback. Make sure that they are the same person before you list the name.',
        );
      }
      // The entry links the issue, or the pull request when there is no issue.
      const number = found.issue ?? found.resolvedPr;
      printEntry(print, kind, {
        name: found.credit,
        link: found.link,
        contribution: `<what they did>${number === null ? '' : ` (#${number})`}`,
      });
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
        data.feedback.setIssue(found.id, null);
        print(`Feedback #${found.id} is no longer recorded as issue #${found.issue}.`);
        if (found.acknowledgmentId !== null) print(`Take (#${found.issue}) out of its entry in ACKNOWLEDGMENTS.md.`);
        return 0;
      }
      const issue = numberOf(numberWord as string);
      if (issue === null) {
        print(`${numberWord} is not the number of an issue.`);
        return 1;
      }
      if (found.publicIssue !== true) {
        print(`The player didn't agree to feedback #${found.id} being published as an issue.`);
        return 1;
      }
      data.feedback.setIssue(found.id, issue);
      print(
        `Feedback #${found.id} is issue #${issue}, ${REPOSITORY_URL}/issues/${issue}` +
          (found.issue === null || found.issue === issue ? '.' : `, no longer #${found.issue}.`),
      );
      // Adopted already, the feedback had its entry printed with the number recorded then, if any,
      // and the operator puts the entry right.
      if (found.acknowledgmentId !== null && found.issue !== issue) {
        print(
          found.issue === null
            ? `Put (#${issue}) at the end of its entry in ACKNOWLEDGMENTS.md.`
            : `Replace (#${found.issue}) with (#${issue}) in its entry in ACKNOWLEDGMENTS.md.`,
        );
      }
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
      if (found.deletedAt !== null) {
        print(`It is in the trash, by the way: feedback restore ${found.id} brings it back.`);
      }
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
          `Feedback #${found.id} is in the trash already, with ${daysLeftText(data.feedback.daysLeft(found) as number)}.`,
        );
        return 1;
      }
      // The acknowledgment points at the feedback it came from, which must stay for it.
      if (found.acknowledgmentId !== null) {
        print(
          `Feedback #${found.id} was adopted as acknowledgment #${found.acknowledgmentId}, which points at it, so it ` +
            `can't be deleted. Close it instead: feedback close ${found.id}.`,
        );
        return 1;
      }
      // Read a moment ago, it has been adopted since only if someone else is running `feedback
      // adopt` at the same time.
      if (!data.feedback.delete(found.id)) {
        print(`Feedback #${found.id} was adopted just now, so it stays.`);
        return 1;
      }
      print(
        `Moved feedback #${found.id} to the trash. The server deletes it for good in 30 days; ` +
          `feedback restore ${found.id} brings it back before then.`,
      );
      if (found.issue !== null) print(`Issue #${found.issue} stays as it is on GitHub; close it there if need be.`);
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
  'acknowledgments list': {
    words: 0,
    flags: [],
    readOnly: true,
    run({ acknowledgments }, _words, _flags, print) {
      const entries = acknowledgments.all();
      print(entries.length === 0 ? 'No acknowledgments yet.' : listing(entries));
      return 0;
    },
  },
  'acknowledgments add': {
    words: 1,
    flags: ['kind', 'account'],
    run(data, [raw], { kind, account: username }, print) {
      // By the rules of the name that a player leaves with their feedback.
      const { credit: name, problem } = checkCredit(raw);
      if (problem === 'credit_reserved') {
        print(`${raw} is a reserved name, which no nickname may be either.`);
        return 1;
      }
      if (name === null) {
        print(`The name must have 1 to ${MAX_NAME_LENGTH} visible characters, as a nickname does.`);
        return 1;
      }
      if (!(ACKNOWLEDGMENT_KINDS as readonly string[]).includes(kind ?? '')) {
        print(`--kind must be one of ${ACKNOWLEDGMENT_KINDS.join(', ')}.`);
        return 2;
      }
      const account = username === undefined ? null : accountNamed(data, username, print);
      if (account === undefined) return 1;
      const as = kind as AcknowledgmentKind;
      const id = data.acknowledgments.add({ name, kind: as, feedbackId: null, accountId: account?.id ?? null });
      print(`Added acknowledgment #${id}: ${name}, for ${ACKNOWLEDGMENT_HEADINGS[as]}, ${counted(account?.username)}.`);
      printEntry(print, as, { name, link: null, contribution: '<what they did>' });
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
    let acknowledgments: AcknowledgmentStore | undefined;
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
      get acknowledgments() {
        return (acknowledgments ??= new AcknowledgmentStore(db));
      },
    };
    return command.run(data, words, parsed.flags, print);
  } finally {
    db.close();
  }
}

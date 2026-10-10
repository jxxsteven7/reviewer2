import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ACKNOWLEDGMENT_KINDS,
  checkCredit,
  cleanName,
  MAX_NAME_LENGTH,
  usernameKey,
  type AcknowledgmentKind,
} from '@reviewer2/shared';
import { AVATAR_DIR, DirectoryAvatars } from './accounts/avatars';
import { Accounts } from './accounts/service';
import { loadConfig } from './config';
import { AcknowledgmentStore, kindOfFeedback, type AcknowledgmentEntry } from './store/acknowledgments';
import { AccountStore } from './store/accounts';
import { BUSY_TIMEOUT_MS, DATABASE_FILE, schemaVersion } from './store/database';
import { FeedbackStore } from './store/feedback';
import { MIGRATIONS } from './store/migrations';

// The operator's commands (docs/development.md), which run beside the server on its data:
//
//   node server/dist/admin.cjs avatar remove <username> [--ban]
//   node server/dist/admin.cjs avatar allow <username>
//   node server/dist/admin.cjs accounts [--json]
//   node server/dist/admin.cjs feedback adopt <id>
//   node server/dist/admin.cjs acknowledgments list
//   node server/dist/admin.cjs acknowledgments markdown
//   node server/dist/admin.cjs acknowledgments add <name> --kind <kind> [--account <username>]
//   node server/dist/admin.cjs acknowledgments link <id> <username>
//   node server/dist/admin.cjs acknowledgments unlink <id>
//   node server/dist/admin.cjs acknowledgments remove <id>
//
// adminCli.ts runs this, as index.ts runs main.ts.
//
// `avatar remove` takes an account's avatar down, as for a picture that breaks the rules, and with
// --ban bars the account from uploading another; `avatar allow` lifts that. `feedback adopt` puts
// the player who sent the feedback into the acknowledgments, by the name they left with it, linked
// to the account they were logged in to, and says so when the name is another account's username;
// `acknowledgments add` thanks someone by hand, such as a playtester; `link` and `unlink` change
// the account an acknowledgment is linked to, and `remove` takes one out. `list` shows them all,
// and `markdown` writes them as ACKNOWLEDGMENTS.md has them. `accounts` prints statistics of the
// accounts, counted as AccountStore says (store/accounts.ts), and never what the database keeps in
// place of passwords, email addresses and logins. `accounts`, `list` and `markdown` only read.
// DATA_DIR names the server's data, as it does for the server. The database is opened as it is,
// never migrated, and the server may go on running meanwhile.

const USAGE = [
  'usage: admin.cjs <command>, one of',
  '  avatar remove <username> [--ban]',
  '  avatar allow <username>',
  '  accounts [--json]',
  '  feedback adopt <id>',
  '  acknowledgments list',
  '  acknowledgments markdown',
  `  acknowledgments add <name> --kind ${ACKNOWLEDGMENT_KINDS.join('|')} [--account <username>]`,
  '  acknowledgments link <id> <username>',
  '  acknowledgments unlink <id>',
  '  acknowledgments remove <id>',
].join('\n');

// What each kind is called where the operator reads it, and in ACKNOWLEDGMENTS.md.
export const KIND_NAMES: Record<AcknowledgmentKind, string> = {
  feedback: 'Ideas and bug reports',
  words: 'Word lists',
  playtesting: 'Playtesting',
};

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

// An acknowledgment's id as typed, or null.
const idOf = (word: string): number | null => (/^\d{1,15}$/.test(word) ? Number(word) : null);

function accountNamed({ accounts }: Data, name: string, print: Print) {
  const account = accounts.store.byKey(usernameKey(cleanName(name) ?? name));
  if (!account) print(`No account is called ${name}.`);
  return account;
}

function acknowledgment({ acknowledgments }: Data, word: string, print: Print) {
  const id = idOf(word);
  const entry = id === null ? undefined : acknowledgments.byId(id);
  if (!entry) print(`There is no acknowledgment #${word}.`);
  return entry;
}

const describe = ({ id, name, kind }: AcknowledgmentEntry) => `acknowledgment #${id}, ${name} for ${KIND_NAMES[kind]}`;

// The list as the operator reads it, one line each: the id, the date, the kind and the feedback it
// came from in columns, then the name and the account it is linked to. Those two come last, as the
// username does in `accounts`, so that the columns line up whatever the names are made of: a
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
        username === null ? name : `${name}  (account ${username})`,
      ].join('  '),
    )
    .join('\n');
}

// A name as Markdown shows it, and nothing more: every ASCII punctuation character is escaped,
// so that a player's name can't make a link, a heading or an HTML tag of itself when the file
// is rendered.
const literal = (name: string) => name.replace(/[!-/:-@[-`{-~]/g, '\\$&');

// The list as ACKNOWLEDGMENTS.md has it: a section for each kind that has anyone in it.
export function markdown(entries: readonly AcknowledgmentEntry[]): string {
  const sections = ACKNOWLEDGMENT_KINDS.flatMap((kind) => {
    const names = entries.filter((entry) => entry.kind === kind);
    if (names.length === 0) return [];
    return [
      `## ${KIND_NAMES[kind]}\n\n${names
        .map(({ name, creditedAt }) => `- ${literal(name)}, ${creditedAt.slice(0, 10)}`)
        .join('\n')}`,
    ];
  });
  return sections.length === 0 ? '_No one yet._' : sections.join('\n\n');
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
  for (const { username, createdAt, games, matches } of accounts) {
    print(`${createdAt.slice(0, 10)}  ${String(games).padStart(5)}  ${String(matches).padStart(7)}  ${username}`);
  }
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
    run({ acknowledgments, feedback }, [word], _flags, print) {
      const id = idOf(word as string);
      const found = id === null ? undefined : feedback.byId(id);
      if (!found) {
        print(`There is no feedback #${word}.`);
        return 1;
      }
      if (found.acknowledgmentId !== null) {
        print(`Feedback #${id} was adopted already, as acknowledgment #${found.acknowledgmentId}.`);
        return 1;
      }
      if (found.credit === null) {
        print(`Feedback #${id} came without a name for the acknowledgments: the player stays anonymous.`);
        return 1;
      }
      const kind = kindOfFeedback(found.kind);
      const made = acknowledgments.add({
        name: found.credit,
        kind,
        feedbackId: found.id,
        accountId: found.accountId,
      });
      // The feedback was read a moment ago, so it has been adopted since only if someone else is
      // running this command at the same time.
      if (made === null) {
        print(`Feedback #${id} was adopted already.`);
        return 1;
      }
      const linked = found.username === null ? 'linked to no account' : `linked to the account ${found.username}`;
      print(`Adopted feedback #${id} as acknowledgment #${made}: ${found.credit} for ${KIND_NAMES[kind]}, ${linked}.`);
      // The name may be anyone's, but one that is another account's username may be someone passing
      // for its owner, which the status page points out too.
      if (found.nameTakenBy !== null) {
        print(
          `${found.credit} is also the username of the account ${found.nameTakenBy}, which didn't send the feedback. ` +
            `If they aren't the same person, take it out with: acknowledgments remove ${made}`,
        );
      }
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
  'acknowledgments markdown': {
    words: 0,
    flags: [],
    readOnly: true,
    run({ acknowledgments }, _words, _flags, print) {
      print(markdown(acknowledgments.all()));
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
      const id = data.acknowledgments.add({
        name,
        kind: kind as AcknowledgmentKind,
        feedbackId: null,
        accountId: account?.id ?? null,
      });
      print(
        `Added acknowledgment #${id}: ${name} for ${KIND_NAMES[kind as AcknowledgmentKind]}, ` +
          (account ? `linked to the account ${account.username}.` : 'linked to no account.'),
      );
      return 0;
    },
  },
  'acknowledgments link': {
    words: 2,
    flags: [],
    run(data, [word, username], _flags, print) {
      const entry = acknowledgment(data, word as string, print);
      if (!entry) return 1;
      const account = accountNamed(data, username as string, print);
      if (!account) return 1;
      data.acknowledgments.setAccount(entry.id, account.id);
      print(`Linked ${describe(entry)}, to the account ${account.username}.`);
      return 0;
    },
  },
  'acknowledgments unlink': {
    words: 1,
    flags: [],
    run(data, [word], _flags, print) {
      const entry = acknowledgment(data, word as string, print);
      if (!entry) return 1;
      data.acknowledgments.setAccount(entry.id, null);
      print(
        entry.username === null
          ? `${describe(entry)}, was linked to no account.`
          : `Unlinked ${describe(entry)}, from the account ${entry.username}.`,
      );
      return 0;
    },
  },
  'acknowledgments remove': {
    words: 1,
    flags: [],
    run(data, [word], _flags, print) {
      const entry = acknowledgment(data, word as string, print);
      if (!entry) return 1;
      data.acknowledgments.remove(entry.id);
      print(`Removed ${describe(entry)}.`);
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

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { cleanName, usernameKey } from '@reviewer2/shared';
import { AVATAR_DIR, DirectoryAvatars } from './accounts/avatars';
import { Accounts } from './accounts/service';
import { loadConfig } from './config';
import { AccountStore } from './store/accounts';
import { BUSY_TIMEOUT_MS, DATABASE_FILE, schemaVersion } from './store/database';
import { MIGRATIONS } from './store/migrations';

// The operator's commands (docs/development.md), which run beside the server on its data:
//
//   node server/dist/admin.cjs avatar remove <username> [--ban]
//   node server/dist/admin.cjs avatar allow <username>
//   node server/dist/admin.cjs accounts [--json]
//
// adminCli.ts runs this, as index.ts runs main.ts.
//
// `avatar remove` takes an account's avatar down, as for a picture that breaks the rules, and with
// --ban bars the account from uploading another; `avatar allow` lifts that. `accounts` prints
// statistics of the accounts: how many there are, how many were created on each of the last 30
// days, how many were active in the last 7 and 30 days, and every username with when it
// registered and how many games and matches it has finished. It prints no hashes, fingerprints
// or tokens: what the database keeps in place of passwords, email addresses and logins
// (store/migrations.ts) stays there. DATA_DIR names the server's data, as it does for the server.
// The database is opened as it is, never migrated, and the server may go on running meanwhile.

const USAGE =
  'usage: admin.cjs avatar remove <username> [--ban] | admin.cjs avatar allow <username> | admin.cjs accounts [--json]';

// The statistics, in the order that `--json` prints them.
function accountStats(store: AccountStore) {
  return {
    total: store.count(),
    active: { last7Days: store.activeWithin(7), last30Days: store.activeWithin(30) },
    createdByDay: store.createdByDay(30),
    accounts: store.list(),
  };
}

// The statistics as text: the counts, the days, and the accounts in a table with the username
// last, so that the columns line up whatever the username is made of.
function printAccountStats(store: AccountStore, print: (line: string) => void): void {
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

// What the arguments ask for, or null when they aren't a command.
type Command = { kind: 'accounts'; json: boolean } | { kind: 'remove' | 'allow'; name: string; ban: boolean };

function parse(args: readonly string[]): Command | null {
  const [group, command, name, ...flags] = args;
  if (group === 'accounts') {
    if (args.length > 2 || (command !== undefined && command !== '--json')) return null;
    return { kind: 'accounts', json: command === '--json' };
  }
  const ban = flags.includes('--ban');
  if (group !== 'avatar' || (command !== 'remove' && command !== 'allow') || !name) return null;
  if (flags.some((flag) => flag !== '--ban') || (ban && command !== 'remove')) return null;
  return { kind: command, name, ban };
}

export function admin(args: readonly string[], env: NodeJS.ProcessEnv, print: (line: string) => void): number {
  const command = parse(args);
  if (command === null) {
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
    if (schemaVersion(db) !== MIGRATIONS.length) {
      print(`The database is at schema version ${schemaVersion(db)}, and this build knows ${MIGRATIONS.length}.`);
      return 1;
    }
    if (command.kind === 'accounts') {
      if (command.json) print(JSON.stringify(accountStats(new AccountStore(db)), null, 2));
      else printAccountStats(new AccountStore(db), print);
      return 0;
    }
    const { name, ban } = command;
    const accounts = new Accounts({
      db,
      now: () => performance.now(),
      avatars: new DirectoryAvatars(join(dataDir, AVATAR_DIR), { owner: false }),
    });
    const account = accounts.store.byKey(usernameKey(cleanName(name) ?? name));
    if (!account) {
      print(`No account is called ${name}.`);
      return 1;
    }
    if (command.kind === 'allow') {
      accounts.store.setAvatarBanned(account.id, false);
      print(`${account.username} may upload an avatar again.`);
      return 0;
    }
    const file = accounts.takeDownAvatar(account.id, ban);
    print(
      file === null
        ? `${account.username} has the default avatar.`
        : `Took down /avatars/${file} of ${account.username}. Browsers, and a CDN in front of the site, ` +
            "may keep a copy for up to a year: purge that address from the CDN's cache too.",
    );
    if (ban) print(`${account.username} may not upload another avatar.`);
    return 0;
  } finally {
    db.close();
  }
}

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { cleanName, usernameKey } from '@reviewer2/shared';
import { AVATAR_DIR, DirectoryAvatars } from './accounts/avatars';
import { Accounts } from './accounts/service';
import { loadConfig } from './config';
import { BUSY_TIMEOUT_MS, DATABASE_FILE, schemaVersion } from './store/database';
import { MIGRATIONS } from './store/migrations';

// The operator's commands (docs/development.md), which run beside the server on its data:
//
//   node server/dist/admin.cjs avatar remove <username> [--ban]
//   node server/dist/admin.cjs avatar allow <username>
//
// adminCli.ts runs this, as index.ts runs main.ts.
//
// `avatar remove` takes an account's avatar down, as for a picture that breaks the rules, and with
// --ban bars the account from uploading another; `avatar allow` lifts that. DATA_DIR names the
// server's data, as it does for the server. The database is opened as it is, never migrated, and
// the server may go on running meanwhile.

const USAGE = 'usage: admin.cjs avatar remove <username> [--ban] | admin.cjs avatar allow <username>';

export function admin(args: readonly string[], env: NodeJS.ProcessEnv, print: (line: string) => void): number {
  const [group, command, name, ...flags] = args;
  const ban = flags.includes('--ban');
  if (group !== 'avatar' || !['remove', 'allow'].includes(command ?? '') || !name) {
    print(USAGE);
    return 2;
  }
  if (flags.some((flag) => flag !== '--ban') || (ban && command !== 'remove')) {
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
    if (command === 'allow') {
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

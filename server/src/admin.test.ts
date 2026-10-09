import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { jpeg } from '../test/images';
import { AVATAR_DIR, DirectoryAvatars } from './accounts/avatars';
import { Accounts } from './accounts/service';
import { admin } from './admin';
import { openDatabase, type Database } from './store/database';

// The operator's commands, on a data directory as the server leaves it.

let dir: string;
let database: Database;
let accounts: Accounts;
let printed: string[];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'reviewer2-admin-'));
  database = await openDatabase(dir);
  accounts = new Accounts({ db: database.db, now: () => 0, avatars: new DirectoryAvatars(join(dir, AVATAR_DIR)) });
  printed = [];
});

afterEach(() => {
  database.db.close();
  rmSync(dir, { recursive: true, force: true });
});

const run = (...args: string[]) => admin(args, { DATA_DIR: dir }, (line) => printed.push(line));

function annWithAvatar(): string {
  const ann = accounts.store.create('Ann Lee', 'ann lee', 'hash');
  if (!ann) throw new Error('no account');
  const file = accounts.avatars.save(jpeg(), 'jpeg');
  accounts.store.setAvatar(ann.id, file);
  return file;
}

describe('avatar remove', () => {
  test('takes the avatar down and deletes its file, while the server goes on', () => {
    const file = annWithAvatar();
    expect(run('avatar', 'remove', 'ANN LEE')).toBe(0);
    expect(printed[0]).toBe(
      `Took down /avatars/${file} of Ann Lee. Browsers and Cloudflare may keep a copy for up to a year: ` +
        "purge that address from Cloudflare's cache too.",
    );
    expect(accounts.store.byKey('ann lee')).toMatchObject({ avatar: null, avatarBanned: false });
    expect(existsSync(join(dir, AVATAR_DIR, file))).toBe(false);
    expect(run('avatar', 'remove', 'Ann Lee')).toBe(0);
    expect(printed[1]).toBe('Ann Lee has the default avatar.');
  });

  test('with --ban bars the account from uploading another, until avatar allow', () => {
    annWithAvatar();
    expect(run('avatar', 'remove', 'Ann Lee', '--ban')).toBe(0);
    expect(printed.at(-1)).toBe('Ann Lee may not upload another avatar.');
    expect(accounts.store.byKey('ann lee')?.avatarBanned).toBe(true);
    expect(run('avatar', 'allow', 'Ann Lee')).toBe(0);
    expect(accounts.store.byKey('ann lee')?.avatarBanned).toBe(false);
  });

  test('says so when there is no such account, no DATA_DIR or no such command', () => {
    expect(run('avatar', 'remove', 'Nobody')).toBe(1);
    expect(printed).toEqual(['No account is called Nobody.']);
    expect(admin(['avatar', 'remove', 'Ann'], {}, (line) => printed.push(line))).toBe(1);
    const empty = join(dir, 'empty');
    mkdirSync(empty);
    expect(admin(['avatar', 'remove', 'Ann'], { DATA_DIR: empty }, (line) => printed.push(line))).toBe(1);
    expect(printed.at(-1)).toBe(`There is no database in ${empty}.`);
    expect(readdirSync(empty)).toEqual([]);
    for (const args of [[], ['avatar'], ['avatar', 'delete', 'Ann'], ['avatar', 'allow', 'Ann', '--ban']]) {
      expect(run(...args), args.join(' ')).toBe(2);
    }
  });
});

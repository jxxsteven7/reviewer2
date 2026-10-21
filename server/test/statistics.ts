import type { DatabaseSync } from 'node:sqlite';
import { RECORDS_NOTICE_VERSION } from '@reviewer2/shared';
import { AccountStore } from '../src/store/accounts';
import { RecordStore } from '../src/store/records';
import { SessionStore } from '../src/store/sessions';
import { keepGame } from './keptGame';

// Accounts for the tests of the operator's statistics, by days before `now`: Ann registered 40
// days before and finished a game and a match 2 days before; Bob registered 10 days before and
// logged in then; Cy registered at `now` and has done nothing yet.

const DAY = 24 * 60 * 60_000;

export function addAccounts(db: DatabaseSync, now: number): void {
  let time = now - 40 * DAY;
  const clock = () => time;
  const accounts = new AccountStore(db, clock);
  const sessions = new SessionStore(db, clock);
  const records = new RecordStore(db, clock);
  const create = (name: string) => {
    const account = accounts.create(name, name.toLowerCase(), 'scrypt$hash', RECORDS_NOTICE_VERSION);
    if (!account) throw new Error(`${name} is taken`);
    return account;
  };
  const ann = create('Ann');
  time = now - 10 * DAY;
  const bob = create('Bob');
  sessions.create(new Uint8Array(32).fill(1), bob.id);
  time = now - 2 * DAY;
  keepGame(db, 'g1', {}, clock);
  records.add(ann.id, {
    game: 'keywords',
    gameId: 'g1',
    side: 'red',
    role: 'captain',
    result: 'won',
    place: 1,
    verdict: 'oral',
    points: 11,
  });
  records.addMatch(ann.id, { game: 'keywords', matchId: 'm1', games: 3, rank: 1, players: 4, score: 12 });
  time = now;
  create('Cy');
}

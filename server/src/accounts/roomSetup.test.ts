import { RECORDS_NOTICE_VERSION } from '@reviewer2/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../store/database';
import { Accounts } from './service';

// How an account's last room setup is kept (docs/architecture.md#accounts): a room's part whole,
// and a practice room's part as the room names it, so that a practice room with friends, which
// names no role, leaves the role of the last one for the player alone in place.

let accounts: Accounts;
let ann: number;

beforeEach(async () => {
  const { db } = await openDatabase(null);
  accounts = new Accounts({ db, now: () => 0 });
  const account = accounts.store.create('Ann', 'ann', 'h', RECORDS_NOTICE_VERSION);
  if (!account) throw new Error('no account');
  ann = account.id;
});

describe('the last room setup', () => {
  test('keeps a practice room with friends without a role, and leaves the role of one alone in place', () => {
    accounts.rememberRoomSetup(ann, 'keywords', { practice: { fields: ['ml'] } });
    expect(accounts.roomSetupOf(ann)).toEqual({ keywords: { practice: { fields: ['ml'] } } });
    accounts.rememberRoomSetup(ann, 'keywords', { practice: { role: 'guesser', fields: ['general'] } });
    accounts.rememberRoomSetup(ann, 'keywords', { practice: { fields: ['physics'] } });
    expect(accounts.roomSetupOf(ann)).toEqual({ keywords: { practice: { role: 'guesser', fields: ['physics'] } } });
    // A room's part stands beside the practice room's, and is replaced whole.
    const room = {
      language: 'en' as const,
      fields: ['general'],
      randomFields: false,
      match: null,
      public: false,
      play: true,
    };
    accounts.rememberRoomSetup(ann, 'keywords', { room });
    accounts.rememberRoomSetup(ann, 'keywords', { room: { ...room, public: true } });
    expect(accounts.roomSetupOf(ann)).toEqual({
      keywords: { room: { ...room, public: true }, practice: { role: 'guesser', fields: ['physics'] } },
    });
  });
});

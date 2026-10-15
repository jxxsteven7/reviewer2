import { CODE_ALPHABET, MAX_SCREENS } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import { fakeGame } from '../../test/fakeGame';
import { testWords } from '../../test/helpers';
import { clientIp, groupIp } from './clientIp';
import { newCode } from './codes';
import { isToken, memberKey, newToken } from './identity';
import { seededRng } from './random';
import { TokenBucket, WindowCounter } from './rateLimit';
import { MAX_BROWSERS, MAX_GUESTS, MAX_REMOVED, REMOVED_FOR_MS, type MemberAccount, type Room } from './room';
import { Rooms } from './rooms';

describe('room codes', () => {
  test('are 4 characters without I, L, O or U', () => {
    const rng = seededRng(9);
    for (let i = 0; i < 200; i += 1) expect(newCode(rng)).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}$/);
  });
});

describe('the list of rooms', () => {
  test('closing a room twice leaves the room alone that has its code by then', () => {
    // A generator that can be told what to draw next, so that the second room gets the code of
    // the first.
    const next: number[] = [];
    const drawn = seededRng(3);
    const rooms = new Rooms(testWords(), { int: (below) => next.shift() ?? drawn.int(below) }, () => 0);
    const create = () => {
      const created = rooms.create({
        game: fakeGame,
        language: 'en',
        fields: ['general'],
        key: 'a-member-key',
      });
      if (!created.ok) throw new Error(created.error);
      return created.room;
    };

    const first = create();
    rooms.close(first);
    next.push(...[...first.code].map((character) => CODE_ALPHABET.indexOf(character)));
    const second = create();
    expect(second.code).toBe(first.code);

    rooms.close(first);
    expect(rooms.find(first.code)).toBe(second);
    expect(rooms.size).toBe(1);
  });
});

describe('addresses', () => {
  test('come from the connection unless a proxy is trusted', () => {
    const headers = { 'x-forwarded-for': '203.0.113.9, 198.51.100.7' };
    expect(clientIp('10.0.0.2', headers, false)).toBe('10.0.0.2');
    expect(clientIp('10.0.0.2', headers, true)).toBe('198.51.100.7');
    expect(clientIp('10.0.0.2', {}, true)).toBe('10.0.0.2');
    expect(clientIp('10.0.0.2', { 'x-forwarded-for': ['203.0.113.9', '198.51.100.7'] }, true)).toBe('198.51.100.7');
  });

  test('group IPv6 by /64 and unwrap IPv4', () => {
    expect(groupIp('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(groupIp('2001:db8:0:1:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:0:1::/64');
    expect(groupIp('2001:DB8::1')).toBe('2001:db8:0:0::/64');
    expect(groupIp('2001:0db8:0000:0001::')).toBe('2001:db8:0:1::/64');
    expect(groupIp('::1')).toBe('0:0:0:0::/64');
    expect(groupIp('::')).toBe('0:0:0:0::/64');
  });

  test('are the same address however a proxy writes them', () => {
    // With a port, which changes with every connection.
    expect(groupIp('203.0.113.9:4711')).toBe('203.0.113.9');
    expect(groupIp('203.0.113.9:52000')).toBe('203.0.113.9');
    expect(groupIp('[2001:db8:0:1::7]:4711')).toBe('2001:db8:0:1::/64');
    expect(groupIp('[2001:db8:0:1::7]')).toBe('2001:db8:0:1::/64');
    expect(groupIp(' 203.0.113.9 ')).toBe('203.0.113.9');
    // With a zone.
    expect(groupIp('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    // IPv4 inside IPv6, in hexadecimal and written out in full.
    expect(groupIp('::ffff:c000:201')).toBe('192.0.2.1');
    expect(groupIp('0:0:0:0:0:ffff:c000:0201')).toBe('192.0.2.1');
    expect(groupIp('0000:0000:0000:0000:0000:FFFF:192.0.2.1')).toBe('192.0.2.1');
    expect(groupIp('::ffff:c633:6407')).toBe('198.51.100.7');
    // The same four groups in front of another prefix are not IPv4.
    expect(groupIp('64:ff9b::c000:201')).toBe('64:ff9b:0:0::/64');
  });

  test('are never made up from something that is no address', () => {
    for (const text of ['', 'unknown', '_hidden', '203.0.113', '203.0.113.9.1', '2001:db8::1::2', 'example.org:80']) {
      expect(groupIp(text), text).toBeNull();
    }
    // A forwarded entry that is no address leaves the proxy's own address to count.
    expect(clientIp('10.0.0.2', { 'x-forwarded-for': '203.0.113.9, unknown' }, true)).toBe('10.0.0.2');
    // And a connection without any address is counted with the others like it, not let off.
    expect(clientIp(undefined, {}, false)).toBe('unknown');
    expect(clientIp(undefined, { 'x-forwarded-for': 'unknown' }, true)).toBe('unknown');
  });
});

describe('identity', () => {
  test('tokens are 32 random bytes, and member keys are their hashes', () => {
    const token = newToken();
    expect(isToken(token)).toBe(true);
    expect(isToken('short')).toBe(false);
    expect(isToken(42)).toBe(false);
    expect(memberKey(token)).toBe(memberKey(token));
    expect(memberKey(token)).not.toContain(token);
    expect(memberKey(newToken())).not.toBe(memberKey(token));
  });
});

describe('rate limits', () => {
  test('a token bucket allows a burst, then refills over time', () => {
    let time = 0;
    const bucket = new TokenBucket(10, 3, () => time);
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true, false]);
    time += 100;
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
    time += 10_000;
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true, false]);
  });

  test('a clock that is set back locks nobody out', () => {
    let time = 100_000;
    const bucket = new TokenBucket(10, 3, () => time);
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true, false]);
    time -= 60_000;
    expect(bucket.take()).toBe(false); // nothing is owed, and nothing is given away either
    time += 100;
    expect(bucket.take()).toBe(true);

    const counter = new WindowCounter(2, 1000, () => time);
    counter.add('a');
    counter.add('a');
    expect(counter.allowed('a')).toBe(false);
    time -= 3_600_000;
    expect(counter.allowed('a')).toBe(true);
    counter.add('a');
    counter.add('a');
    expect(counter.allowed('a')).toBe(false);
    time += 1000;
    expect(counter.allowed('a')).toBe(true);
  });

  test('a window counter limits each key within its window', () => {
    let time = 0;
    const counter = new WindowCounter(2, 1000, () => time);
    counter.add('a');
    counter.add('a');
    expect(counter.allowed('a')).toBe(false);
    expect(counter.allowed('b')).toBe(true);
    time += 1000;
    expect(counter.allowed('a')).toBe(true);
    counter.prune();
  });

  test('a window counter takes one in one step, and gives it back', () => {
    let time = 0;
    const counter = new WindowCounter(2, 1000, () => time);
    expect([counter.take('a'), counter.take('a'), counter.take('a')]).toEqual([true, true, false]);
    counter.refund('a');
    expect(counter.take('a')).toBe(true);
    // Nothing is owed for a key that has nothing against it, nor once the window is over.
    counter.refund('b');
    expect(counter.allowed('b')).toBe(true);
    time += 1000;
    counter.refund('a');
    expect([counter.take('a'), counter.take('a'), counter.take('a')]).toEqual([true, true, false]);
  });
});

// A room with its chair, public or private, on a clock that a test moves. The chair is a guest
// unless they come with an account.
function roomOf(
  listed: boolean,
  clock: { now: number } = { now: 0 },
  as: { username: string; account: MemberAccount } | null = null,
) {
  const rooms = new Rooms(testWords(), seededRng(3), () => clock.now);
  const created = rooms.create({
    game: fakeGame,
    language: 'en',
    fields: ['general'],
    key: 'chair',
    public: listed,
    as,
  });
  if (!created.ok) throw new Error(created.error);
  return created.room;
}

// Bob's account, for a member who comes logged in.
const bob: { username: string; account: MemberAccount } = {
  username: 'Bob',
  account: { id: 1, handle: 'a1b2c3d4e5f6', avatar: null, rank: 'undergraduate', agents: false },
};

// A member who comes into a room, where the test expects them to be let in.
function joinOf(room: Room, ...args: Parameters<Room['join']>) {
  const joined = room.join(...args);
  if (!joined.ok) throw new Error(joined.error);
  return joined.member;
}

describe('guests', () => {
  test('are numbered in the order they first came in, and a member with an account has none', () => {
    const room = roomOf(false);
    joinOf(room, 'seat-1');
    const account = joinOf(room, 'account:bob', false, bob);
    joinOf(room, 'seat-2', true);
    expect(account).toMatchObject({ name: 'Bob', guest: null });
    const players = room.view({ screen: true }).players;
    expect(players.map(({ name, guest }) => ({ name, guest }))).toEqual([
      { name: 'Guest 1', guest: 1 },
      { name: 'Guest 2', guest: 2 },
      { name: 'Bob' },
      { name: 'Guest 3', guest: 3 },
    ]);
    // Bob's line in the view has no number at all, not even an undefined one.
    expect(players[2]).not.toHaveProperty('guest');
  });

  test('have their number again when they come back, and a number is never given twice', () => {
    const room = roomOf(false);
    const ann = joinOf(room, 'seat-a');
    const cat = joinOf(room, 'seat-c');
    expect([ann.guest, cat.guest]).toEqual([2, 3]);
    room.drop(ann.id);
    expect(joinOf(room, 'seat-d').guest).toBe(4);
    expect(joinOf(room, 'seat-a')).toMatchObject({ name: 'Guest 2', guest: 2 });
    // Nor when the guest with the highest number has left before the next one comes.
    room.drop(cat.id);
    expect(joinOf(room, 'seat-e').guest).toBe(5);
  });

  // No username may be a guest's name any more; an account named so from before stands beside the
  // guest with that number, as it is, since nothing goes by the names.
  test('stand beside an account named like one of them, from before no username could be', () => {
    const room = roomOf(false);
    const guest = joinOf(room, 'seat-a');
    const named = { username: 'Guest 2', account: { ...bob.account, id: 2 } };
    expect(joinOf(room, 'account:named', true, named)).toMatchObject({ name: 'Guest 2', guest: null });
    expect(guest).toMatchObject({ name: 'Guest 2', guest: 2 });
    // The account's name follows its username, whatever the guests are called.
    expect(room.updateAccount(guest.id, 'Guest 3', null, 'undergraduate', false)).toBe(false);
    const account = room.view({ screen: true }).players[2]?.id as string;
    expect(room.updateAccount(account, 'Guest 3', null, 'undergraduate', false)).toBe(true);
    expect(room.view({ screen: true }).players[2]).toMatchObject({ name: 'Guest 3' });
    expect(room.view({ screen: true }).players[2]).not.toHaveProperty('guest');
  });

  test('lose their number when they log in, which their browser has again as a guest', () => {
    const room = roomOf(false);
    const guest = joinOf(room, 'seat-a');
    room.attach(guest, 'socket-a');
    expect(room.adopt(guest.id, 'account:bob', 'Bob', bob.account)).toBe(true);
    expect(guest).toMatchObject({ key: 'account:bob', name: 'Bob', guest: null });
    expect(room.view({ screen: true }).players[1]).not.toHaveProperty('guest');
    // Bob logs out, and his browser comes back as the guest it was.
    room.drop(guest.id);
    expect(joinOf(room, 'seat-a')).toMatchObject({ name: 'Guest 2', guest: 2 });
    expect(joinOf(room, 'seat-b').guest).toBe(3);
  });

  test('are remembered up to a limit, the earliest forgotten first, who then comes back as a new guest', () => {
    // The chair has an account, so that the only guests are those who come and go.
    const room = roomOf(false, { now: 0 }, bob);
    room.drop(joinOf(room, 'first').id);
    for (let i = 0; i < MAX_GUESTS; i += 1) room.drop(joinOf(room, `seat-${i}`).id);
    expect(joinOf(room, 'seat-0').guest).toBe(2);
    expect(joinOf(room, 'first').guest).toBe(MAX_GUESTS + 2);
  });
});

describe('screens', () => {
  test('fill a room at five, but in a public room a key that has one only takes its place', () => {
    for (const listed of [false, true]) {
      const room = roomOf(listed);
      for (let i = 0; i < MAX_SCREENS; i += 1) expect(room.addScreen(`screen-${i}`, `key-${i}`)).toEqual([]);
      expect(room.screensFull('another')).toBe(true);
      expect(room.screensFull('key-0')).toBe(!listed);
    }
    const room = roomOf(true);
    expect(room.addScreen('screen-0', 'key-0')).toEqual([]);
    expect(room.addScreen('screen-1', 'key-0')).toEqual(['screen-0']);
    expect([...room.screens]).toEqual([['screen-1', 'key-0']]);
  });
});

describe('removals', () => {
  // A newcomer, connected from the browser with the key `browser-<i>`, whom the chair removes.
  function removeNewcomer(room: Room, i: number) {
    const joined = room.join(`seat-${i}`);
    if (!joined.ok) throw new Error(joined.error);
    room.attach(joined.member, `socket-${i}`, `browser-${i}`);
    return room.remove(joined.member.id);
  }

  test('last for good from a public room, and for two minutes from a private one, whatever it becomes', () => {
    const clock = { now: 0 };
    const listed = roomOf(true, clock);
    const unlisted = roomOf(false, clock);
    expect(removeNewcomer(listed, 1)).toMatchObject({ ok: true, reason: 'removed' });
    expect(removeNewcomer(unlisted, 1)).toMatchObject({ ok: true, reason: 'removed_recently' });
    // By the member key and by the browser's, as when either comes back.
    for (const key of ['seat-1', 'browser-1']) {
      expect(listed.refusal(key)).toBe('removed');
      expect(unlisted.refusal(key)).toBe('removed_recently');
    }
    // The room changes after the removal, which stays as it was.
    expect(listed.setPublic(false)).toEqual({ ok: true });
    expect(unlisted.setPublic(true)).toEqual({ ok: true });
    clock.now += REMOVED_FOR_MS - 1;
    expect(unlisted.removal('seat-1')).toBe('removed_recently');
    clock.now += 1;
    expect(unlisted.removal('seat-1', 'browser-1')).toBeNull();
    expect(unlisted.join('seat-1')).toMatchObject({ ok: true });
    clock.now += 24 * 60 * 60_000;
    listed.forgetOldRemovals();
    expect(listed.removal('nobody', 'browser-1')).toBe('removed');
    // A removal for good outweighs one that is still running, for a browser that had both.
    expect(removeNewcomer(listed, 2)).toMatchObject({ reason: 'removed_recently' });
    expect(listed.removal('seat-2', 'browser-1')).toBe('removed');
  });

  test('are remembered up to a limit, with every key of each, the earliest forgotten first', () => {
    const room = roomOf(true);
    // Each removal remembers the member's key and the key of the browser they were on, and
    // counts once, however many keys it has.
    for (let i = 0; i < MAX_REMOVED; i += 1) expect(removeNewcomer(room, i)).toMatchObject({ ok: true });
    expect(room.removal('seat-0')).toBe('removed');
    expect(room.removal('browser-0')).toBe('removed');
    expect(removeNewcomer(room, MAX_REMOVED)).toMatchObject({ ok: true });
    // The earliest removal goes with both of its keys.
    expect(room.removal('seat-0')).toBeNull();
    expect(room.removal('browser-0')).toBeNull();
    expect(room.removal('seat-1', 'browser-1')).toBe('removed');
    expect(room.removal(`browser-${MAX_REMOVED / 2}`)).toBe('removed');
    expect(room.removal('nobody', `browser-${MAX_REMOVED}`)).toBe('removed');
    expect(room.members.size).toBe(1);
  });

  test('keep a key that a later removal has when the earlier one is forgotten', () => {
    const clock = { now: 0 };
    const room = roomOf(false, clock);
    // A guest on browser 7 is removed, and then, two minutes later, an account on the same browser.
    expect(removeNewcomer(room, 7)).toMatchObject({ ok: true });
    clock.now += REMOVED_FOR_MS;
    const joined = room.join('account:bob', false, bob);
    if (!joined.ok) throw new Error(joined.error);
    room.attach(joined.member, 'socket-bob', 'browser-7');
    expect(room.remove(joined.member.id)).toMatchObject({ ok: true });
    // The sweep forgets the guest's removal, whose wait is over; the browser stays out by Bob's.
    room.forgetOldRemovals();
    expect(room.removal('seat-7')).toBeNull();
    expect(room.removal('browser-7')).toBe('removed_recently');
    expect(room.removal('account:bob')).toBe('removed_recently');
  });

  test('keep a member out by the last few browsers they were on, with or without a connection', () => {
    const room = roomOf(true);
    const joined = room.join('account:bob', false, bob);
    if (!joined.ok) throw new Error(joined.error);
    for (let i = 0; i <= MAX_BROWSERS; i += 1) {
      room.attach(joined.member, `socket-${i}`, `browser-${i}`);
      room.detach(`socket-${i}`);
    }
    expect(joined.member.browsers.size).toBe(MAX_BROWSERS);
    expect(room.remove(joined.member.id)).toMatchObject({ ok: true, sockets: [] });
    expect(room.removal('browser-0')).toBeNull();
    for (let i = 1; i <= MAX_BROWSERS; i += 1) expect(room.removal(`browser-${i}`)).toBe('removed');
  });

  test('from a private room are forgotten once their wait is over, before any for good', () => {
    const clock = { now: 0 };
    const room = roomOf(false, clock);
    for (let i = 0; i < MAX_REMOVED / 2; i += 1) removeNewcomer(room, i);
    clock.now += REMOVED_FOR_MS;
    expect(room.setPublic(true)).toEqual({ ok: true });
    // The waits that are over make room, so none of the removals for good is forgotten.
    for (let i = MAX_REMOVED; i < MAX_REMOVED + MAX_REMOVED / 2; i += 1) removeNewcomer(room, i);
    expect(room.removal(`seat-${MAX_REMOVED}`, `browser-${MAX_REMOVED + MAX_REMOVED / 2 - 1}`)).toBe('removed');
    expect(room.removal('seat-0')).toBeNull();
  });
});

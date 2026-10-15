import {
  FRIEND_LIMITS,
  INVITATION_MS,
  INVITE_COOLDOWN_MS,
  JOIN_ASK_MS,
  JOIN_ASKS_PER_HOUR,
  type FriendRoomView,
  type FriendsView,
} from '@reviewer2/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { Browser, startServer, TestClient, until, type TestServer } from './helpers';

// Friends and invitations over real sockets (docs/architecture.md#friends): requests and their
// answers, the limits, what friends learn of each other and nobody else does, the invitations that
// let a friend into a room, a private one too, for as long as they stand, and the requests to be
// let into a friend's room.

let server: TestServer;
const clients: TestClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await server.close();
});

const track = (client: TestClient) => {
  clients.push(client);
  return client;
};

// A browser logged in to a new account, with a connection of its own.
async function person(name: string): Promise<{ browser: Browser; client: TestClient }> {
  const browser = new Browser(server.url);
  const reply = await browser.register(name);
  if (!reply.body.ok) throw new Error(`could not register ${name}: ${String(reply.body.error)}`);
  return { browser, client: track(await browser.connect()) };
}

const listOf = async (client: TestClient): Promise<FriendsView> => {
  const reply = await client.send('friends:list');
  if (!reply.ok) throw new Error(reply.error);
  const { ok, ...view } = reply;
  void ok;
  return view as unknown as FriendsView;
};

// Ann asks Bob, who accepts.
async function befriend(ann: TestClient, bob: TestClient, bobName = 'Bob', annName = 'Ann') {
  expect(await ann.send('friends:request', { username: bobName })).toEqual({ ok: true, status: 'pending' });
  expect(await bob.send('friends:accept', { username: annName })).toEqual({ ok: true });
}

const roomsOf = async (client: TestClient): Promise<FriendRoomView[]> => {
  const reply = await client.send('friends:rooms');
  if (!reply.ok) throw new Error(reply.error);
  return reply.rooms as FriendRoomView[];
};

async function roomOf(browser: Browser, payload: Record<string, unknown> = {}) {
  const chair = track(await browser.connect());
  const reply = await chair.send('room:create', { game: 'test', language: 'en', fields: ['general'], ...payload });
  if (!reply.ok) throw new Error(`could not create a room: ${reply.error}`);
  await chair.waitFor((state) => state.code === reply.code);
  return { chair, code: reply.code as string, roomId: reply.roomId as string };
}

describe('a friend request', () => {
  test('is sent by username, waits for the answer, and makes friends once accepted', async () => {
    server = await startServer();
    const { client: ann } = await person('Ann');
    const { client: bob } = await person('Bob');
    // In any case or width, as names are compared.
    expect(await ann.send('friends:request', { username: '  BOB ' })).toEqual({ ok: true, status: 'pending' });
    await until(() => bob.friendsChanged === 1, 'Bob to hear of it');
    expect(await listOf(ann)).toEqual({
      friends: [],
      incoming: [],
      outgoing: [{ handle: expect.any(String), username: 'Bob', avatar: null }],
    });
    expect(await listOf(bob)).toEqual({
      friends: [],
      incoming: [{ handle: expect.any(String), username: 'Ann', avatar: null }],
      outgoing: [],
    });
    // Nobody is friends yet, and Ann can't answer her own request.
    expect(await ann.send('friends:request', { username: 'Bob' })).toEqual({ ok: false, error: 'request_pending' });
    expect(await ann.send('friends:accept', { username: 'Bob' })).toEqual({ ok: false, error: 'no_such_request' });

    expect(await bob.send('friends:accept', { username: 'Ann' })).toEqual({ ok: true });
    await until(() => ann.friendsChanged === 2, 'Ann to hear of it');
    expect((await listOf(ann)).friends).toEqual([
      { handle: expect.any(String), username: 'Bob', avatar: null, online: true, room: null, duo: null },
    ]);
    expect((await listOf(bob)).friends).toEqual([
      { handle: expect.any(String), username: 'Ann', avatar: null, online: true, room: null, duo: null },
    ]);
    expect(await ann.send('friends:request', { username: 'Bob' })).toEqual({ ok: false, error: 'already_friends' });
  });

  test('to someone who asked already accepts theirs, and goes to a player in the room by their ID', async () => {
    server = await startServer();
    const { client: ann } = await person('Ann');
    const { browser: bobs } = await person('Bob');
    const { chair: bob, code } = await roomOf(bobs);
    expect(await ann.send('room:join', { code, play: false })).toMatchObject({ ok: true });
    const state = await ann.waitFor((view) => view.players.length === 2);
    const bobId = state.players.find(({ name }) => name === 'Bob')?.id as string;
    expect(await bob.send('friends:request', { username: 'Ann' })).toEqual({ ok: true, status: 'pending' });
    expect(await ann.send('friends:request', { playerId: bobId })).toEqual({ ok: true, status: 'accepted' });
    expect((await listOf(ann)).friends.map(({ username }) => username)).toEqual(['Bob']);
    // A player who has left, or has no account, can't be asked; nor can oneself.
    expect(await ann.send('friends:request', { playerId: 'nobody' })).toEqual({ ok: false, error: 'no_such_player' });
    const guest = track(await TestClient.connect(server.url));
    expect(await guest.send('room:join', { code, play: false })).toMatchObject({ ok: true });
    const { players } = await ann.waitFor((view) => view.players.length === 3);
    const guestId = players.find((player) => player.guest === 1)?.id as string;
    expect(await ann.send('friends:request', { playerId: guestId })).toEqual({ ok: false, error: 'no_such_account' });
    expect(await ann.send('friends:request', { username: 'Ann' })).toEqual({ ok: false, error: 'self_friend' });
    expect(await ann.send('friends:request', { username: 'Nobody' })).toEqual({ ok: false, error: 'no_such_account' });
    expect(await ann.send('friends:request', {})).toEqual({ ok: false, error: 'bad_request' });
    // A guest has no friends.
    expect(await guest.send('friends:list')).toEqual({ ok: false, error: 'account_required' });
    expect(await guest.send('friends:request', { username: 'Ann' })).toEqual({ ok: false, error: 'account_required' });
  });

  test('can be declined, which keeps whoever was declined from asking again for a week, or taken back', async () => {
    const clock = { now: Date.UTC(2026, 9, 12) };
    server = await startServer({ clock: () => clock.now });
    const { client: ann } = await person('Ann');
    const { client: bob } = await person('Bob');
    expect(await ann.send('friends:request', { username: 'Bob' })).toEqual({ ok: true, status: 'pending' });
    expect(await bob.send('friends:decline', { username: 'Ann' })).toEqual({ ok: true });
    expect(await listOf(bob)).toEqual({ friends: [], incoming: [], outgoing: [] });
    expect(await ann.send('friends:request', { username: 'Bob' })).toEqual({ ok: false, error: 'request_declined' });
    clock.now += FRIEND_LIMITS.declineCooldownMs;
    expect(await ann.send('friends:request', { username: 'Bob' })).toEqual({ ok: true, status: 'pending' });
    // Bob, who declined, may ask at any time, which is his to take back; Ann can't answer it then.
    expect(await bob.send('friends:decline', { username: 'Ann' })).toEqual({ ok: true });
    expect(await bob.send('friends:request', { username: 'Ann' })).toEqual({ ok: true, status: 'pending' });
    expect(await bob.send('friends:remove', { username: 'Ann' })).toEqual({ ok: true });
    expect(await ann.send('friends:accept', { username: 'Bob' })).toEqual({ ok: false, error: 'no_such_request' });
    expect(await ann.send('friends:decline', { username: 'Bob' })).toEqual({ ok: false, error: 'no_such_request' });
    expect(await ann.send('friends:remove', { username: 'Bob' })).toEqual({ ok: false, error: 'no_such_request' });
  });

  test('is answered the same about a name that is no account and about one with no request', async () => {
    server = await startServer();
    const { client: ann } = await person('Ann');
    const { browser: bobs } = await person('Bob');
    // Only a request by username says whether a name is an account's, at the cost of one of the
    // day's requests; an answer, an ending or an invitation about a name that is nobody's is answered
    // as if it were a stranger's.
    for (const message of ['friends:accept', 'friends:decline', 'friends:remove'] as const) {
      expect(await ann.send(message, { username: 'Bob' })).toEqual({ ok: false, error: 'no_such_request' });
      expect(await ann.send(message, { username: 'Nobody' })).toEqual({ ok: false, error: 'no_such_request' });
    }
    const { chair } = await roomOf(bobs);
    expect(await chair.send('friends:invite', { username: 'Ann' })).toEqual({ ok: false, error: 'not_friends' });
    expect(await chair.send('friends:invite', { username: 'Nobody' })).toEqual({ ok: false, error: 'not_friends' });
  });

  test('to a player in the room costs one of the day when it goes out, and by username whatever comes of it', async () => {
    server = await startServer({ friendLimits: { requestsPerDay: 2 } });
    const { client: ann } = await person('Ann');
    const { browser: bobs } = await person('Bob');
    await person('Cat');
    const { chair: bob, code } = await roomOf(bobs);
    expect(await ann.send('room:join', { code, play: false })).toMatchObject({ ok: true });
    const guest = track(await TestClient.connect(server.url));
    expect(await guest.send('room:join', { code, play: false })).toMatchObject({ ok: true });
    const state = await ann.waitFor((view) => view.players.length === 3);
    const idOf = (name: string) => state.players.find((player) => player.name === name)?.id as string;
    // Asking a guest, or a player who isn't there, sends nothing and costs nothing; nor does asking
    // Bob again and again once he is a friend: he has an account, as his rank in the room says.
    expect(await ann.send('friends:request', { playerId: idOf('Guest 1') })).toEqual({
      ok: false,
      error: 'no_such_account',
    });
    expect(await ann.send('friends:request', { playerId: 'nobody' })).toEqual({ ok: false, error: 'no_such_player' });
    expect(await ann.send('friends:request', { playerId: idOf('Bob') })).toEqual({ ok: true, status: 'pending' });
    expect(await bob.send('friends:accept', { username: 'Ann' })).toEqual({ ok: true });
    for (let i = 0; i < 3; i += 1) {
      expect(await ann.send('friends:request', { playerId: idOf('Bob') })).toEqual({
        ok: false,
        error: 'already_friends',
      });
    }
    expect(await ann.send('friends:request', { username: 'Cat' })).toEqual({ ok: true, status: 'pending' });
    expect(await ann.send('friends:request', { username: 'Cat' })).toEqual({ ok: false, error: 'friend_limited' });
  });

  test('counts against the day, whether or not it finds an account, and against the requests open', async () => {
    server = await startServer({ friendLimits: { requestsPerDay: 4, maxOutgoing: 2, maxIncoming: 2 } });
    const { client: ann } = await person('Ann');
    for (const name of ['Bob', 'Cat', 'Dan', 'Eve']) await person(name);
    expect(await ann.send('friends:request', { username: 'Nobody' })).toEqual({ ok: false, error: 'no_such_account' });
    expect(await ann.send('friends:request', { username: 'Bob' })).toEqual({ ok: true, status: 'pending' });
    expect(await ann.send('friends:request', { username: 'Cat' })).toEqual({ ok: true, status: 'pending' });
    expect(await ann.send('friends:request', { username: 'Dan' })).toEqual({
      ok: false,
      error: 'friend_requests_full',
    });
    expect(await ann.send('friends:request', { username: 'Dan' })).toEqual({ ok: false, error: 'friend_limited' });
    server.advance(24 * 60 * 60_000);
    // Dan may hear from two people at once, and no more.
    const { client: eve } = await person('Eve2');
    const { client: fay } = await person('Fay');
    expect(await eve.send('friends:request', { username: 'Dan' })).toEqual({ ok: true, status: 'pending' });
    expect(await fay.send('friends:request', { username: 'Dan' })).toEqual({ ok: true, status: 'pending' });
    expect(await ann.send('friends:remove', { username: 'Bob' })).toEqual({ ok: true });
    expect(await ann.send('friends:request', { username: 'Dan' })).toEqual({
      ok: false,
      error: 'friend_requests_full',
    });
  });

  test('is refused once either side has as many friends as an account may', async () => {
    server = await startServer({ friendLimits: { maxFriends: 1 } });
    const { client: ann } = await person('Ann');
    const { client: bob } = await person('Bob');
    const { client: cat } = await person('Cat');
    await befriend(ann, bob);
    expect(await cat.send('friends:request', { username: 'Ann' })).toEqual({ ok: false, error: 'friends_full' });
    expect(await cat.send('friends:request', { username: 'Bob' })).toEqual({ ok: false, error: 'friends_full' });
    // A request that was open when the other side filled up can't be accepted either.
    const { client: dan } = await person('Dan');
    expect(await cat.send('friends:request', { username: 'Dan' })).toEqual({ ok: true, status: 'pending' });
    const { client: eve } = await person('Eve');
    await befriend(dan, eve, 'Eve', 'Dan');
    expect(await dan.send('friends:accept', { username: 'Cat' })).toEqual({ ok: false, error: 'friends_full' });
    expect(await dan.send('friends:request', { username: 'Cat' })).toEqual({ ok: false, error: 'friends_full' });
  });
});

describe('the search by username', () => {
  test('finds an account by its whole name, in any case or width, and nobody by a part of it', async () => {
    server = await startServer();
    const { client: ann } = await person('Ann');
    const { browser: bobs } = await person('Bobby');
    const bob = (await bobs.account()) as { handle: string };
    const found = { ok: true, handle: bob.handle, username: 'Bobby' };
    expect(await ann.send('friends:find', { username: 'Bobby' })).toEqual(found);
    expect(await ann.send('friends:find', { username: '  ＢＯＢＢＹ ' })).toEqual(found);
    expect(await ann.send('friends:find', { username: 'Bob' })).toEqual({ ok: false, error: 'no_such_account' });
    // Oneself too: the page says so.
    expect(await ann.send('friends:find', { username: 'ann' })).toMatchObject({ ok: true, username: 'Ann' });
    // Nothing for a guest, and nothing that isn't a name.
    const guest = track(await TestClient.connect(server.url));
    expect(await guest.send('friends:find', { username: 'Bobby' })).toEqual({ ok: false, error: 'account_required' });
    expect(await ann.send('friends:find', {})).toEqual({ ok: false, error: 'bad_request' });
  });

  test('costs one of the hour, whether or not it finds an account, and none of the day of requests', async () => {
    server = await startServer({ friendLimits: { findsPerHour: 3, requestsPerDay: 1 } });
    const { client: ann } = await person('Ann');
    await person('Bob');
    expect(await ann.send('friends:find', { username: 'Nobody' })).toEqual({ ok: false, error: 'no_such_account' });
    expect(await ann.send('friends:find', { username: 'Bob' })).toMatchObject({ ok: true });
    expect(await ann.send('friends:find', { username: 'Nobody' })).toEqual({ ok: false, error: 'no_such_account' });
    expect(await ann.send('friends:find', { username: 'Bob' })).toEqual({ ok: false, error: 'friend_find_limited' });
    // The request still has the day's one.
    expect(await ann.send('friends:request', { username: 'Bob' })).toEqual({ ok: true, status: 'pending' });
    // Another account has an hour of its own, and the hour passes.
    const { client: cat } = await person('Cat');
    expect(await cat.send('friends:find', { username: 'Bob' })).toMatchObject({ ok: true });
    server.advance(60 * 60_000);
    expect(await ann.send('friends:find', { username: 'Bob' })).toMatchObject({ ok: true });
  });
});

describe('the line with a friend request', () => {
  test('goes to the account asked alone, and is gone once the request is answered', async () => {
    server = await startServer();
    const { client: ann } = await person('Ann');
    const { client: bob } = await person('Bob');
    const { client: cat } = await person('Cat');
    // Cleaned as a line of the chat is, at most 50 characters, and refused before it costs a request.
    expect(await ann.send('friends:request', { username: 'Bob', note: 'x'.repeat(51) })).toEqual({
      ok: false,
      error: 'friend_note_too_long',
    });
    expect(await ann.send('friends:request', { username: 'Bob', note: ' We met at\nthe workshop ' })).toEqual({
      ok: true,
      status: 'pending',
    });
    expect(await cat.send('friends:request', { username: 'Bob', note: ' ' })).toEqual({ ok: true, status: 'pending' });
    expect((await listOf(bob)).incoming).toEqual([
      { handle: expect.any(String), username: 'Ann', avatar: null, note: 'We met at the workshop' },
      { handle: expect.any(String), username: 'Cat', avatar: null },
    ]);
    // Ann, who sent it, doesn't see it again.
    expect((await listOf(ann)).outgoing).toEqual([{ handle: expect.any(String), username: 'Bob', avatar: null }]);
    // Once answered, nobody reads it: the database no longer has it.
    expect(await bob.send('friends:accept', { username: 'Ann' })).toEqual({ ok: true });
    expect(await bob.send('friends:decline', { username: 'Cat' })).toEqual({ ok: true });
    expect(server.db.prepare('SELECT note FROM friendships').all()).toEqual([{ note: null }, { note: null }]);
  });
});

describe('the name an account gives a friend', () => {
  test('is for the account alone, for a friend alone, and goes with the friendship', async () => {
    server = await startServer();
    const { client: ann } = await person('Ann');
    const { browser: bobs, client: bob } = await person('Bob');
    await person('Cat');
    await befriend(ann, bob);
    const before = bob.friendsChanged;
    expect(await ann.send('friends:alias', { username: 'Bob', alias: '  Bobby  the  Chair ' })).toEqual({ ok: true });
    expect((await listOf(ann)).friends[0]).toMatchObject({ username: 'Bob', alias: 'Bobby the Chair' });
    // Bob is told nothing, and sees nothing of it.
    expect(bob.friendsChanged).toBe(before);
    expect((await listOf(bob)).friends[0]).not.toHaveProperty('alias');
    // It comes with Bob's invitations to Ann, to Ann alone.
    const { chair } = await roomOf(bobs);
    expect(await chair.send('friends:invite', { username: 'Ann' })).toEqual({ ok: true });
    await until(() => ann.invitations.length === 1, 'the invitation');
    expect(ann.invitations[0]?.from).toEqual({ username: 'Bob', alias: 'Bobby the Chair', avatar: null });
    // The rules of a nickname, with up to 20 characters.
    expect(await ann.send('friends:alias', { username: 'Bob', alias: 'x'.repeat(21) })).toEqual({
      ok: false,
      error: 'friend_alias_too_long',
    });
    expect(await ann.send('friends:alias', { username: 'Bob', alias: 'Bo\u200bb' })).toEqual({
      ok: false,
      error: 'friend_alias_invalid',
    });
    // Only for a friend; a name that is no account's is answered as a stranger's.
    for (const username of ['Cat', 'Nobody']) {
      expect(await ann.send('friends:alias', { username, alias: 'Kitty' })).toEqual({
        ok: false,
        error: 'not_friends',
      });
    }
    // An empty one takes it away; ending the friendship takes both sides' away.
    expect(await bob.send('friends:alias', { username: 'Ann', alias: 'Annie' })).toEqual({ ok: true });
    expect(await ann.send('friends:alias', { username: 'Bob', alias: '' })).toEqual({ ok: true });
    expect((await listOf(ann)).friends[0]).not.toHaveProperty('alias');
    expect(await ann.send('friends:alias', { username: 'Bob', alias: 'Bobby' })).toEqual({ ok: true });
    expect(await ann.send('friends:remove', { username: 'Bob' })).toEqual({ ok: true });
    await befriend(ann, bob);
    expect((await listOf(ann)).friends[0]).not.toHaveProperty('alias');
    expect((await listOf(bob)).friends[0]).not.toHaveProperty('alias');
  });
});

describe('friends', () => {
  test('see whether the other is online, on any device, and in which public room, and nobody else does', async () => {
    server = await startServer();
    const { client: ann } = await person('Ann');
    const { browser: bobs, client: bob } = await person('Bob');
    const { client: cat } = await person('Cat');
    await befriend(ann, bob);
    expect(await ann.send('friends:request', { username: 'Cat' })).toEqual({ ok: true, status: 'pending' });
    // Bob makes a private room, which Ann only hears he is in, and then lists it.
    const { chair, code } = await roomOf(bobs);
    expect((await listOf(ann)).friends).toEqual([
      { handle: expect.any(String), username: 'Bob', avatar: null, online: true, room: { code: null }, duo: null },
    ]);
    expect(await chair.send('room:public', { public: true })).toEqual({ ok: true });
    expect((await listOf(ann)).friends).toEqual([
      { handle: expect.any(String), username: 'Bob', avatar: null, online: true, room: { code }, duo: null },
    ]);
    // Cat, who is not a friend, learns nothing of where Ann or Bob are: the request names them only.
    expect(await listOf(cat)).toEqual({
      friends: [],
      incoming: [{ handle: expect.any(String), username: 'Ann', avatar: null }],
      outgoing: [],
    });
    // Bob's other connection goes; his seat and his presence stay with the one that is left.
    bob.close();
    await until(() => chair.state !== undefined, 'the chair to be in');
    expect((await listOf(ann)).friends[0]).toMatchObject({ online: true, room: { code } });
    chair.close();
    await until(() => server.app.rooms.find(code)?.onlineCount() === 0, 'Bob to go offline');
    expect((await listOf(ann)).friends).toEqual([
      { handle: expect.any(String), username: 'Bob', avatar: null, online: false, room: null, duo: null },
    ]);
  });

  test('part when either removes the other, and when an account is deleted', async () => {
    server = await startServer();
    const { client: ann } = await person('Ann');
    const { browser: bobs, client: bob } = await person('Bob');
    const { client: cat } = await person('Cat');
    await befriend(ann, bob);
    await befriend(cat, ann, 'Ann', 'Cat');
    expect((await listOf(ann)).friends.map(({ username }) => username)).toEqual(['Bob', 'Cat']);
    expect(await bob.send('friends:remove', { username: 'Ann' })).toEqual({ ok: true });
    await until(() => ann.friendsChanged >= 3, 'Ann to hear of it');
    expect((await listOf(ann)).friends.map(({ username }) => username)).toEqual(['Cat']);
    expect(await ann.send('friends:request', { username: 'Bob' })).toEqual({ ok: true, status: 'pending' });
    // Ann's page hears of it when Bob, whom it names, is renamed, and when his account goes.
    const heard = ann.friendsChanged;
    expect((await bobs.request('/api/account/username', { username: 'Robert' })).body).toEqual({ ok: true });
    await until(() => ann.friendsChanged === heard + 1, 'Ann to hear of the new name');
    expect((await listOf(ann)).outgoing).toEqual([{ handle: expect.any(String), username: 'Robert', avatar: null }]);
    expect((await bobs.request('/api/account/delete', { password: 'correct horse' })).body).toEqual({ ok: true });
    await until(() => ann.friendsChanged === heard + 2, 'Ann to hear of the deletion');
    expect(await listOf(ann)).toEqual({
      friends: [{ handle: expect.any(String), username: 'Cat', avatar: null, online: true, room: null, duo: null }],
      incoming: [],
      outgoing: [],
    });
  });
});

describe('an invitation', () => {
  test('goes to a friend, once a minute, and lets them into a private room', async () => {
    server = await startServer();
    const { browser: anns, client: ann } = await person('Ann');
    const { client: bob } = await person('Bob');
    const { browser: cats, client: cat } = await person('Cat');
    await person('Dan');
    await befriend(ann, bob);
    await befriend(ann, cat, 'Cat');
    const { chair, code, roomId } = await roomOf(anns);
    // Only a member may invite, and only a friend may be invited, online or not: one who is offline
    // hears of it as they come, while it stands.
    expect(await ann.send('friends:invite', { username: 'Bob' })).toEqual({ ok: false, error: 'not_member' });
    expect(await chair.send('friends:invite', { username: 'Dan' })).toEqual({ ok: false, error: 'not_friends' });
    cat.close();
    await expect
      .poll(async () => (await listOf(chair)).friends.find(({ username }) => username === 'Cat')?.online)
      .toBe(false);
    expect(await chair.send('friends:invite', { username: 'Cat' })).toEqual({ ok: true });
    const catAgain = track(await cats.connect());
    await until(() => catAgain.invitations.length === 1, "Cat's invitation as she comes");
    expect(await chair.send('friends:invite', { username: 'Bob' })).toEqual({ ok: true });
    // The inviter sees whom they invited, the oldest first, and nobody else does.
    await chair.waitFor((state) => state.invited?.length === 2, 'whom Ann invited');
    expect(chair.state?.invited).toEqual([
      { username: 'Cat', avatar: null },
      { username: 'Bob', avatar: null },
    ]);
    expect(await chair.send('friends:invite', { username: 'Bob' })).toEqual({ ok: false, error: 'invite_cooldown' });
    await until(() => bob.invitations.length === 1, 'the invitation');
    const [invitation] = bob.invitations;
    expect(invitation).toEqual({
      id: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
      code,
      roomId,
      from: { username: 'Ann', avatar: null },
      expiresInMs: INVITATION_MS,
    });
    // Bob comes in with the invitation alone, and is asked whether he plays, as any newcomer is.
    expect(await bob.send('room:join', { invitation: invitation?.id })).toEqual({
      ok: false,
      error: 'play_required',
      language: 'en',
    });
    expect(await bob.send('room:join', { invitation: invitation?.id, play: true })).toEqual({ ok: true, code, roomId });
    // Bob is in the room, so Ann's view has Cat alone left to come.
    await chair.waitFor((state) => state.players.length === 2 && state.invited?.length === 1, 'Bob in the room');
    expect(chair.state?.invited).toEqual([{ username: 'Cat', avatar: null }]);
    expect(bob.state).not.toHaveProperty('invited');
    // Bob is in the room already, so there is no inviting him again.
    server.advance(INVITE_COOLDOWN_MS);
    expect(await chair.send('friends:invite', { username: 'Bob' })).toEqual({ ok: false, error: 'friend_in_room' });
    // A join that names neither a code nor an invitation is no request at all.
    expect(await bob.send('room:join', {})).toEqual({ ok: false, error: 'bad_request' });
  });

  test("lets a friend into a private room with the chair's own words, which stay with the chair", async () => {
    server = await startServer();
    const { browser: anns, client: ann } = await person('Ann');
    const { client: bob } = await person('Bob');
    await befriend(ann, bob);
    const { chair, code, roomId } = await roomOf(anns);
    expect(await chair.send('room:settings', { words: 'Alpha, Beta, Gamma' })).toEqual({ ok: true });
    await chair.waitFor((state) => state.customWordCount === 3, 'the count');
    // A room with the chair's own words stays private, so the invitation is the way in.
    expect(await chair.send('room:public', { public: true })).toEqual({ ok: false, error: 'custom_words_private' });
    expect(await chair.send('friends:invite', { username: 'Bob' })).toEqual({ ok: true });
    await until(() => bob.invitations.length === 1, 'the invitation');
    expect(await bob.send('room:join', { invitation: bob.invitations[0]?.id, play: true })).toEqual({
      ok: true,
      code,
      roomId,
    });
    await bob.waitFor((state) => state.code === code && state.customWordCount === 3, 'the room');
    // Bob hears how many words there are, as any player does, and none of them, by any message.
    expect(bob.state).not.toHaveProperty('customWords');
    expect(JSON.stringify([bob.states, bob.invitations])).not.toMatch(/Alpha|Beta|Gamma/);
  });

  test('is used up when the friend comes in, and goes when they ignore it or the two part', async () => {
    server = await startServer();
    const { browser: anns, client: ann } = await person('Ann');
    const { browser: bobs, client: bob } = await person('Bob');
    const { browser: cats, client: cat } = await person('Cat');
    const { client: dan } = await person('Dan');
    await befriend(ann, bob);
    await befriend(ann, cat, 'Cat');
    await befriend(ann, dan, 'Dan');
    const { chair, code, roomId } = await roomOf(anns);
    expect(await chair.send('friends:invite', { username: 'Bob' })).toEqual({ ok: true });
    expect(await chair.send('friends:invite', { username: 'Cat' })).toEqual({ ok: true });
    await until(() => bob.invitations.length === 1 && cat.invitations.length === 1, 'the invitations');
    const invited = () => chair.state?.invited?.map(({ username }) => username) ?? [];
    expect(invited()).toEqual(['Bob', 'Cat']);
    const bobsFirst = bob.invitations[0]?.id as string;
    const catsFirst = cat.invitations[0]?.id as string;
    // Bob comes in with his. Every connection of his hears that it is used up, and his next
    // connection hears nothing of it: he is in the room, and comes back by the code, with the
    // invitation still in hand or not, even once it would have lapsed.
    const bobsTablet = track(await bobs.connect());
    await until(() => bobsTablet.invitations.length === 1, "Bob's invitation on the tablet");
    expect(await bob.send('room:join', { invitation: bobsFirst, play: true })).toEqual({ ok: true, code, roomId });
    await until(
      () => bob.uninvited.includes(bobsFirst) && bobsTablet.uninvited.includes(bobsFirst),
      'word that the invitation was used up',
    );
    const phone = track(await bobs.connect());
    await phone.send('sys:ping');
    expect(phone.invitations).toEqual([]);
    expect(await phone.send('room:join', { code, roomId, invitation: bobsFirst })).toEqual({ ok: true, code, roomId });
    server.advance(INVITATION_MS);
    expect(await bob.send('room:join', { code, invitation: bobsFirst })).toEqual({ ok: true, code, roomId });
    expect(await cat.send('room:join', { code, invitation: catsFirst, play: true })).toEqual({
      ok: false,
      error: 'invitation_expired',
    });
    // Cat ignores a fresh one, which only she can: a connection of hers that comes then hears
    // nothing of it, and it is no good to come in with.
    expect(await chair.send('friends:invite', { username: 'Cat' })).toEqual({ ok: true });
    expect(await chair.send('friends:invite', { username: 'Dan' })).toEqual({ ok: true });
    await until(() => cat.invitations.length === 2 && dan.invitations.length === 1, 'the next invitations');
    const catsSecond = cat.invitations[1]?.id as string;
    expect(await dan.send('friends:ignore', { id: catsSecond })).toEqual({ ok: true });
    await cat.send('sys:ping');
    // Cat has heard of her first alone, which lapsed as the clock moved.
    expect(cat.uninvited).toEqual([catsFirst]);
    const tablet = track(await cats.connect());
    await until(() => tablet.invitations.length === 1, "Cat's invitation on the tablet");
    expect(await cat.send('friends:ignore', { id: catsSecond })).toEqual({ ok: true });
    await until(() => tablet.uninvited.includes(catsSecond), 'the tablet hearing that it was ignored');
    // The inviter sees the room anew, with Cat no longer waited for.
    await until(() => invited().join() === 'Dan', 'the inviter hearing that Cat ignored it');
    const laptop = track(await cats.connect());
    await laptop.send('sys:ping');
    expect(laptop.invitations).toEqual([]);
    expect(await cat.send('room:join', { invitation: catsSecond, play: true })).toEqual({
      ok: false,
      error: 'invitation_expired',
    });
    // Ann and Dan part, and the invitation goes with the friendship: the sweep finds it, and the
    // inviter then waits for nobody.
    expect(await ann.send('friends:remove', { username: 'Dan' })).toEqual({ ok: true });
    expect(await dan.send('room:join', { invitation: dan.invitations[0]?.id, play: true })).toEqual({
      ok: false,
      error: 'invitation_expired',
    });
    server.app.sockets.sweep();
    await chair.waitFor((state) => state.invited === undefined, 'the inviter waiting for nobody');
  });

  test('reaches a friend who is offline only if they come online before it lapses', async () => {
    server = await startServer();
    const { browser: anns, client: ann } = await person('Ann');
    const { browser: cats, client: cat } = await person('Cat');
    await befriend(ann, cat, 'Cat');
    const { chair } = await roomOf(anns);
    cat.close();
    await expect
      .poll(async () => (await listOf(chair)).friends.find(({ username }) => username === 'Cat')?.online)
      .toBe(false);
    expect(await chair.send('friends:invite', { username: 'Cat' })).toEqual({ ok: true });
    await chair.waitFor((state) => state.invited?.length === 1, 'whom Ann invited');
    // Cat comes too late: no connection of hers hears of it, and the inviter waits for nobody, as
    // soon as it lapsed.
    server.advance(INVITATION_MS);
    await chair.waitFor((state) => state.invited === undefined, 'the inviter hearing that it lapsed');
    const late = track(await cats.connect());
    await late.send('sys:ping');
    expect(late.invitations).toEqual([]);
  });

  test('lapses after ten minutes, when the inviter leaves or when the room closes', async () => {
    server = await startServer();
    const { browser: anns, client: ann } = await person('Ann');
    const { client: bob } = await person('Bob');
    const { client: cat } = await person('Cat');
    await befriend(ann, bob);
    await befriend(ann, cat, 'Cat');
    const { chair, code } = await roomOf(anns);
    expect(await chair.send('friends:invite', { username: 'Bob' })).toEqual({ ok: true });
    await until(() => bob.invitations.length === 1, 'the invitation');
    const old = bob.invitations[0]?.id as string;
    await chair.waitFor((state) => state.invited?.length === 1, 'whom Ann invited');
    // Lapsed by its age: it ends as it lapses, with no sweep, and Bob hears so, while the inviter,
    // who had Bob among those invited, has nobody now. A connection of Bob's that comes now hears
    // nothing of it.
    server.advance(INVITATION_MS);
    await until(() => bob.uninvited.includes(old), 'word of the lapsed invitation');
    await chair.waitFor((state) => state.invited === undefined, 'the inviter hearing that it lapsed');
    expect(await bob.send('room:join', { invitation: old })).toEqual({ ok: false, error: 'invitation_expired' });
    const bobsPhone = new Browser(server.url);
    await bobsPhone.logIn('Bob');
    const phone = track(await bobsPhone.connect());
    await phone.send('sys:ping');
    expect(phone.invitations).toEqual([]);
    // A connection of the invited account that comes while an invitation stands hears it, with the
    // time it has left; a friend's invitation is no good to anyone else.
    expect(await chair.send('friends:invite', { username: 'Bob' })).toEqual({ ok: true });
    await until(() => bob.invitations.length === 2 && phone.invitations.length === 1, 'the second invitation');
    const fresh = bob.invitations[1]?.id as string;
    server.advance(60_000);
    const laptop = track(await bobsPhone.connect());
    await until(() => laptop.invitations.length === 1, 'the invitation on the laptop');
    expect(laptop.invitations[0]).toMatchObject({ id: fresh, expiresInMs: INVITATION_MS - 60_000 });
    expect(await cat.send('room:join', { invitation: fresh })).toEqual({ ok: false, error: 'invitation_expired' });
    // Lapsed because the inviter left.
    expect(await chair.send('friends:invite', { username: 'Cat' })).toEqual({ ok: true });
    await until(() => cat.invitations.length === 1, "Cat's invitation");
    const guest = track(await TestClient.connect(server.url));
    expect(await guest.send('room:join', { code, play: false })).toMatchObject({ ok: true });
    expect(await chair.send('room:leave')).toEqual({ ok: true });
    expect(await cat.send('room:join', { invitation: cat.invitations[0]?.id })).toEqual({
      ok: false,
      error: 'invitation_expired',
    });
    expect(await phone.send('room:join', { invitation: fresh, play: true })).toEqual({
      ok: false,
      error: 'invitation_expired',
    });
    // The sweep finds the invitations that have lapsed otherwise, and every connection of the
    // invited hears so.
    server.app.sockets.sweep();
    await until(() => cat.uninvited.length === 1 && phone.uninvited.length === 1, 'word of the lapsed invitations');
    expect(cat.uninvited).toEqual([cat.invitations[0]?.id]);
    expect(phone.uninvited).toEqual([fresh]);
    expect(bob.uninvited).toEqual([old, fresh]);
    // Lapsed because the room closed.
    const { chair: again } = await roomOf(anns);
    server.advance(INVITE_COOLDOWN_MS);
    expect(await again.send('friends:invite', { username: 'Cat' })).toEqual({ ok: true });
    await until(() => cat.invitations.length === 2, "Cat's second invitation");
    expect(await again.send('room:close')).toEqual({ ok: true });
    expect(await cat.send('room:join', { invitation: cat.invitations[1]?.id, play: true })).toEqual({
      ok: false,
      error: 'invitation_expired',
    });
  });

  test('does not get past the chair, nor into a public room without the account', async () => {
    server = await startServer();
    const { browser: anns, client: ann } = await person('Ann');
    const { client: bob } = await person('Bob');
    await befriend(ann, bob);
    const { chair, code } = await roomOf(anns);
    expect(await chair.send('friends:invite', { username: 'Bob' })).toEqual({ ok: true });
    await until(() => bob.invitations.length === 1, 'the invitation');
    expect(await bob.send('room:join', { invitation: bob.invitations[0]?.id, play: true })).toMatchObject({ ok: true });
    const state = await chair.waitFor((view) => view.players.length === 2, 'Bob in the room');
    const bobId = state.players.find(({ name }) => name === 'Bob')?.id as string;
    expect(await chair.send('room:remove', { playerId: bobId })).toEqual({ ok: true });
    await until(() => bob.closed.includes('removed_recently'), 'Bob to be told');
    // Nobody invites Bob while the removal lasts, which keeps him out by the code as before.
    server.advance(INVITE_COOLDOWN_MS);
    expect(await chair.send('friends:invite', { username: 'Bob' })).toEqual({ ok: false, error: 'friend_removed' });
    expect(await bob.send('room:join', { code, play: true })).toEqual({ ok: false, error: 'removed_recently' });
    // The operator bars Bob from public rooms, and the room is public: the invitation changes nothing.
    server.accounts.store.setPublicBarred(2, true);
    const { chair: listed } = await roomOf(anns, { public: true });
    server.advance(INVITE_COOLDOWN_MS);
    expect(await listed.send('friends:invite', { username: 'Bob' })).toEqual({ ok: true });
    await until(() => bob.invitations.length === 2, 'the second invitation');
    expect(await bob.send('room:join', { invitation: bob.invitations[1]?.id, play: true })).toEqual({
      ok: false,
      error: 'public_barred',
    });
  });
});

describe("a request to be let into a friend's room", () => {
  test('goes to the friend without the code, and the invitation that answers it lets the account in', async () => {
    server = await startServer();
    const { browser: anns, client: ann } = await person('Ann');
    const { client: bob } = await person('Bob');
    const { browser: catBrowser, client: cat } = await person('Cat');
    await befriend(ann, bob);
    await befriend(cat, bob, 'Bob', 'Cat');
    const { chair, code, roomId } = await roomOf(anns);
    // Bob sees the private room that Ann is in, without its code, and Cat's public one with it; a
    // friend in no room isn't there.
    const { code: catsCode } = await roomOf(catBrowser, { public: true });
    const listed = await roomsOf(bob);
    const annRow = { handle: expect.any(String), username: 'Ann', avatar: null };
    expect(listed).toEqual(
      expect.arrayContaining([
        { code: null, playing: false, friends: [annRow] },
        { code: catsCode, playing: false, friends: [{ ...annRow, username: 'Cat' }] },
      ]),
    );
    expect(listed).toHaveLength(2);
    expect(JSON.stringify(await listOf(bob))).not.toContain(code);
    // Bob asks Ann to be let in: every connection of Ann's hears it, with the room it is about, and
    // Bob's pages hear that he has asked.
    const heard = bob.friendsChanged;
    expect(await bob.send('friends:ask', { username: 'Ann' })).toEqual({ ok: true });
    await until(() => ann.asks.length === 1 && chair.asks.length === 1, 'Ann to hear of it');
    expect(chair.asks[0]).toEqual({
      id: expect.any(String),
      roomId,
      from: { username: 'Bob', avatar: null },
      expiresInMs: JOIN_ASK_MS,
    });
    await until(() => bob.friendsChanged === heard + 1, 'Bob to hear of it');
    expect((await listOf(bob)).friends.find(({ username }) => username === 'Ann')).toMatchObject({ asked: true });
    expect((await roomsOf(bob)).find(({ code }) => code === null)?.friends).toEqual([{ ...annRow, asked: true }]);
    // One at a time to the same friend; Cat's room is someone else's.
    expect(await bob.send('friends:ask', { username: 'Ann' })).toEqual({ ok: false, error: 'join_ask_pending' });
    expect(await bob.send('friends:ask', { username: 'Cat' })).toEqual({ ok: true });
    // Ann's alias for Bob goes with the request to her.
    expect(await ann.send('friends:alias', { username: 'Bob', alias: 'Bobby' })).toEqual({ ok: true });
    const phone = track(await anns.connect());
    await until(() => phone.asks.length === 1, 'the request on a new connection');
    expect(phone.asks[0]?.from).toEqual({ username: 'Bob', alias: 'Bobby', avatar: null });
    // Ann invites Bob, which answers his request: her pages take it down, and his offer to ask again.
    expect(await chair.send('friends:invite', { username: 'Bob' })).toEqual({ ok: true });
    await until(() => chair.unasked.length === 1 && bob.invitations.length === 1, 'the answer');
    expect(chair.unasked).toEqual([chair.asks[0]?.id]);
    expect((await listOf(bob)).friends.find(({ username }) => username === 'Ann')?.asked).toBeUndefined();
    expect(await bob.send('room:join', { invitation: bob.invitations[0]?.id, play: true })).toMatchObject({ ok: true });
    // In the room, Bob sees its code beside Ann, and the home page leaves it out.
    expect((await listOf(bob)).friends.find(({ username }) => username === 'Ann')?.room).toEqual({ code });
    expect((await roomsOf(bob)).map(({ code }) => code)).toEqual([catsCode]);
    expect(await bob.send('friends:ask', { username: 'Ann' })).toEqual({ ok: false, error: 'already_in_room' });
  });

  test('ends when ignored, after ten minutes, when the friend leaves and when the room closes', async () => {
    server = await startServer();
    const { browser: anns, client: ann } = await person('Ann');
    const { client: bob } = await person('Bob');
    await befriend(ann, bob);
    const { chair } = await roomOf(anns);
    const ask = async (count: number) => {
      expect(await bob.send('friends:ask', { username: 'Ann' })).toEqual({ ok: true });
      await until(() => ann.asks.length === count, `request ${count}`);
      return ann.asks[count - 1]?.id as string;
    };
    // Ignored: only Ann's pages hear of it, and Bob's that he may ask again.
    const first = await ask(1);
    const heard = bob.friendsChanged;
    expect(await ann.send('friends:dismiss', { id: first })).toEqual({ ok: true });
    await until(() => chair.unasked.length === 1 && bob.friendsChanged === heard + 1, 'the request to go');
    // Lapsed by its age: asking again finds it gone, and a new connection of Ann's hears nothing of it.
    const second = await ask(2);
    server.advance(JOIN_ASK_MS);
    const late = track(await anns.connect());
    await late.send('sys:ping');
    expect(late.asks).toEqual([]);
    const third = await ask(3);
    expect(ann.unasked).toEqual([first, second]);
    // Ann leaves the room: the sweep finds the request gone, and she can't be asked again.
    expect(await chair.send('room:leave')).toEqual({ ok: true });
    server.app.sockets.sweep();
    await until(() => ann.unasked.length === 3, 'the request to lapse');
    expect(ann.unasked[2]).toBe(third);
    expect(await bob.send('friends:ask', { username: 'Ann' })).toEqual({ ok: false, error: 'friend_not_in_room' });
    // The room closes.
    const { chair: again } = await roomOf(anns);
    const fourth = await ask(4);
    expect(await again.send('room:close')).toEqual({ ok: true });
    server.app.sockets.sweep();
    await until(() => ann.unasked.length === 4, 'the request to lapse with the room');
    expect(ann.unasked[3]).toBe(fourth);
  });

  test('is for friends, ten an hour, and not from whoever the chair removed', async () => {
    server = await startServer();
    const { browser: anns, client: ann } = await person('Ann');
    const { client: bob } = await person('Bob');
    const { client: cat } = await person('Cat');
    await befriend(ann, bob);
    const { chair } = await roomOf(anns);
    expect(await cat.send('friends:ask', { username: 'Ann' })).toEqual({ ok: false, error: 'not_friends' });
    expect(await cat.send('friends:ask', { username: 'Nobody' })).toEqual({ ok: false, error: 'not_friends' });
    const guest = track(await TestClient.connect(server.url));
    expect(await guest.send('friends:ask', { username: 'Ann' })).toEqual({ ok: false, error: 'account_required' });
    expect(await guest.send('friends:rooms')).toEqual({ ok: false, error: 'account_required' });
    // Asking and being ignored, as often as the hour allows.
    for (let count = 1; count <= JOIN_ASKS_PER_HOUR; count += 1) {
      expect(await bob.send('friends:ask', { username: 'Ann' })).toEqual({ ok: true });
      await until(() => ann.asks.length === count, `request ${count}`);
      expect(await ann.send('friends:dismiss', { id: ann.asks[count - 1]?.id })).toEqual({ ok: true });
    }
    expect(await bob.send('friends:ask', { username: 'Ann' })).toEqual({ ok: false, error: 'join_ask_limited' });
    server.advance(60 * 60_000);
    expect(await bob.send('friends:ask', { username: 'Ann' })).toEqual({ ok: true });
    await until(() => ann.asks.length === JOIN_ASKS_PER_HOUR + 1, 'the last request');
    // A request to Ann is not Bob's to dismiss.
    expect(await bob.send('friends:dismiss', { id: ann.asks[JOIN_ASKS_PER_HOUR]?.id })).toEqual({ ok: true });
    expect(await bob.send('friends:ask', { username: 'Ann' })).toEqual({ ok: false, error: 'join_ask_pending' });
    // Bob comes into the room by an invitation, and is removed: he can't ask his way back in.
    expect(await chair.send('friends:invite', { username: 'Bob' })).toEqual({ ok: true });
    await until(() => bob.invitations.length === 1, 'the invitation');
    expect(await bob.send('room:join', { invitation: bob.invitations[0]?.id, play: true })).toMatchObject({ ok: true });
    const state = await chair.waitFor((view) => view.players.length === 2, 'Bob in the room');
    expect(await chair.send('room:remove', { playerId: state.players.find(({ name }) => name === 'Bob')?.id })).toEqual(
      { ok: true },
    );
    await until(() => bob.closed.includes('removed_recently'), 'Bob to be told');
    expect(await bob.send('friends:ask', { username: 'Ann' })).toEqual({ ok: false, error: 'removed_recently' });
  });
});

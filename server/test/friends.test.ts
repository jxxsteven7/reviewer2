import { FRIEND_LIMITS, INVITATION_MS, INVITE_COOLDOWN_MS, type FriendsView } from '@reviewer2/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { Browser, startServer, TestClient, until, type TestServer } from './helpers';

// Friends and invitations over real sockets (docs/architecture.md#friends): requests and their
// answers, the limits, what friends learn of each other and nobody else does, and the invitations
// that let a friend into a room, a private one too, for as long as they stand.

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
      outgoing: [{ username: 'Bob', avatar: null }],
    });
    expect(await listOf(bob)).toEqual({
      friends: [],
      incoming: [{ username: 'Ann', avatar: null }],
      outgoing: [],
    });
    // Nobody is friends yet, and Ann can't answer her own request.
    expect(await ann.send('friends:request', { username: 'Bob' })).toEqual({ ok: false, error: 'request_pending' });
    expect(await ann.send('friends:accept', { username: 'Bob' })).toEqual({ ok: false, error: 'no_such_request' });

    expect(await bob.send('friends:accept', { username: 'Ann' })).toEqual({ ok: true });
    await until(() => ann.friendsChanged === 2, 'Ann to hear of it');
    expect((await listOf(ann)).friends).toEqual([{ username: 'Bob', avatar: null, online: true, room: null }]);
    expect((await listOf(bob)).friends).toEqual([{ username: 'Ann', avatar: null, online: true, room: null }]);
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
    expect(await guest.send('room:join', { code, name: 'Cat', play: false })).toMatchObject({ ok: true });
    const catId = (await ann.waitFor((view) => view.players.length === 3)).players.find(({ name }) => name === 'Cat')
      ?.id as string;
    expect(await ann.send('friends:request', { playerId: catId })).toEqual({ ok: false, error: 'no_such_account' });
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
    const state = await ann.waitFor((view) => view.players.length === 2);
    const bobId = state.players.find(({ name }) => name === 'Bob')?.id as string;
    // Bob has an account, as his rank in the room says, so asking him again and again costs nothing.
    expect(await ann.send('friends:request', { playerId: bobId })).toEqual({ ok: true, status: 'pending' });
    expect(await bob.send('friends:accept', { username: 'Ann' })).toEqual({ ok: true });
    for (let i = 0; i < 3; i += 1) {
      expect(await ann.send('friends:request', { playerId: bobId })).toEqual({ ok: false, error: 'already_friends' });
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
      { username: 'Bob', avatar: null, online: true, room: { code: null } },
    ]);
    expect(await chair.send('room:public', { public: true })).toEqual({ ok: true });
    expect((await listOf(ann)).friends).toEqual([{ username: 'Bob', avatar: null, online: true, room: { code } }]);
    // Cat, who is not a friend, learns nothing of where Ann or Bob are: the request names them only.
    expect(await listOf(cat)).toEqual({ friends: [], incoming: [{ username: 'Ann', avatar: null }], outgoing: [] });
    // Bob's other connection goes; his seat and his presence stay with the one that is left.
    bob.close();
    await until(() => chair.state !== undefined, 'the chair to be in');
    expect((await listOf(ann)).friends[0]).toMatchObject({ online: true, room: { code } });
    chair.close();
    await until(() => server.app.rooms.find(code)?.onlineCount() === 0, 'Bob to go offline');
    expect((await listOf(ann)).friends).toEqual([{ username: 'Bob', avatar: null, online: false, room: null }]);
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
    expect((await listOf(ann)).outgoing).toEqual([{ username: 'Robert', avatar: null }]);
    expect((await bobs.request('/api/account/delete', { password: 'correct horse' })).body).toEqual({ ok: true });
    await until(() => ann.friendsChanged === heard + 2, 'Ann to hear of the deletion');
    expect(await listOf(ann)).toEqual({
      friends: [{ username: 'Cat', avatar: null, online: true, room: null }],
      incoming: [],
      outgoing: [],
    });
  });
});

describe('an invitation', () => {
  test('goes to a friend who is online, once a minute, and lets them into a private room', async () => {
    server = await startServer();
    const { browser: anns, client: ann } = await person('Ann');
    const { client: bob } = await person('Bob');
    const { client: cat } = await person('Cat');
    await person('Dan');
    await befriend(ann, bob);
    await befriend(ann, cat, 'Cat');
    const { chair, code, roomId } = await roomOf(anns);
    // Only a member may invite, only a friend may be invited, and only one who is online.
    expect(await ann.send('friends:invite', { username: 'Bob' })).toEqual({ ok: false, error: 'not_member' });
    expect(await chair.send('friends:invite', { username: 'Dan' })).toEqual({ ok: false, error: 'not_friends' });
    cat.close();
    await expect
      .poll(async () => (await listOf(chair)).friends.find(({ username }) => username === 'Cat')?.online)
      .toBe(false);
    expect(await chair.send('friends:invite', { username: 'Cat' })).toEqual({ ok: false, error: 'friend_offline' });
    expect(await chair.send('friends:invite', { username: 'Bob' })).toEqual({ ok: true });
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
      error: 'name_required',
      language: 'en',
    });
    expect(await bob.send('room:join', { invitation: invitation?.id, play: true })).toEqual({ ok: true, code, roomId });
    await chair.waitFor((state) => state.players.length === 2, 'Bob in the room');
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
    const bobsFirst = bob.invitations[0]?.id as string;
    const catsFirst = cat.invitations[0]?.id as string;
    // Bob comes in with his. His next connection hears nothing of it: he is in the room, and comes
    // back by the code, with the invitation still in hand or not, even once it would have lapsed.
    expect(await bob.send('room:join', { invitation: bobsFirst, play: true })).toEqual({ ok: true, code, roomId });
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
    const tablet = track(await cats.connect());
    await until(() => tablet.invitations.length === 1, "Cat's invitation on the tablet");
    expect(await cat.send('friends:ignore', { id: catsSecond })).toEqual({ ok: true });
    const laptop = track(await cats.connect());
    await laptop.send('sys:ping');
    expect(laptop.invitations).toEqual([]);
    expect(await cat.send('room:join', { invitation: catsSecond, play: true })).toEqual({
      ok: false,
      error: 'invitation_expired',
    });
    // Ann and Dan part, and the invitation goes with the friendship.
    expect(await ann.send('friends:remove', { username: 'Dan' })).toEqual({ ok: true });
    expect(await dan.send('room:join', { invitation: dan.invitations[0]?.id, play: true })).toEqual({
      ok: false,
      error: 'invitation_expired',
    });
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
    // Lapsed by its age. A connection of Bob's that comes now hears nothing of it.
    server.advance(INVITATION_MS);
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
    expect(await guest.send('room:join', { code, name: 'Guest', play: false })).toMatchObject({ ok: true });
    expect(await chair.send('room:leave')).toEqual({ ok: true });
    expect(await cat.send('room:join', { invitation: cat.invitations[0]?.id })).toEqual({
      ok: false,
      error: 'invitation_expired',
    });
    expect(await phone.send('room:join', { invitation: fresh, play: true })).toEqual({
      ok: false,
      error: 'invitation_expired',
    });
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

import { afterEach, describe, expect, test } from 'vitest';
import { Browser, startServer, until, type TestServer } from './helpers';
import { keepGame } from './keptGame';

// Public profiles over HTTP (docs/architecture.md#public-profiles): what anyone sees of an account
// by its handle, what the owner writes there and chooses to show, the likes, with their limit, and
// who likes a page, which its owner alone is told, with whether they are friends.

let server: TestServer;

afterEach(async () => {
  await server.close();
});

const HANDLE = /^[0-9a-f]{12}$/;

// A browser logged in to a new account, and the handle of its profile.
async function person(name: string): Promise<{ browser: Browser; handle: string; id: number }> {
  const browser = new Browser(server.url);
  const reply = await browser.register(name);
  if (!reply.body.ok) throw new Error(`could not register ${name}: ${String(reply.body.error)}`);
  const account = (await browser.account()) as { handle: string; id: number };
  return { browser, handle: account.handle, id: account.id };
}

const profileOf = async (browser: Browser, handle: string) => (await browser.request(`/api/profile/${handle}`)).body;

describe('a public profile', () => {
  test('is read by anyone by its handle, and shows what everyone may see', async () => {
    server = await startServer();
    const ann = await person('Ann');
    expect(ann.handle).toMatch(HANDLE);
    expect(await ann.browser.account()).toMatchObject({
      id: 1,
      handle: ann.handle,
      createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      // A new account shows its record and its contributions until the owner turns either off.
      profile: { link: null, bio: null, showRecord: true, showThanks: true, banned: false },
      likes: 0,
      requests: 0,
      played: [],
    });
    const guest = new Browser(server.url);
    expect(await guest.request(`/api/profile/${ann.handle}`)).toMatchObject({
      status: 200,
      body: {
        ok: true,
        profile: {
          id: 1,
          handle: ann.handle,
          username: 'Ann',
          avatar: null,
          rank: 'kindergarten',
          // The day of registration, never the time.
          createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\d$/),
          titles: [],
          streaks: { wins: 0, losses: 0 },
          link: null,
          bio: null,
          record: {
            ordinary: { games: 0, wins: 0 },
            inMatches: { games: 0, wins: 0 },
            roles: { captain: { games: 0, wins: 0 }, guesser: { games: 0, wins: 0 } },
            matches: { played: 0, won: 0 },
          },
          contributions: [],
          likes: 0,
          liked: false,
          mine: false,
        },
      },
    });
    expect((await profileOf(ann.browser, ann.handle)).profile).toMatchObject({ mine: true, liked: false });
    // The streaks go out with the titles, for the page to name them (docs/architecture.md#streaks).
    for (let i = 0; i < 3; i += 1) {
      keepGame(server.db, `earlier-${i}`, { game: 'test' });
      server.accounts.records.add(ann.id, {
        game: 'test',
        gameId: `earlier-${i}`,
        side: 'red',
        role: 'guesser',
        won: true,
        verdict: 'v',
        points: 0,
      });
    }
    expect((await profileOf(guest, ann.handle)).profile).toMatchObject({
      streaks: { wins: 3, losses: 0 },
      record: { ordinary: { games: 3, wins: 3 }, roles: { guesser: { games: 3, wins: 3 } } },
    });
    // Nothing of the owner's own page is in it.
    const shown = JSON.stringify((await profileOf(guest, ann.handle)).profile);
    expect(shown).not.toMatch(/email|points|password|requests|T\d\d:\d\d/);
    for (const wrong of ['000000000000', 'nothing', 'ABCDEF123456', '']) {
      expect(await guest.request(`/api/profile/${wrong}`), wrong).toMatchObject({
        status: 404,
        body: { ok: false, error: 'no_such_profile' },
      });
    }
    // The handle travels with the player into a room, so that the page can be opened from there.
    const own = await ann.browser.connect();
    const reply = await own.send('room:create', { game: 'test', language: 'en', fields: ['general'] });
    if (!reply.ok) throw new Error(reply.error);
    await own.waitFor((state) => state.code === reply.code);
    expect(own.state?.players[0]).toMatchObject({ name: 'Ann', handle: ann.handle, rank: 'kindergarten' });
    own.close();
  });

  test('carries the link, the line and what the owner chooses to show, cleaned and checked', async () => {
    server = await startServer();
    const ann = await person('Ann');
    const guest = new Browser(server.url);
    expect(
      await ann.browser.request('/api/account/profile', {
        link: ' https://ann.example/me?x=(1) ',
        bio: '  Reviewer  of\teverything ​',
        showRecord: true,
        showThanks: true,
      }),
    ).toMatchObject({ status: 200, body: { ok: true } });
    expect(await ann.browser.account()).toMatchObject({
      profile: {
        link: 'https://ann.example/me?x=%281%29',
        bio: 'Reviewer of everything',
        showRecord: true,
        showThanks: true,
        banned: false,
      },
    });
    expect((await profileOf(guest, ann.handle)).profile).toMatchObject({
      link: 'https://ann.example/me?x=%281%29',
      bio: 'Reviewer of everything',
      record: { ordinary: { games: 0, wins: 0 }, inMatches: { games: 0, wins: 0 }, matches: { played: 0, won: 0 } },
      contributions: [],
    });
    // Each is optional, and what won't do is refused with its own answer.
    expect(
      await ann.browser.request('/api/account/profile', { link: '', bio: '  ', showRecord: false, showThanks: false }),
    ).toMatchObject({ status: 200, body: { ok: true } });
    expect((await profileOf(guest, ann.handle)).profile).toMatchObject({
      link: null,
      bio: null,
      record: null,
      contributions: null,
    });
    const refusals: [object, number, string][] = [
      [{ link: 'http://ann.example/', bio: '', showRecord: false, showThanks: false }, 400, 'web_link_invalid'],
      [{ link: 'mailto:ann@example.com', bio: '', showRecord: false, showThanks: false }, 400, 'web_link_invalid'],
      [
        { link: `https://ann.example/${'x'.repeat(200)}`, bio: '', showRecord: false, showThanks: false },
        400,
        'web_link_too_long',
      ],
      [{ link: '', bio: 'x'.repeat(81), showRecord: false, showThanks: false }, 400, 'bio_too_long'],
      [{ link: '', bio: 'x'.repeat(401), showRecord: false, showThanks: false }, 400, 'bio_too_long'],
      [{ link: '', bio: '', showRecord: 'yes', showThanks: false }, 400, 'bad_request'],
      [{ link: '', bio: '' }, 400, 'bad_request'],
    ];
    for (const [body, status, error] of refusals) {
      expect(await ann.browser.request('/api/account/profile', body), error).toMatchObject({
        status,
        body: { ok: false, error },
      });
    }
    expect(
      await guest.request('/api/account/profile', { link: '', bio: '', showRecord: false, showThanks: false }),
    ).toMatchObject({ status: 401, body: { ok: false, error: 'not_logged_in' } });
  });

  test('loses its link and line when the operator clears them, and a barred account writes none', async () => {
    server = await startServer();
    const ann = await person('Ann');
    const guest = new Browser(server.url);
    const settings = { link: 'https://ann.example/', bio: 'Hi', showRecord: true, showThanks: false };
    expect((await ann.browser.request('/api/account/profile', settings)).body).toEqual({ ok: true });
    expect(server.accounts.takeDownProfile(ann.id, true)).toBe(true);
    expect(server.accounts.takeDownProfile(ann.id, false)).toBe(false);
    expect((await profileOf(guest, ann.handle)).profile).toMatchObject({
      link: null,
      bio: null,
      record: { ordinary: { games: 0 } },
    });
    expect(await ann.browser.account()).toMatchObject({ profile: { link: null, bio: null, banned: true } });
    expect(await ann.browser.request('/api/account/profile', settings)).toMatchObject({
      status: 403,
      body: { ok: false, error: 'profile_banned' },
    });
    // The owner may still choose what to show.
    expect(
      await ann.browser.request('/api/account/profile', { link: '', bio: '', showRecord: false, showThanks: true }),
    ).toMatchObject({ status: 200, body: { ok: true } });
    expect((await profileOf(guest, ann.handle)).profile).toMatchObject({ record: null, contributions: [] });
    server.accounts.store.setProfileBanned(ann.id, false);
    expect((await ann.browser.request('/api/account/profile', settings)).body).toEqual({ ok: true });
  });
});

describe('likes', () => {
  test('are given once by an account, taken back, never to its own page, and counted for everyone', async () => {
    server = await startServer();
    const ann = await person('Ann');
    const bob = await person('Bob');
    const guest = new Browser(server.url);
    expect(await bob.browser.request('/api/profile/like', { handle: ann.handle })).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect((await bob.browser.request('/api/profile/like', { handle: ann.handle })).body).toEqual({ ok: true });
    expect((await profileOf(bob.browser, ann.handle)).profile).toMatchObject({ likes: 1, liked: true });
    expect((await profileOf(guest, ann.handle)).profile).toMatchObject({ likes: 1, liked: false });
    expect(await ann.browser.account()).toMatchObject({ likes: 1 });
    expect(await ann.browser.request('/api/profile/like', { handle: ann.handle })).toMatchObject({
      status: 403,
      body: { ok: false, error: 'self_like' },
    });
    for (const path of ['/api/profile/like', '/api/profile/unlike']) {
      expect(await bob.browser.request(path, { handle: '000000000000' })).toMatchObject({
        status: 404,
        body: { ok: false, error: 'no_such_profile' },
      });
      expect(await bob.browser.request(path, { handle: 'nothing' })).toMatchObject({
        status: 400,
        body: { ok: false, error: 'bad_request' },
      });
      expect(await guest.request(path, { handle: ann.handle })).toMatchObject({
        status: 401,
        body: { ok: false, error: 'not_logged_in' },
      });
    }
    expect((await bob.browser.request('/api/profile/unlike', { handle: ann.handle })).body).toEqual({ ok: true });
    expect((await bob.browser.request('/api/profile/unlike', { handle: ann.handle })).body).toEqual({ ok: true });
    expect((await profileOf(bob.browser, ann.handle)).profile).toMatchObject({ likes: 0, liked: false });
  });

  test('are so many a day for an account, and go with the account that gave them', async () => {
    server = await startServer({ accountLimits: { likesPerDay: 2 } });
    const ann = await person('Ann');
    const bob = await person('Bob');
    const cy = await person('Cy');
    const dan = await person('Dan');
    expect((await dan.browser.request('/api/profile/like', { handle: ann.handle })).body).toEqual({ ok: true });
    expect((await dan.browser.request('/api/profile/like', { handle: bob.handle })).body).toEqual({ ok: true });
    expect(await dan.browser.request('/api/profile/like', { handle: cy.handle })).toMatchObject({
      status: 429,
      body: { ok: false, error: 'like_limited' },
    });
    // Liking a page again costs nothing; the day passing gives the account its likes back.
    expect((await dan.browser.request('/api/profile/like', { handle: ann.handle })).body).toEqual({ ok: true });
    server.advance(24 * 60 * 60_000);
    expect((await dan.browser.request('/api/profile/like', { handle: cy.handle })).body).toEqual({ ok: true });
    expect(await ann.browser.account()).toMatchObject({ likes: 1 });
    expect((await dan.browser.request('/api/account/delete', { password: 'correct horse' })).body).toEqual({
      ok: true,
    });
    expect(await ann.browser.account()).toMatchObject({ likes: 0 });
    expect(await cy.browser.account()).toMatchObject({ likes: 0 });
  });

  test('show the owner who gave them, the latest first, and whether each is a friend', async () => {
    server = await startServer();
    const ann = await person('Ann');
    const bob = await person('Bob');
    const cy = await person('Cy');
    const guest = new Browser(server.url);
    expect((await bob.browser.request('/api/profile/like', { handle: ann.handle })).body).toEqual({ ok: true });
    expect((await cy.browser.request('/api/profile/like', { handle: ann.handle })).body).toEqual({ ok: true });
    expect(await ann.browser.request('/api/account/likers')).toMatchObject({
      status: 200,
      body: {
        ok: true,
        likers: [
          { handle: cy.handle, username: 'Cy', avatar: null, friend: false },
          { handle: bob.handle, username: 'Bob', avatar: null, friend: false },
        ],
      },
    });
    // Nobody else is told: not the likers, and not a guest.
    expect((await bob.browser.request('/api/account/likers')).body).toEqual({ ok: true, likers: [] });
    expect(await guest.request('/api/account/likers')).toMatchObject({ status: 401 });
    // Once Bob and Ann are friends, the list says so, and the request that waited was counted.
    const anns = await ann.browser.connect();
    const bobs = await bob.browser.connect();
    expect(await bobs.send('friends:request', { username: 'Ann' })).toEqual({ ok: true, status: 'pending' });
    await until(() => anns.friendsChanged === 1, 'Ann to hear of it');
    expect(await ann.browser.account()).toMatchObject({ requests: 1 });
    expect(await anns.send('friends:accept', { username: 'Bob' })).toEqual({ ok: true });
    expect(await ann.browser.account()).toMatchObject({ requests: 0 });
    const { likers } = (await ann.browser.request('/api/account/likers')).body as unknown as {
      likers: { friend: boolean }[];
    };
    expect(likers.map(({ friend }) => friend)).toEqual([false, true]);
    anns.close();
    bobs.close();
  });
});

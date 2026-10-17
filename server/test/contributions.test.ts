import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTRIBUTIONS_API, LIST_API, parseAcknowledgments } from '@reviewer2/shared';
import { afterEach, expect, test } from 'vitest';
import { Browser, startServer, type TestServer } from './helpers';

// The feedback contributions over HTTP: the home page's list, which is the adopted feedback, by the
// account that signed each as it is now, with its profile, a guest's name, or anonymous; and an
// account's counts, which its owner sees, and anyone else only if the owner shows them. The
// acknowledgments are ACKNOWLEDGMENTS.md, which the server reads for the home page (thanks.ts).

let server: TestServer;

afterEach(async () => {
  await server.close();
});

const SAID = { zh: '提出了计时器', en: 'Suggested a timer' };

test('are listed for anyone, and counted for the account they came from', async () => {
  server = await startServer();
  const ann = new Browser(server.url);
  await ann.register('Ann');
  const { handle } = (await ann.account()) as { handle: string };
  const guest = new Browser(server.url);
  const add = (credit: string | null, accountId: number | null, linkProfile: boolean, kind: 'idea' | 'bug' = 'idea') =>
    server.feedback.add({
      kind,
      text: 'A timer, please.',
      contact: 'me@example.com',
      credit,
      accountId,
      linkProfile,
      version: 'v1',
      language: 'en',
      page: 'home',
      userAgent: null,
    });
  // Signed with Ann's account, anonymous from it, and a guest's name.
  add(null, 1, true);
  add(null, 1, false, 'bug');
  add('Ann L', null, false);
  for (const id of [1, 2, 3]) {
    server.feedback.setIssue(id, 40 + id);
    server.feedback.adopt(id, SAID);
  }
  // Not adopted, it isn't listed.
  add(null, 1, true);

  const list = await guest.request(CONTRIBUTIONS_API);
  expect(list.status).toBe(200);
  const month = new Date().toISOString().slice(0, 7);
  expect(list.body).toEqual({
    ok: true,
    contributions: [
      { kind: 'idea', name: 'Ann L', profile: null, avatar: null, deleted: false, summary: SAID, issue: 43, month },
      { kind: 'bug', name: null, profile: null, avatar: null, deleted: false, summary: SAID, issue: 42, month },
      { kind: 'idea', name: 'Ann', profile: handle, avatar: null, deleted: false, summary: SAID, issue: 41, month },
    ],
  });
  // Never the text, the contact, or the account but for feedback signed with it, which shows its
  // username, handle and avatar.
  expect(JSON.stringify(list.body)).not.toMatch(/timer, please|me@example|"accountId"/);
  expect(JSON.stringify(list.body).match(/"Ann"/g)).toHaveLength(1);

  expect(await ann.account()).toMatchObject({
    contributions: [
      { kind: 'idea', count: 1 },
      { kind: 'bug', count: 1 },
    ],
  });
  // The public profile shows the counts until the owner turns them off.
  expect((await guest.request(`/api/profile/${handle}`)).body).toMatchObject({
    profile: {
      contributions: [
        { kind: 'idea', count: 1 },
        { kind: 'bug', count: 1 },
      ],
    },
  });
  await ann.request('/api/account/profile', { link: '', bio: '', showRecord: false, showThanks: false });
  expect((await guest.request(`/api/profile/${handle}`)).body).toMatchObject({ profile: { contributions: null } });
  expect(await guest.account()).toBeNull();

  // The acknowledgments are the file's, beside them.
  const file = readFileSync(join(import.meta.dirname, '..', '..', 'ACKNOWLEDGMENTS.md'), 'utf8');
  const acknowledgments = await guest.request(LIST_API.acknowledgments);
  expect(acknowledgments.status).toBe(200);
  expect(acknowledgments.body).toEqual({ ok: true, blocks: parseAcknowledgments(file).blocks });
});

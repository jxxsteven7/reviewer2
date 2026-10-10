import { afterEach, expect, test } from 'vitest';
import { Browser, startServer, type TestServer } from './helpers';

// The acknowledgments over HTTP: everyone reads the names, kinds and dates, and an account's
// summary counts the ones linked to it.

let server: TestServer;

afterEach(async () => {
  await server.close();
});

test('everyone reads the list, and an account sees how often it is on it', async () => {
  server = await startServer();
  const ann = new Browser(server.url);
  await ann.register('Ann');
  const guest = new Browser(server.url);
  expect(await guest.request('/api/acknowledgments')).toMatchObject({
    status: 200,
    body: { ok: true, acknowledgments: [] },
  });

  const { acknowledgments } = server.accounts;
  acknowledgments.add({ name: 'Ann L', kind: 'feedback', feedbackId: 3, accountId: 1 });
  acknowledgments.add({ name: 'Ann L', kind: 'words', feedbackId: null, accountId: 1 });
  acknowledgments.add({ name: 'Bob', kind: 'playtesting', feedbackId: null, accountId: null });
  const { body } = await guest.request('/api/acknowledgments');
  expect(body).toEqual({
    ok: true,
    acknowledgments: [
      { name: 'Ann L', kind: 'feedback', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
      { name: 'Ann L', kind: 'words', date: expect.any(String) },
      { name: 'Bob', kind: 'playtesting', date: expect.any(String) },
    ],
  });
  // Nothing of the feedback or the account is in it.
  for (const entry of body.acknowledgments as object[]) {
    expect(Object.keys(entry).sort()).toEqual(['date', 'kind', 'name']);
  }

  expect(await ann.account()).toMatchObject({
    acknowledgments: [
      { kind: 'feedback', count: 1 },
      { kind: 'words', count: 1 },
    ],
  });
  expect(await guest.account()).toBeNull();

  // The list is read-only, and read as the pages are.
  const post = await guest.request('/api/acknowledgments', {});
  expect(post.status).toBe(405);
});

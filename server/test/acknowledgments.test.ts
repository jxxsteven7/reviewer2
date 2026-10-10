import { afterEach, expect, test } from 'vitest';
import { Browser, startServer, type TestServer } from './helpers';

// The acknowledgments over HTTP: an account's summary counts the ones counted for it, and nothing
// else of them is served. The public list is ACKNOWLEDGMENTS.md, which the build bundles for the
// home page.

let server: TestServer;

afterEach(async () => {
  await server.close();
});

test('an account sees how often it is thanked, and nobody gets the table', async () => {
  server = await startServer();
  const ann = new Browser(server.url);
  await ann.register('Ann');
  const guest = new Browser(server.url);

  const { acknowledgments } = server.accounts;
  acknowledgments.add({ name: 'Ann L', kind: 'feedback', feedbackId: 3, accountId: 1 });
  acknowledgments.add({ name: 'Ann L', kind: 'words', feedbackId: null, accountId: 1 });
  acknowledgments.add({ name: 'Bob', kind: 'playtesting', feedbackId: null, accountId: null });
  expect(await ann.account()).toMatchObject({
    acknowledgments: [
      { kind: 'feedback', count: 1 },
      { kind: 'words', count: 1 },
    ],
  });
  expect(await guest.account()).toBeNull();
  expect((await guest.request('/api/acknowledgments')).status).toBe(404);
});

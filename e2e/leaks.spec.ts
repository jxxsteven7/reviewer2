import { expectNoKey, seatTable, snapshotsOf, expect, test } from './helpers';

// Socket.IO falls back to HTTP long-polling when a network blocks WebSockets. The key must stay
// hidden there too.
test('a guesser who can only long-poll never receives the key', async ({ browser }) => {
  let cut = 0;
  const table = await seatTable(browser, 'en', async (page, name) => {
    if (name !== 'Bob') return;
    await page.routeWebSocket(/\/socket\.io\//, (socket) => {
      cut += 1;
      socket.close();
    });
  });
  const bob = table.guessers.red;
  await expect(bob.locator('.board .card')).toHaveCount(25);
  // A snapshot is read from the body of a polling response, a moment after the page has shown it.
  await expect.poll(() => expectNoKey(snapshotsOf(bob))).toBeGreaterThan(0);
  // Bob's browser did try WebSockets and was cut off every time, so all of that came by polling.
  expect(cut, 'WebSocket connections cut off').toBeGreaterThan(0);
});

import { createRoom, expectNoKey, joinByLink, newPlayer, recordSnapshots, sit, TEXT, expect, test } from './helpers';

// Socket.IO falls back to HTTP long-polling when a network blocks WebSockets. The key must stay
// hidden there too.
test('a guesser who can only long-poll never receives the key', async ({ browser }) => {
  const ann = await newPlayer(browser);
  const url = await createRoom(ann, 'en', 'Ann');
  const pages = [];
  for (const name of ['Bob', 'Cat', 'Dan']) {
    const page = await newPlayer(browser);
    if (name === 'Bob') await page.routeWebSocket(/\/socket\.io\//, (socket) => socket.close());
    await joinByLink(page, url, name, 'en');
    pages.push(page);
  }
  const [bob, cat, dan] = pages;
  const bobStates = recordSnapshots(bob!);
  await sit(ann, 'red', 'captain', 'en');
  await sit(bob!, 'red', 'guesser', 'en');
  await sit(cat!, 'blue', 'captain', 'en');
  await sit(dan!, 'blue', 'guesser', 'en');
  await expect(ann.locator('.desk .ready')).toBeVisible();
  await ann.getByRole('button', { name: TEXT.en.lobby.start }).click();
  await expect(bob!.locator('.keywords-game')).toBeVisible();
  await expect(bob!.locator('.board .card')).toHaveCount(25);
  expect(expectNoKey(bobStates)).toBeGreaterThan(0);
});

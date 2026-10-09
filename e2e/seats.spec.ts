import {
  createRoom,
  interpolate,
  joinByLink,
  newPlayer,
  playFor,
  seatTable,
  sideChannel,
  TEXT,
  expect,
  test,
} from './helpers';

const guesserIn = (team: 'red' | 'blue') => interpolate(TEXT.en.game.you.guesser, { group: TEXT.en.lobby.group[team] });

test('players who come to play are dealt into the groups evenly, and the shuffle picks the PIs', async ({
  browser,
}) => {
  const ann = await newPlayer(browser);
  const url = await createRoom(ann, 'en', 'Ann');
  // One at a time, so that each finds the groups as the one before left them.
  for (const name of ['Bob', 'Cat', 'Dan']) await joinByLink(await newPlayer(browser), url, name, 'en');
  await joinByLink(await newPlayer(browser), url, 'Eve', 'en', { watch: true });
  for (const team of ['red', 'blue'] as const) {
    await expect(ann.locator(`.group.${team} .names li`)).toHaveCount(2);
    await expect(ann.locator(`.group.${team}`)).toContainText(TEXT.en.lobby.vacant);
  }
  await expect(ann.locator('.spectators')).toContainText('Eve');

  await ann.getByRole('button', { name: TEXT.en.lobby.shuffle }).click();
  await expect(ann.locator('.desk .ready')).toBeVisible();
  await expect(ann.locator('.spectators')).toContainText('Eve');
});

test('a latecomer who comes to play gets a seat in the smaller group in the middle of a game', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  // Eve joins the blue group, which leaves the red one smaller.
  await table.spectator.getByRole('button', playFor('blue')).click();
  await expect(table.captains.red.locator('.rosters .group.blue')).toContainText('Eve');

  const fay = await newPlayer(browser);
  await joinByLink(fay, table.url, 'Fay', 'en');
  await expect(fay.locator('.actions .who')).toHaveText(guesserIn('red'));
  await expect(table.captains.red.locator('.rosters .group.red')).toContainText('Fay');

  // A latecomer who comes to watch may still choose either group.
  const gus = await newPlayer(browser);
  await joinByLink(gus, table.url, 'Gus', 'en', { watch: true });
  await expect(gus.locator('.actions .who')).toHaveText(TEXT.en.game.you.spectator);
  await gus.getByRole('button', playFor('blue')).click();
  await expect(gus.locator('.actions .who')).toHaveText(guesserIn('blue'));
});

test('nobody changes groups in the middle of a game', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const bob = table.guessers.red;
  // A student is offered no seat in the other group, also after stepping out to watch.
  await expect(bob.getByRole('button', playFor('blue'))).toHaveCount(0);
  await bob.getByRole('button', { name: TEXT.en.game.watch }).click();
  await expect(bob.locator('.actions .who')).toHaveText(TEXT.en.game.you.spectator);
  await expect(table.captains.red.locator('.rosters .spectators')).toContainText('Bob');
  await expect(bob.getByRole('button', playFor('red'))).toBeVisible();
  await expect(bob.getByRole('button', playFor('blue'))).toHaveCount(0);
  // A page that asks for it anyway, such as an outdated tab, is refused.
  const tab = await sideChannel(bob, table.url);
  expect(await tab.send('keywords:seat', { team: 'blue', role: 'guesser' })).toEqual({
    ok: false,
    error: 'other_team',
  });
  await bob.getByRole('button', playFor('red')).click();
  // Back in the red group, on his own page and on the PI's.
  await expect(bob.locator('.actions .who')).toHaveText(guesserIn('red'));
  await expect(table.captains.red.locator('.rosters .spectators')).not.toContainText('Bob');
  await expect(table.captains.red.locator('.rosters .group.red')).toContainText('Bob');
});

test('an empty PI seat can be taken over, and its new PI sees the key and stays out of guessing', async ({
  browser,
}) => {
  const table = await seatTable(browser, 'en');
  const ann = table.captains.red;
  await ann.getByRole('button', { name: TEXT.en.room.leave }).click();
  await ann.locator('[role=dialog]').getByRole('button', { name: TEXT.en.room.leave }).click();
  await ann.waitForURL(/\/$/);

  const eve = table.spectator;
  await eve.locator('.rosters .group.red').getByRole('button', { name: TEXT.en.game.takeOver }).click();
  await eve.locator('[role=dialog]').getByRole('button', { name: TEXT.en.game.takeOver }).click();
  await expect(eve.locator('.board .card.known')).toHaveCount(25);

  // Ann comes back with the same browser, to play. Having seen the key, she can't play as a
  // student, and the server leaves her watching.
  await joinByLink(ann, table.url, 'Ann', 'en');
  await expect(ann.locator('.actions .who')).toHaveText(TEXT.en.game.you.spectator);
  await expect(ann.locator('.keywords-game')).toBeVisible();
  for (const team of ['red', 'blue'] as const) await expect(ann.getByRole('button', playFor(team))).toHaveCount(0);
  // Nor by asking the server straight out, as an outdated tab could.
  const tab = await sideChannel(ann, table.url);
  expect(await tab.send('keywords:seat', { team: 'red', role: 'guesser' })).toEqual({ ok: false, error: 'key_viewer' });
});

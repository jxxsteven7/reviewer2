import { interpolate, joinByLink, newPlayer, playFor, seatTable, sideChannel, TEXT, expect, test } from './helpers';

test('a latecomer joins in the middle of a game and plays for a group', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const fay = await newPlayer(browser);
  await joinByLink(fay, table.url, 'Fay', 'en');
  await expect(fay.locator('.keywords-game')).toBeVisible();
  await fay.getByRole('button', playFor('blue')).click();
  await expect(table.captains.red.locator('.rosters .group.blue')).toContainText('Fay');
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
  await expect(bob.locator('.actions .who')).toHaveText(
    interpolate(TEXT.en.game.you.guesser, { group: TEXT.en.lobby.group.red }),
  );
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

  // Ann comes back with the same browser. Having seen the key, she can't play as a student.
  await joinByLink(ann, table.url, 'Ann', 'en');
  await expect(ann.locator('.keywords-game')).toBeVisible();
  for (const team of ['red', 'blue'] as const) await expect(ann.getByRole('button', playFor(team))).toHaveCount(0);
  // Nor by asking the server straight out, as an outdated tab could.
  const tab = await sideChannel(ann, table.url);
  expect(await tab.send('keywords:seat', { team: 'red', role: 'guesser' })).toEqual({ ok: false, error: 'key_viewer' });
});

import { joinByLink, newPlayer, seatTable, TEXT, expect, test } from './helpers';

test('a latecomer joins in the middle of a game and plays for a group', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const fay = await newPlayer(browser);
  await joinByLink(fay, table.url, 'Fay', 'en');
  await expect(fay.locator('.keywords-game')).toBeVisible();
  await fay.getByRole('button', { name: TEXT.en.game.playFor.replace('{group}', TEXT.en.lobby.group.blue) }).click();
  await expect(table.captains.red.locator('.rosters .group.blue')).toContainText('Fay');
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
  await expect(ann.getByRole('button', { name: /^Play for/ })).toHaveCount(0);
});

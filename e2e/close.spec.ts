import { createRoom, joinByLink, newPlayer, seatTable, TEXT, expect, test } from './helpers';

// The chair closes the room for everyone (docs/architecture.md). Every page that is open hears at
// once, a page that was offline hears when it comes back, and the number leads nowhere.

test('the chair closes the room in the middle of a game, and every page is told', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const ann = table.captains.red;
  const bob = table.guessers.red;
  const others = [table.captains.blue, table.guessers.blue, table.spectator, table.screen];

  // Bob's network is gone when it happens.
  await bob.context().setOffline(true);
  await expect(bob.locator('.banner')).toHaveText(TEXT.en.room.reconnecting, { timeout: 30_000 });

  // Only the chair is offered the button.
  for (const page of others.slice(0, 3)) {
    await expect(page.getByRole('button', { name: TEXT.en.room.closeRoom })).toHaveCount(0);
  }
  await ann.getByRole('button', { name: TEXT.en.room.closeRoom }).click();
  const sheet = ann.locator('[role=dialog]');
  await expect(sheet).toContainText(TEXT.en.room.closeConfirmGame);
  await sheet.getByRole('button', { name: TEXT.en.room.closeRoom }).click();
  await ann.waitForURL(/\/$/);

  for (const page of others) {
    await expect(page.getByText(TEXT.en.room.closed.closed)).toBeVisible();
    await expect(page.getByRole('link', { name: TEXT.en.room.home })).toBeVisible();
    await expect(page.locator('.keywords-game, .screen-game')).toHaveCount(0);
  }

  // Bob hears that the room has gone when his network comes back.
  await bob.context().setOffline(false);
  await expect(bob.getByText(TEXT.en.room.closed.expired)).toBeVisible({ timeout: 15_000 });
  await expect(bob.locator('.keywords-game')).toHaveCount(0);

  // The number finds no room, for a newcomer or for anyone who was in it.
  const fay = await newPlayer(browser);
  await fay.goto(table.url);
  await expect(fay.getByText(TEXT.en.room.notFound.title)).toBeVisible();
  await ann.goto(table.url);
  await expect(ann.getByText(TEXT.en.room.notFound.title)).toBeVisible();
});

test("the chair's leave sheet offers to close the room instead", async ({ browser }) => {
  const ann = await newPlayer(browser);
  const url = await createRoom(ann, 'en', 'Ann');
  const bob = await newPlayer(browser);
  await joinByLink(bob, url, 'Bob', 'en');

  // Bob isn't the chair: his sheet only lets him leave.
  await bob.getByRole('button', { name: TEXT.en.room.leave }).click();
  await expect(bob.locator('[role=dialog]').getByRole('button', { name: TEXT.en.room.closeInstead })).toHaveCount(0);
  await bob.locator('[role=dialog]').getByRole('button', { name: TEXT.en.lobby.manage.cancel }).click();

  await ann.getByRole('button', { name: TEXT.en.room.leave }).click();
  const sheet = ann.locator('[role=dialog]');
  await expect(sheet).toContainText('Bob will chair the room');
  await sheet.getByRole('button', { name: TEXT.en.room.closeInstead }).click();
  await expect(sheet).toContainText(TEXT.en.room.closeConfirm);
  await sheet.getByRole('button', { name: TEXT.en.room.closeRoom }).click();
  await ann.waitForURL(/\/$/);
  await expect(bob.getByText(TEXT.en.room.closed.closed)).toBeVisible();
});

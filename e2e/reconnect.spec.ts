import { giveClue, keyCard, pageErrors, reveal, seatTable, teamOnTurn, TEXT, expect, test } from './helpers';

// After a refresh, a locked screen or a lost network, players come back to their room, group and
// role (docs/rules/constraints.md).

test('a player who reloads the page is back in their seat', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const team = await teamOnTurn(table.captains.red);
  await giveClue(table.captains[team], 'Hint', 2, 'en');
  const guesser = table.guessers[team];
  await guesser.reload();
  await expect(guesser.locator('.keywords-game')).toBeVisible();
  await expect(guesser.locator('form.name-form')).toHaveCount(0);
  await reveal(guesser, await keyCard(table.captains[team], team));
  expect(pageErrors).toEqual([]);
});

test('a player who loses the network for half a minute comes back by themselves', async ({ browser }) => {
  test.slow();
  const table = await seatTable(browser, 'en');
  const team = await teamOnTurn(table.captains.red);
  const guesser = table.guessers[team];
  await guesser.context().setOffline(true);
  await expect(guesser.locator('.banner')).toHaveText(TEXT.en.room.reconnecting, { timeout: 30_000 });
  await giveClue(table.captains[team], 'Hint', 2, 'en');
  await guesser.context().setOffline(false);
  await expect(guesser.locator('.banner')).toHaveCount(0, { timeout: 15_000 });
  // The clue that came while it was away is there, and the player can carry on.
  await expect(guesser.locator('.strip .clue .word')).toHaveText('Hint');
  await reveal(guesser, await keyCard(table.captains[team], team));
});

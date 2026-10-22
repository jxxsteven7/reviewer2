import { expect, giveClue, interpolate, keyCard, reveal, seatTable, teamOnTurn, TEXT, test } from './helpers';

// The room calls a group out as the card comes that brings it a title (docs/games/keywords.md#titles):
// here the instant desk reject, when a group's very first card is Reviewer 2, which ends the game.
// Every page in the room hears it, the screen included, naming the group and nobody in it.

test('a group whose first card is Reviewer 2 is called out to the whole room, by the group alone', async ({
  browser,
}) => {
  const table = await seatTable(browser, 'en');
  const text = TEXT.en;
  const team = await teamOnTurn(table.captains.red);
  await giveClue(table.captains[team], 'Hint', 2, 'en');
  await reveal(table.guessers[team], await keyCard(table.captains[team], 'reviewer2'));
  const group = text.games.keywords.groups[team];
  const lines = Object.values(text.game.calls.instant_reject).map((line) => interpolate(line, { group }));
  for (const page of [
    table.captains.red,
    table.guessers.red,
    table.captains.blue,
    table.guessers.blue,
    table.spectator,
    table.screen,
  ]) {
    const call = page.locator('.bubble.call');
    await expect(call).toHaveCount(1);
    expect(lines).toContain(await call.locator('span').last().innerText());
    await expect(call.locator(`.group-mark.${team}`)).toHaveCount(1);
    await expect(call.locator('.avatar')).toHaveCount(0);
  }
  await expect(table.guessers[team].locator('.decision-letter, .letter').first()).toBeVisible();
});

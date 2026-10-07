import { endTurn, giveClue, pageErrors, revealByKey, seatTable, teamOnTurn, TEXT, expect, test } from './helpers';

test('an unlimited clue allows any number of guesses, until the group ends its turn', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const team = await teamOnTurn(table.captains.red);
  const captain = table.captains[team];
  const guesser = table.guessers[team];
  await giveClue(captain, 'Everything', 'unlimited', 'en');
  for (let i = 0; i < 4; i += 1) await revealByKey(table, team);
  await expect(guesser.locator('.strip')).toContainText(TEXT.en.game.noLimit);
  await endTurn(guesser, 'en');
  await expect(guesser.locator('.strip')).not.toHaveClass(new RegExp(`\\b${team}\\b`));
  expect(pageErrors).toEqual([]);
});

test('a clue that repeats a word on the board is refused while the PI types, naming the card', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const team = await teamOnTurn(table.captains.red);
  const captain = table.captains[team];
  // The first card's word, from its label "word, not revealed", and the first word of it.
  const label = await captain.locator('.board .card').first().getAttribute('aria-label');
  const word = (label ?? '').split(',')[0] ?? '';
  await captain.getByLabel(TEXT.en.game.clueInput).fill(word.split(' ')[0] ?? '');
  await expect(captain.locator('.clue-panel .problem')).toHaveText(
    TEXT.en.game.onBoard.replace('{word}', `\u201c${word}\u201d`),
  );
  await expect(captain.getByRole('button', { name: TEXT.en.game.sendClue })).toBeDisabled();
});

test('revealing Reviewer 2 rejects the group at once', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const team = await teamOnTurn(table.captains.red);
  await giveClue(table.captains[team], 'Danger', 1, 'en');
  await revealByKey(table, team, 'reviewer2');
  for (const page of [table.guessers[team], table.screen]) {
    await expect(page.locator('.letter .verdict')).toHaveText(TEXT.en.game.letter.rejected);
  }
  await expect(table.screen.locator('.board .stamp')).toHaveText(TEXT.en.game.stamp);
});

test('the chair can withdraw a game and play again with the same seats', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const chair = table.captains.red;
  await chair.getByRole('button', { name: TEXT.en.game.end }).first().click();
  await chair.locator('[role=dialog]').getByRole('button', { name: TEXT.en.game.end }).click();
  await expect(table.spectator.locator('.letter .verdict')).toHaveText(TEXT.en.game.letter.withdrawn);
  await chair.getByRole('button', { name: TEXT.en.game.letter.again }).click();
  await expect(table.guessers.blue.locator('.lobby')).toBeVisible();
  await expect(chair.locator('.desk .ready')).toBeVisible();
});

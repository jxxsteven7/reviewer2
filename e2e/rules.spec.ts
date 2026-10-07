import { checkClue } from '@reviewer2/shared';
import { endTurn, giveClue, interpolate, revealByKey, seatTable, teamOnTurn, TEXT, expect, test } from './helpers';

test('an unlimited clue allows any number of guesses, until the group ends its turn', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const team = await teamOnTurn(table.captains.red);
  const guesser = table.guessers[team];
  await giveClue(table.captains[team], 'Everything', 'unlimited', 'en');
  for (let i = 0; i < 4; i += 1) await revealByKey(table, team);
  await expect(guesser.locator('.strip')).toContainText(TEXT.en.game.noLimit);
  await endTurn(guesser, 'en');
  await expect(guesser.locator('.strip')).not.toHaveClass(new RegExp(`\\b${team}\\b`));
});

test('a clue that repeats a word on the board is refused while the PI types, naming the card', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const team = await teamOnTurn(table.captains.red);
  const captain = table.captains[team];
  // The words on the board, without the soft hyphens that let a long one break on a phone, and
  // the first of them that would be a clue on its own: one word with nothing else wrong with it.
  // The rules refuse it as being on the board and name a card. Which card is up to them, as the
  // word may repeat part of an earlier card's word; the rules have tests of their own.
  const words = (await captain.locator('.board .card .word').allTextContents()).map((word) =>
    word.replaceAll('\u00ad', ''),
  );
  const clue = words.find((word) => checkClue(word, []).problem === null);
  if (clue === undefined) throw new Error('no card on the board carries a single word');
  const { problem, conflict } = checkClue(
    clue,
    words.map((word) => ({ word, revealed: false })),
  );
  expect(problem).toBe('clue_on_board');
  await captain.getByLabel(TEXT.en.game.clueInput).fill(clue);
  await expect(captain.locator('.clue-panel .problem')).toHaveText(
    interpolate(TEXT.en.game.onBoard, { word: `\u201c${conflict?.text}\u201d` }),
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

import type { Browser, Page } from '@playwright/test';
import { otherTeam } from '@reviewer2/shared';
import {
  expectOwnGroupOnly,
  giveClue,
  interpolate,
  joinByLink,
  newPlayer,
  playFor,
  seatTable,
  snapshotsOf,
  teamOnTurn,
  TEXT,
  expect,
  test,
} from './helpers';

// Students of a group talk it over: they see each other's choices of cards and write to each
// other, and nobody outside the group sees either (docs/games/keywords.md).

const text = TEXT.en;
const card = (page: Page, index: number) => page.locator('.board .card').nth(index);
const openChat = (page: Page) => page.locator('.who-row').getByRole('button').click();

// The usual table, and a second student, Fay, in the group whose turn it is.
async function groupOfTwo(browser: Browser) {
  const table = await seatTable(browser, 'en');
  const team = await teamOnTurn(table.captains.red);
  const other = otherTeam(team);
  const fay = await newPlayer(browser);
  const fayStates = snapshotsOf(fay);
  await joinByLink(fay, table.url, 'Fay', 'en');
  await fay.getByRole('button', playFor(team)).click();
  await expect(fay.locator('.actions .who')).toHaveText(
    interpolate(text.game.you.guesser, { group: text.lobby.group[team] }),
  );
  const student = table.guessers[team];
  const name = table.names.guessers[team];
  return { table, team, other, fay, fayStates, student, name, states: [...table.everyone, fayStates] };
}

test("a group's students see each other's choices, and nobody else does", async ({ browser }) => {
  const { table, team, other, fay, student, name, states } = await groupOfTwo(browser);
  const captain = table.captains[team];
  await giveClue(captain, 'Hint', 2, 'en');
  await expect(student.locator('.guess-bar')).toBeVisible();

  await card(student, 3).click();
  await expect(card(student, 3)).toHaveClass(/selected/);
  await expect(card(fay, 3).locator('.choosers')).toHaveText(name);
  await expect(card(captain, 3).locator('.choosers')).toHaveText(name);

  // Fay chooses another card, takes the choice back, and joins the first one.
  await card(fay, 7).click();
  await expect(card(student, 7).locator('.choosers')).toHaveText('Fay');
  await card(fay, 7).click();
  await expect(card(student, 7).locator('.choosers')).toHaveCount(0);
  await card(fay, 3).click();
  await expect(card(student, 3).locator('.choosers')).toHaveText('Fay');
  await expect(card(captain, 3).locator('.choosers')).toHaveText(`${name} and Fay`);
  for (const page of [table.captains[other], table.guessers[other], table.spectator, table.screen]) {
    await expect(page.locator('.board .choosers')).toHaveCount(0);
  }

  // Revealing a card clears every choice.
  await student.locator('.guess-bar button.primary').click();
  await expect(card(student, 3)).toHaveClass(/revealed/);
  for (const page of [student, fay, captain]) {
    await expect(page.locator('.board .choosers, .board .selected')).toHaveCount(0);
  }
  for (const recorded of states) expect(expectOwnGroupOnly(recorded)).toBeGreaterThan(0);
});

test('students write to their group, the PI only reads, and nobody else sees the chat', async ({ browser }) => {
  const { table, team, other, fay, student, name, states } = await groupOfTwo(browser);
  const chat = text.game.chat;
  const write = async (page: Page, line: string) => {
    await page.getByLabel(chat.input).fill(line);
    await page.getByRole('button', { name: chat.send }).click();
    await expect(page.getByLabel(chat.input)).toHaveValue('');
  };

  await openChat(student);
  await write(student, 'Second row, on the left?');
  await expect(fay.locator('.who-row .badge')).toHaveText('1');
  await openChat(fay);
  await expect(fay.locator('[role=dialog] .message')).toHaveCount(1);
  await expect(fay.locator('[role=dialog] .message .name')).toHaveText(name);
  await expect(fay.locator('[role=dialog] .message .text')).toHaveText('Second row, on the left?');
  await expect(fay.locator('.who-row .badge')).toHaveCount(0);
  await write(fay, 'Yes, and the card next to it');
  await expect(student.locator('[role=dialog] .message')).toHaveCount(2);

  // The PI reads the chat but can't write in it.
  const captain = table.captains[team];
  await openChat(captain);
  await expect(captain.locator('[role=dialog] .message')).toHaveCount(2);
  await expect(captain.getByLabel(chat.input)).toHaveCount(0);
  await expect(captain.locator('[role=dialog]')).toContainText(chat.readOnly);

  // The other group has a chat of its own, which is empty; spectators and screens have none.
  await openChat(table.guessers[other]);
  await expect(table.guessers[other].locator('[role=dialog]')).toContainText(chat.empty);
  for (const page of [table.spectator, table.screen]) {
    await expect(page.getByRole('button', { name: chat.open })).toHaveCount(0);
  }
  for (const recorded of states) expect(expectOwnGroupOnly(recorded)).toBeGreaterThan(0);
});

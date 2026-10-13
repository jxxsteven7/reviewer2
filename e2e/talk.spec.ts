import type { Browser, Locator, Page } from '@playwright/test';
import { otherTeam } from '@reviewer2/shared';
import {
  closeSheet,
  expectOwnGroupOnly,
  giveClue,
  interpolate,
  isPhone,
  joinByLink,
  keyCard,
  newPlayer,
  openGroups,
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

// The group's chat: on a wide screen the panel beside the board, which is open all the time; on a
// phone the sheet, opened from the button under the board.
async function chatOf(page: Page): Promise<Locator> {
  const button = page.locator('.open-chat');
  if (await button.count()) await button.click();
  const chat = page.locator('.chat');
  await expect(chat).toBeVisible();
  return chat;
}

// The usual table, and a second student, Fay, in the group whose turn it is.
async function groupOfTwo(browser: Browser) {
  const table = await seatTable(browser, 'en');
  const team = await teamOnTurn(table.captains.red);
  const other = otherTeam(team);
  const fay = await newPlayer(browser);
  const fayStates = snapshotsOf(fay);
  await joinByLink(fay, table.url, 'Fay', 'en', { watch: true });
  await openGroups(fay);
  await fay.getByRole('button', playFor(team)).click();
  await closeSheet(fay);
  await expect(fay.locator('.actions .who')).toHaveText(
    interpolate(text.game.you.guesser, { group: text.lobby.group[team] }),
  );
  const student = table.guessers[team];
  const name = table.names.guessers[team];
  return { table, team, other, fay, fayStates, student, name, states: [...table.everyone, fayStates] };
}

// The choosers of a card hang on it as avatars, and the card's accessible name says who they are.
const chosenBy = (names: string) => new RegExp(`, chosen by ${names}$`);

test("a group's students see each other's choices, and nobody else does", async ({ browser }) => {
  const { table, team, other, fay, student, name, states } = await groupOfTwo(browser);
  const captain = table.captains[team];
  await giveClue(captain, 'Hint', 2, 'en');
  await expect(student.locator('.guess-bar')).toBeVisible();
  // One of the group's own cards, so that revealing it leaves the group its turn: what clears
  // the choices then is the reveal itself, not the end of the turn. And any other card.
  const own = await keyCard(captain, team);
  const another = (own + 1) % 25;

  await card(student, own).click();
  await expect(card(student, own)).toHaveClass(/selected/);
  await expect(card(fay, own)).toHaveAttribute('aria-label', chosenBy(name));
  await expect(card(captain, own)).toHaveAttribute('aria-label', chosenBy(name));

  // Fay chooses another card, takes the choice back, and joins the first one.
  await card(fay, another).click();
  await expect(card(student, another)).toHaveAttribute('aria-label', chosenBy('Fay'));
  await card(fay, another).click();
  await expect(card(student, another).locator('.choosers')).toHaveCount(0);
  await card(fay, own).click();
  await expect(card(student, own)).toHaveAttribute('aria-label', chosenBy('Fay'));
  await expect(card(captain, own)).toHaveAttribute('aria-label', chosenBy(`${name} and Fay`));
  for (const page of [table.captains[other], table.guessers[other], table.spectator, table.screen]) {
    await expect(page.locator('.board .choosers')).toHaveCount(0);
  }

  // Revealing a card clears every choice, while the turn goes on.
  await student.locator('.guess-bar button.primary').click();
  await expect(card(student, own)).toHaveClass(/revealed/);
  await expect(student.locator('.guess-bar')).toBeVisible();
  for (const page of [student, fay, captain]) {
    await expect(page.locator('.board .choosers, .board .selected')).toHaveCount(0);
  }
  for (const recorded of states) expect(expectOwnGroupOnly(recorded)).toBeGreaterThan(0);
});

test('students write to their group, the PI only reads, and nobody else sees the chat', async ({ browser }) => {
  const { table, team, other, fay, student, name, states } = await groupOfTwo(browser);
  const chat = text.game.chat;
  const phone = isPhone(student);
  // Written with Enter, and back from the server as the writer's own message. The input is empty
  // before the server has answered, so it says nothing about whether the message was taken.
  const write = async (page: Page, line: string) => {
    const own = page.locator('.chat .message.own');
    const before = await own.count();
    await page.getByLabel(chat.input).fill(line);
    await page.getByLabel(chat.input).press('Enter');
    await expect(own).toHaveCount(before + 1);
    await expect(own.last().locator('.text')).toHaveText(line);
  };

  // On a wide screen the student writes straight into the panel, with nothing to open first, and
  // Fay reads the message there as it comes; on a phone her button counts it until she opens the
  // sheet.
  await chatOf(student);
  await write(student, 'Second row, on the left?');
  if (phone) await expect(fay.locator('.open-chat .badge')).toHaveText('1');
  else await expect(fay.locator('.chat-panel .message')).toHaveCount(1);
  const fayChat = await chatOf(fay);
  await expect(fayChat.locator('.message')).toHaveCount(1);
  await expect(fayChat.locator('.message .name')).toHaveText(name);
  await expect(fayChat.locator('.message .text')).toHaveText('Second row, on the left?');
  await expect(fay.locator('.badge')).toHaveCount(0);
  await write(fay, 'Yes, and the card next to it');
  await expect(student.locator('.chat .message')).toHaveCount(2);

  // The PI reads the chat but can't write in it.
  const captain = table.captains[team];
  const captainChat = await chatOf(captain);
  await expect(captainChat.locator('.message')).toHaveCount(2);
  await expect(captain.getByLabel(chat.input)).toHaveCount(0);
  await expect(captainChat).toContainText(chat.readOnly);

  // The other group has a chat of its own, which is empty; spectators and screens have none.
  await expect(await chatOf(table.guessers[other])).toContainText(chat.empty);
  for (const page of [table.spectator, table.screen]) {
    await expect(page.locator('.open-chat, .chat-panel')).toHaveCount(0);
  }
  for (const recorded of states) expect(expectOwnGroupOnly(recorded)).toBeGreaterThan(0);
});

test("a student's half-written line outlives the sheet's closing and the page's change of width", async ({
  browser,
}) => {
  const table = await seatTable(browser, 'en');
  const student = table.guessers.red;
  const input = () => student.getByLabel(text.game.chat.input);
  await chatOf(student);
  await input().fill('Second row, on the');
  if (isPhone(student)) {
    // The sheet closes, for a look at the board, and opens again.
    await closeSheet(student);
    await expect(input()).toHaveCount(0);
    await chatOf(student);
    await expect(input()).toHaveValue('Second row, on the');
    return;
  }
  // The page changes width, as a tablet turns: the panel gives way to the button and the sheet, and
  // the line is still there, and there again once the page is wide. A desktop browser's viewport is
  // free to change like this; a phone's is its device's.
  const size = student.viewportSize();
  if (!size) throw new Error('the page has no viewport');
  await student.setViewportSize({ width: 390, height: size.height });
  await expect(student.locator('.open-chat')).toBeVisible();
  await chatOf(student);
  await expect(input()).toHaveValue('Second row, on the');
  await student.setViewportSize(size);
  await expect(student.locator('.chat-panel')).toBeVisible();
  await chatOf(student);
  await expect(input()).toHaveValue('Second row, on the');
});

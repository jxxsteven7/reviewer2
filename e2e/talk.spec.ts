import type { Browser, Locator, Page } from '@playwright/test';
import { otherTeam } from '@reviewer2/shared';
import {
  closeSheet,
  expect,
  expectOwnGroupOnly,
  giveClue,
  isPhone,
  joinByLink,
  keyCard,
  newPlayer,
  openGroups,
  playFor,
  seatSaid,
  seatTable,
  snapshotsOf,
  teamOnTurn,
  test,
  TEXT,
} from './helpers';

// Students of a group talk it over: they see each other's choices of cards and marks on them, and
// write to each other, and nobody outside the group sees any of it (docs/games/keywords.md).

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
  await expect(fay.locator('.role-banner .who')).toHaveText(seatSaid(team));
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

test("a group's students mark cards for each other, in either turn, and nobody else sees the marks", async ({
  browser,
}) => {
  const { table, team, other, fay, student, states } = await groupOfTwo(browser);
  const captain = table.captains[team];
  const tool = (page: Page, name: string) => page.locator('.mark-tools').getByRole('button', { name, exact: true });
  // Before the clue, choosing is off, and a tap marks a card, as one of the group's own at first.
  await expect(tool(student, text.game.tools.choose)).toBeDisabled();
  await expect(tool(student, text.game.tools.ours)).toHaveAttribute('aria-pressed', 'true');
  // Each tool is 44 px high to the finger: a tap just above or below it, on the pill's padding,
  // lands on it.
  await student.locator('.mark-tools').scrollIntoViewIfNeeded();
  const reach = await student.locator('.mark-tools .tool').evaluateAll((tools) =>
    tools.map((button) => {
      const { left, right, top, bottom } = button.getBoundingClientRect();
      const x = (left + right) / 2;
      return [top - 1, bottom + 1].every((y) => button.contains(document.elementFromPoint(x, y)));
    }),
  );
  expect(reach).toEqual([true, true, true, true]);
  const own = await keyCard(captain, team);
  const theirs = await keyCard(captain, other);
  await card(student, own).click();
  await expect(card(fay, own)).toHaveClass(new RegExp(`note-${team}`));
  await expect(card(fay, own)).toHaveAttribute('aria-label', /, marked as ours$/);

  // Fay marks another card as the other group's, and the student takes the first mark off again.
  await tool(fay, text.game.tools.theirs).click();
  await card(fay, theirs).click();
  await expect(card(student, theirs)).toHaveClass(new RegExp(`note-${other}`));
  await card(student, own).click();
  await expect(card(fay, own)).not.toHaveClass(/noted/);

  // The other group's marks are its own; no PI, spectator or screen has marks or the tools.
  await card(table.guessers[other], own).click();
  await expect(card(table.guessers[other], own)).toHaveClass(new RegExp(`note-${other}`));
  await expect(card(student, own)).not.toHaveClass(/noted/);
  for (const page of [captain, table.captains[other], table.spectator, table.screen]) {
    await expect(page.locator('.board .noted')).toHaveCount(0);
    await expect(page.locator('.mark-tools')).toHaveCount(0);
  }

  // The group's guess phase comes: choosing is back, and the marks stay.
  await giveClue(captain, 'Hint', 2, 'en');
  await expect(tool(student, text.game.tools.choose)).toHaveAttribute('aria-pressed', 'true');
  await expect(card(student, theirs)).toHaveClass(new RegExp(`note-${other}`));
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

test('after the game the group talks it over, its PI too, and the review shows it last', async ({ browser }) => {
  const { table, team, other, student, name, states } = await groupOfTwo(browser);
  const chat = text.game.chat;
  const chair = table.captains.red;
  await chair.getByRole('button', { name: text.game.end }).click();
  await chair.locator('[role=dialog]').getByRole('button', { name: text.game.end }).click();
  for (const page of [...Object.values(table.captains), ...Object.values(table.guessers)]) {
    await expect(page.locator('.letter').first()).toBeVisible();
  }

  // The student and the PI both write; the other group sees none of it.
  const captain = table.captains[team];
  for (const [page, line] of [
    [student, 'That was close'],
    [captain, 'Should have said Gradient'],
  ] as const) {
    const thread = await chatOf(page);
    await expect(thread).toContainText(chat.review);
    await page.getByLabel(chat.input).fill(line);
    await page.getByLabel(chat.input).press('Enter');
    await expect(page.locator('.chat .message.own .text').last()).toHaveText(line);
    if (isPhone(page)) await closeSheet(page);
  }
  const thread = await chatOf(student);
  await expect(thread.locator('.turn').last().locator('.turn-title')).toHaveText(chat.after);
  await expect(thread.locator('.turn').last().locator('.message .text')).toHaveText([
    'That was close',
    'Should have said Gradient',
  ]);
  if (isPhone(student)) await closeSheet(student);
  await expect(await chatOf(table.guessers[other])).not.toContainText('That was close');
  if (isPhone(table.guessers[other])) await closeSheet(table.guessers[other]);
  for (const page of [table.spectator, table.screen]) {
    await expect(page.locator('.open-chat, .chat-panel')).toHaveCount(0);
  }

  // The review ends with it, under its own heading.
  await student.getByRole('button', { name: text.game.review }).click();
  const talk = student.locator('[role=dialog] .talk');
  await expect(talk.locator('h3')).toHaveText(text.replay.talk);
  await expect(talk.locator('.line .name')).toHaveText([name, table.names.captains[team]]);
  for (const recorded of states) expect(expectOwnGroupOnly(recorded)).toBeGreaterThan(0);
});

test('on a phone the chat brings up the keyboard only while it is empty, and keeps the line above it', async ({
  browser,
}) => {
  const { student, fay } = await groupOfTwo(browser);
  test.skip(!isPhone(student), 'The chat is a sheet on a phone alone.');
  const input = (page: Page) => page.getByLabel(text.game.chat.input);
  // Nothing to read yet: the input takes the focus, which brings the keyboard up.
  await student.locator('.open-chat').click();
  await expect(input(student)).toBeFocused();
  await closeSheet(student);
  await chatOf(fay);
  for (let line = 1; line <= 12; line += 1) {
    await input(fay).fill(`Line ${line}`);
    await input(fay).press('Enter');
    // One at a time: a line sent while the one before is on its way waits in the input.
    await expect(fay.locator('.chat .message.own')).toHaveCount(line);
  }
  await expect(fay.locator('.chat .message.own')).toHaveCount(12);
  // Messages to read: the sheet itself takes the focus, and no keyboard comes up.
  await student.locator('.open-chat').click();
  const sheet = student.locator('[role=dialog]');
  await expect(sheet).toBeFocused();
  await expect(input(student)).not.toBeFocused();
  // The keyboard comes up as the student taps the input, and takes the bottom of the screen: the
  // sheet keeps above it, the input in sight at its foot and the newest message above it, while the
  // messages scroll.
  await input(student).click();
  const size = student.viewportSize();
  if (!size) throw new Error('the page has no viewport');
  const left = Math.round(size.height * 0.55);
  await student.setViewportSize({ width: size.width, height: left });
  await expect(async () => {
    const box = await input(student).boundingBox();
    expect(box).not.toBeNull();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(left);
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  }).toPass();
  const list = sheet.locator('.turns');
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect(sheet.locator('.message').last()).toBeInViewport();
  await student.setViewportSize(size);
  await expect(input(student)).toBeInViewport();
});

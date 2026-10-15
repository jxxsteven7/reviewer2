import type { Browser, Locator, Page } from '@playwright/test';
import { otherTeam } from '@reviewer2/shared';
import {
  chooseCard,
  closeSheet,
  expect,
  expectOwnGroupOnly,
  giveClue,
  isPhone,
  joinByLink,
  keyCard,
  nameOf,
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
  await joinByLink(fay, table.url, 'en', { watch: true });
  const fayStates = snapshotsOf(fay);
  await openGroups(fay);
  await fay.getByRole('button', playFor(team)).click();
  await closeSheet(fay);
  await expect(fay.locator('.strip .who')).toHaveText(seatSaid(team));
  const student = table.guessers[team];
  const name = table.names.guessers[team];
  return {
    table,
    team,
    other,
    fay,
    fayStates,
    fayName: nameOf(fay),
    student,
    name,
    states: [...table.everyone, fayStates],
  };
}

// Holding a card down opens the menu of marks (MarkMenu.vue), where the student chooses one: the
// card's own takes it off again.
async function holdToMark(page: Page, index: number, mark: keyof typeof text.game.gestures.marks): Promise<void> {
  const found = await card(page, index).boundingBox();
  if (!found) throw new Error('the card has no box');
  await page.mouse.move(found.x + found.width / 2, found.y + found.height / 2);
  await page.mouse.down();
  const menu = page.locator('.mark-menu [role=menu]');
  await expect(menu).toBeVisible();
  await page.mouse.up();
  await menu.getByRole('menuitemradio', { name: text.game.gestures.marks[mark] }).click();
  await expect(page.locator('.mark-menu')).toHaveCount(0);
}

// Where a box of the page is, as the browser lays it out.
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The card that lifts while the menu of marks is open is a copy, measured from the card at rest,
// not where the press sank it 3 pixels down and to the right; it lands where the card is as the menu
// closes, also when the page has scrolled meanwhile, and the card shows again only once it has
// landed (MarkMenu.vue).
test('the lifted copy of a card starts where the card rests, and lands where it is when the menu closes', async ({
  browser,
  browserName,
}) => {
  // Headless WebKit on a runner without a GPU draws the blurred scrim behind the menu so slowly
  // that it draws nothing while the menu stands, a scroll included, and hears the end of the
  // copy's move only after the menu has given up waiting for it: the landing can't be watched there.
  test.skip(browserName === 'webkit', 'WebKit draws nothing behind the menu on the runner');
  const table = await seatTable(browser, 'en');
  const student = table.guessers.red;
  // A card in the board's middle row, which is in sight at the top of the page with room to scroll
  // further on either screen.
  const target = card(student, 12);
  await student.evaluate(() => window.scrollTo(0, 0));
  await expect(target).toBeInViewport();
  const rest = await target.boundingBox();
  if (!rest) throw new Error('the card has no box');
  await student.mouse.move(rest.x + rest.width / 2, rest.y + rest.height / 2);
  await student.mouse.down();
  await expect(student.locator('.mark-menu [role=menu]')).toBeVisible();
  await student.mouse.up();
  // The copy's own box, before it lifts by a transform of its own.
  const placed = await student.locator('.mark-menu .lifted').evaluate((lifted): Box => ({
    x: parseFloat(lifted.style.left),
    y: parseFloat(lifted.style.top),
    width: parseFloat(lifted.style.width),
    height: parseFloat(lifted.style.height),
  }));
  for (const side of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(placed[side] - rest[side]), `the copy's ${side} as the card's at rest`).toBeLessThanOrEqual(0.5);
  }

  // The page scrolls under the menu, as a finger can drag it, and the menu closes: where the copy
  // is as its move ends, which is where it stays until the card shows again, and, in every frame
  // until the menu has gone, whether the card shows beside it. The frames alone can't say where
  // the copy landed: a machine that is slow to draw may draw none between the end of the move and
  // the menu going.
  await student.evaluate(() => window.scrollBy(0, 90));
  const now = await target.boundingBox();
  if (!now) throw new Error('the card has no box');
  expect(Math.round(rest.y - now.y), 'how far the page scrolled').toBe(90);
  await student.evaluate(() => {
    const frames: boolean[] = [];
    const landed: Box[] = [];
    Object.assign(window, { frames_: frames, landed_: landed });
    const card = document.querySelectorAll('.board .card')[12] as Element;
    const lifted = document.querySelector('.mark-menu .lifted') as HTMLElement;
    // Heard on the way down, before the menu's own listener, which takes the copy out.
    document.addEventListener(
      'transitionend',
      (event) => {
        if (event.target !== lifted || event.propertyName !== 'transform') return;
        const { x, y, width, height } = lifted.getBoundingClientRect();
        landed.push({ x, y, width, height });
      },
      true,
    );
    const tick = () => {
      if (!document.querySelector('.mark-menu .lifted')) return;
      frames.push(getComputedStyle(card).visibility !== 'hidden');
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await student.keyboard.press('Escape');
  await expect(student.locator('.mark-menu')).toHaveCount(0);
  const { frames, landed } = await student.evaluate(() => {
    const { frames_, landed_ } = window as unknown as { frames_: boolean[]; landed_: Box[] };
    return { frames: frames_, landed: landed_ };
  });
  const last = landed.at(-1);
  if (!last) throw new Error('the copy never landed');
  for (const side of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(last[side] - now[side]), `the landed copy's ${side} as the card's`).toBeLessThanOrEqual(1);
  }
  expect(
    frames.filter((shown) => shown),
    'frames in which the card showed beside its copy',
  ).toEqual([]);
  await expect(target).toHaveCSS('visibility', 'visible');
});

// The menu of marks lies over the page, fixed to the screen: a page scrolled down to the board stays
// where it is as the menu takes the focus, and as it gives it back to the card.
test.describe('on a phone scrolled to the board', () => {
  test.use({ viewport: { width: 390, height: 420 } });

  test('the menu of marks leaves the page where it is', async ({ browser }) => {
    const table = await seatTable(browser, 'en');
    const student = table.guessers.red;
    const target = card(student, 12);
    await target.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    const scrolled = await student.evaluate(() => window.scrollY);
    expect(scrolled, 'the page scrolled to the board').toBeGreaterThan(0);
    const rest = await target.boundingBox();
    if (!rest) throw new Error('the card has no box');
    await student.mouse.move(rest.x + rest.width / 2, rest.y + rest.height / 2);
    await student.mouse.down();
    await expect(student.locator('.mark-menu [role=menu]')).toBeVisible();
    await student.mouse.up();
    expect(await student.evaluate(() => window.scrollY), 'the page under the open menu').toBe(scrolled);
    await student.keyboard.press('Escape');
    await expect(student.locator('.mark-menu')).toHaveCount(0);
    expect(await student.evaluate(() => window.scrollY), 'the page once the menu has closed').toBe(scrolled);
  });
});

// The choosers of a card hang on it as avatars, and the card's accessible name says who they are.
const chosenBy = (names: string) => new RegExp(`, chosen by ${names}$`);

test("a group's students see each other's choices, and nobody else does", async ({ browser }) => {
  const { table, team, other, fay, fayName, student, name, states } = await groupOfTwo(browser);
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
  await expect(card(student, another)).toHaveAttribute('aria-label', chosenBy(fayName));
  await card(fay, another).click();
  await expect(card(student, another).locator('.choosers')).toHaveCount(0);
  await card(fay, own).click();
  await expect(card(student, own)).toHaveAttribute('aria-label', chosenBy(fayName));
  await expect(card(captain, own)).toHaveAttribute('aria-label', chosenBy(`${name} and ${fayName}`));
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

test("a group's students mark cards for each other from a menu, which their PI reads and nobody else sees", async ({
  browser,
}) => {
  const { table, team, other, fay, student, states } = await groupOfTwo(browser);
  const captain = table.captains[team];
  // No tools to pick: the line under the board says how to mark a card, and a tap chooses nothing
  // before the group's clue.
  await expect(student.locator('.mark-tools')).toHaveCount(0);
  await expect(student.locator('.play .gestures')).toHaveText(text.game.gestures.mark);
  const own = await keyCard(captain, team);
  const theirs = await keyCard(captain, other);
  const paper = await keyCard(captain, 'neutral');
  await card(student, own).click();
  await expect(card(student, own)).not.toHaveClass(/noted|selected/);
  await expect(student.locator('.mark-menu')).toHaveCount(0);
  // Held down: the menu, and one of the group's own.
  await holdToMark(student, own, 'ours');
  await expect(card(fay, own)).toHaveClass(new RegExp(`note-${team}`));
  await expect(card(fay, own)).toHaveAttribute('aria-label', /, marked as ours$/);
  // The group's PI reads it, small in the corner, on the card's own tint; the other PI doesn't.
  await expect(card(captain, own).locator('.note')).toBeVisible();
  await expect(card(captain, own)).toHaveAttribute('aria-label', /, marked as ours$/);
  await expect(card(captain, own)).not.toHaveClass(/noted/);
  await expect(table.captains[other].locator('.board .note')).toHaveCount(0);

  // Fay marks another card as the other group's from the menu that a right click opens, and a
  // third as maybe Reviewer 2 by holding it down; Escape closes the menu with the card as it was,
  // and the student takes the first mark off again by choosing it once more.
  await card(fay, theirs).click({ button: 'right' });
  await fay.locator('.mark-menu').getByRole('menuitemradio', { name: text.game.gestures.marks.theirs }).click();
  await expect(card(student, theirs)).toHaveClass(new RegExp(`note-${other}`));
  await holdToMark(fay, paper, 'r2');
  await expect(card(student, paper)).toHaveClass(/note-r2/);
  await card(student, own).click({ button: 'right' });
  const menu = student.locator('.mark-menu [role=menu]');
  await expect(menu.getByRole('menuitemradio', { name: text.game.gestures.marks.ours })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await student.keyboard.press('Escape');
  await expect(student.locator('.mark-menu')).toHaveCount(0);
  await expect(card(fay, own)).toHaveClass(new RegExp(`note-${team}`));
  await holdToMark(student, own, 'ours');
  await expect(card(fay, own)).not.toHaveClass(/noted/);
  // From the keyboard, 1 marks the card that has the focus as one of the group's own.
  await card(student, own).focus();
  await student.keyboard.press('1');
  await expect(card(fay, own)).toHaveClass(new RegExp(`note-${team}`));

  // The other group's marks are its own; no spectator or screen has marks.
  await holdToMark(table.guessers[other], paper, 'ours');
  await expect(card(table.guessers[other], paper)).toHaveClass(new RegExp(`note-${other}`));
  await expect(card(student, paper)).toHaveClass(/note-r2/);
  for (const page of [table.spectator, table.screen]) await expect(page.locator('.board .note')).toHaveCount(0);

  // The group's guess phase comes: one tap chooses, and the marks stay.
  await giveClue(captain, 'Hint', 2, 'en');
  await expect(student.locator('.guess-bar .hint')).toHaveText(text.game.gestures.choose);
  await chooseCard(student, theirs);
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
  // The keyboard takes its time, longer than the page waits before it looks at the list again.
  await student.waitForTimeout(600);
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

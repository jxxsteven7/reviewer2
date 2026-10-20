import type { Page } from '@playwright/test';
import { expect, newPlayer, redWins, register, roomMenu, seatTable, TEXT, test } from './helpers';

// The tutorial end to end (docs/architecture.md#the-tutorial): a guest finds it on the home page
// and reads a game's chapter from its first step to its last, by its buttons, the arrow keys and the
// part that the finger is at, which is all the scene takes; the card that the finger holds down
// opens the game's own menu of marks; the chapter's last step opens the practice sheet, which asks
// the guest to log in. A reader comes back to the step they left from the contents. A PI's clue
// goes through the game's own checks, and nothing of the tutorial is sent as a game. An account
// that has finished a game finds the small word beside the rules in place of the sticker.
const own = (name: string) => `${name}${Math.random().toString(36).slice(2, 7)}`;

// A card of the invented board, by its place on it (client/src/games/keywords/guide/demo.ts).
const card = (page: Page, index: number) => page.locator('.stage .board > .card').nth(index);
const BLACK_HOLE = 0;
const TELESCOPE = 5;
const P_VALUE = 22;

for (const language of ['en', 'zh'] as const) {
  test(`a guest reads how to play a student from the first step to the last, and is asked to log in for a real game, in ${language}`, async ({
    browser,
  }) => {
    const text = TEXT[language];
    const { guide } = text;
    const student = guide.chapters.student;
    const page = await newPlayer(browser, language);
    await page.goto(`/?lang=${language}`);

    // The tutorial's sticker stands in the game's card for a guest.
    await page.locator('.entry .guide-entry').click();
    await page.waitForURL(/\/guide$/);
    await expect(page.locator('.chapter')).toHaveCount(10);
    await page.locator('.chapter', { hasText: student.title }).click();
    await page.waitForURL(/\/guide\/student\/1$/);
    const coach = page.locator('.guide-coach');
    const finger = page.locator('.finger-layer .finger');
    const at = async (step: number) => {
      await page.waitForURL(new RegExp(`/student/${step}$`));
      await expect(coach.locator('.coach-title')).toHaveText(student.steps[`${step}` as '1'].title);
    };
    await at(1);
    await expect(finger.locator('.hand')).toBeVisible();
    // The game is invented: the tab's title is the chapter's, not "Your turn!".
    await expect(page).toHaveTitle(new RegExp(`^${student.title}`));

    // On, by the button, then the key.
    await coach.getByRole('button', { name: guide.next, exact: true }).click();
    await at(2);
    await page.keyboard.press('ArrowRight');
    await at(3);
    // The card that the finger taps goes on; any other tap does nothing.
    await card(page, 1).click();
    await expect(page).toHaveURL(/\/student\/3$/);
    await card(page, BLACK_HOLE).click();
    await at(4);
    await page.locator('.stage .guess-bar .button.primary').click();
    await at(5);
    await card(page, TELESCOPE).click();
    await at(6);
    await page.locator('.stage .guess-bar .button.primary').click();
    await at(7);
    await page.keyboard.press('ArrowRight');
    await at(8);

    // The card that the finger holds down opens the game's menu of marks, where the reader marks
    // it as the other group's; the mark stays, the finger goes, and the step goes on by its button.
    // The page is still bringing the card into view as the step opens: the pointer goes to the
    // card once it stands still.
    await expect(finger).toHaveClass(/hold/);
    await card(page, P_VALUE).hover();
    await page.mouse.down();
    const menu = page.locator('.mark-menu [role=menu]');
    await expect(menu).toBeVisible();
    await page.mouse.up();
    await menu.getByRole('menuitemradio', { name: text.game.gestures.marks.theirs }).click();
    await expect(page.locator('.mark-menu')).toHaveCount(0);
    await expect(card(page, P_VALUE)).toHaveClass(/note-blue/);
    await expect(finger).toHaveCount(0);
    await expect(page).toHaveURL(/\/student\/8$/);
    await coach.getByRole('button', { name: guide.next, exact: true }).click();
    await at(9);
    await expect(card(page, P_VALUE)).toHaveClass(/note-blue/);
    await page.keyboard.press('ArrowRight');
    await at(10);
    await page.locator('.stage .guess-bar .buttons .button').nth(1).click();
    await at(11);
    await page.keyboard.press('ArrowRight');
    await at(12);
    await expect(page.locator('.stage .clue-log, .stage .log').first()).toBeVisible();

    // The last step opens the practice sheet, in the role the chapter taught, which asks a guest
    // to log in; nothing was sent as a game.
    await coach.getByRole('button', { name: guide.end.play }).click();
    await page.waitForURL((url) => url.pathname === '/' && url.search === '');
    const sheet = page.locator('[role=dialog]');
    await expect(sheet).toContainText(text.home.practice.loginTitle);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);

    // Read to the end, the chapter is done, and nothing is left to go on with.
    await page.goto('/guide');
    await expect(page.locator('.chapter', { hasText: student.title }).locator('.state')).toHaveText(guide.state.done);
    await expect(page.locator('.resume')).toHaveCount(0);
  });
}

test('a reader goes back by the key, and comes back from the contents to the step they left', async ({ browser }) => {
  const { guide } = TEXT.en;
  const page = await newPlayer(browser, 'en');
  await page.goto('/?lang=en');
  await page.goto('/guide/student/3');
  await expect(page.locator('.guide-coach .coach-title')).toHaveText(guide.chapters.student.steps['3'].title);
  await page.keyboard.press('ArrowLeft');
  await page.waitForURL(/\/student\/2$/);
  await page.locator('.guide-bar').getByRole('link', { name: guide.contents }).click();
  await page.waitForURL(/\/guide$/);
  await expect(page.locator('.chapter', { hasText: guide.chapters.student.title }).locator('.state')).toHaveText(
    'At step 2',
  );
  await page.locator('.resume').click();
  await page.waitForURL(/\/student\/2$/);
  await page.keyboard.press('Escape');
  await page.waitForURL(/\/guide$/);
});

test("a PI's clue in the tutorial is checked as in a game, and given, goes on", async ({ browser }) => {
  const { guide, game } = TEXT.en;
  const page = await newPlayer(browser, 'en');
  await page.goto('/?lang=en');
  await page.goto('/guide/pi/3');
  const clue = page.locator('.stage .clue-panel');
  await expect(clue.locator('input.word')).toHaveValue(guide.demo.words['12']);
  await expect(clue.locator('.problem')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.waitForURL(/\/pi\/4$/);
  await expect(clue.locator('input.word')).toHaveValue(guide.demo.clues.astro);
  await clue.getByRole('button', { name: game.sendClue }).click();
  await page.waitForURL(/\/pi\/5$/);
});

// The finger's tap and hold are drawn by CSS animations, which stand still where the device asks
// for less motion.
test('the finger stands still where the device asks for less motion', async ({ browser }) => {
  const page = await newPlayer(browser, 'en');
  await page.goto('/?lang=en');
  await page.goto('/guide/student/3');
  const ripple = page.locator('.finger-layer .finger.tap .ripple');
  await expect(ripple).toHaveCount(1);
  const animation = () => ripple.evaluate((el) => getComputedStyle(el).animationName);
  await expect.poll(animation).not.toBe('none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(animation).toBe('none');
  await page.goto('/guide/student/8');
  const ring = page.locator('.finger-layer .finger.hold .hold-ring circle');
  await expect(ring).toHaveCount(1);
  expect(await ring.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});

// An account that has played no game of the first game finds the tutorial's sticker in the
// game's card, and once it has finished a game, the small word beside the rules in its place: at
// once, as it comes back to the home page by the room's own way out, without a reload, since the
// page asks for the account again as it opens.
test("an account that has finished a game finds the small word beside the rules in the sticker's place", async ({
  browser,
}) => {
  const name = own('ann');
  const table = await seatTable(browser, 'en', async (page, seat) => {
    if (seat !== 'Ann') return;
    await page.goto('/?lang=en');
    await register(page, name);
    await expect(page.locator('.entry .guide-entry')).toBeVisible();
    await expect(page.locator('.guide-link')).toHaveCount(0);
  });
  await redWins(table, 'en');
  const ann = table.captains.red;
  await (await roomMenu(ann)).getByRole('button', { name: TEXT.en.room.leave }).click();
  await ann.getByRole('dialog', { name: TEXT.en.room.leave }).getByRole('button', { name: TEXT.en.room.leave }).click();
  await ann.waitForURL(/\/$/);
  await expect(ann.locator('.entry .title .guide-link')).toHaveText(TEXT.en.guide.entry.link);
  await expect(ann.locator('.guide-entry')).toHaveCount(0);
});

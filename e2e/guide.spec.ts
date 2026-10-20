import { expect, newPlayer, register, TEXT, test } from './helpers';

// The tutorial end to end (docs/architecture.md#the-tutorial): an account that hasn't played finds
// it on the home page, reads a game's chapter step by step, by its buttons, the arrow keys and the
// part that the finger is at, which is all the scene takes, and comes back to it from the contents
// where it left off; the chapter's last step opens the practice sheet with the role it taught. A
// PI's clue goes through the game's own checks, and nothing of the tutorial is sent as a game.
const own = (name: string) => `${name}${Math.random().toString(36).slice(2, 7)}`;

for (const language of ['en', 'zh'] as const) {
  test(`a newcomer reads how to play a student, and goes on to a real game in that role, in ${language}`, async ({
    browser,
  }) => {
    const { guide } = TEXT[language];
    const student = guide.chapters.student;
    const page = await newPlayer(browser, language);
    await page.goto(`/?lang=${language}`);
    await register(page, own('ann'));

    await page.locator('.entry .guide-entry').click();
    await page.waitForURL(/\/guide$/);
    await expect(page.locator('.chapter')).toHaveCount(10);
    await page.locator('.chapter', { hasText: student.title }).click();
    await page.waitForURL(/\/guide\/student\/1$/);
    const coach = page.locator('.guide-coach');
    await expect(coach.locator('.coach-title')).toHaveText(student.steps['1'].title);
    await expect(page.locator('.finger-layer .finger .hand')).toBeVisible();

    // On, by the button, then the key; the card that the finger taps goes on too, and any other
    // tap does nothing.
    await coach.getByRole('button', { name: guide.next, exact: true }).click();
    await page.waitForURL(/\/student\/2$/);
    await page.keyboard.press('ArrowRight');
    await page.waitForURL(/\/student\/3$/);
    await expect(coach.locator('.coach-title')).toHaveText(student.steps['3'].title);
    await page.locator('.stage .board > .card').nth(1).click();
    await expect(page).toHaveURL(/\/student\/3$/);
    await page.locator('.stage .board > .card').first().click();
    await page.waitForURL(/\/student\/4$/);
    await page.keyboard.press('ArrowLeft');
    await page.waitForURL(/\/student\/3$/);

    // The contents offer to go on where the chapter was left.
    await page.locator('.guide-bar').getByRole('link', { name: guide.contents }).click();
    await page.waitForURL(/\/guide$/);
    await page.locator('.resume').click();
    await page.waitForURL(/\/student\/3$/);

    await page.goto('/guide/student/12');
    await coach.getByRole('button', { name: guide.end.play }).click();
    await page.waitForURL((url) => url.pathname === '/' && url.search === '');
    const sheet = page.locator('[role=dialog]', { has: page.locator('.who-plays') });
    await expect(sheet.locator('.who-plays input[value="me"]')).toBeChecked();
    await expect(sheet.locator('.roles input[value="guesser"]')).toBeChecked();
    await page.keyboard.press('Escape');

    // Read to the end, the chapter is done.
    await page.goto('/guide');
    await expect(page.locator('.chapter', { hasText: student.title }).locator('.state')).toHaveText(guide.state.done);
  });
}

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

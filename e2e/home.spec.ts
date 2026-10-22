import { REPOSITORY_URL } from '@reviewer2/shared';
import { createRoom, interpolate, isPhone, newPlayer, TEXT, expect, test } from './helpers';

// The home page names the author and the build's version, and offers the reward code, which is
// served from our own server as it was given, and which the rooms never show, and for players
// without WeChat a link to GitHub Sponsors.

for (const language of ['en', 'zh'] as const) {
  test(`the home page names the author and the version, and offers a cola or GitHub Sponsors, in ${language}`, async ({
    browser,
  }) => {
    const text = TEXT[language];
    const page = await newPlayer(browser, language);
    // Creating a room goes through the home page, and the room has no reward code.
    await createRoom(page, language);
    await expect(page.getByRole('button', { name: text.footer.tip })).toHaveCount(0);
    await page.getByRole('link', { name: TEXT.en.app.name, exact: true }).click();

    // Only the author's name links to their page, once: after the line on how to play, or on an
    // English page under 30rem, after the tagline, which takes two lines there.
    const author = page.getByRole('link', { name: text.footer.author, exact: true });
    await expect(author).toHaveCount(1);
    const beside = language === 'en' && (page.viewportSize()?.width ?? 0) < 480;
    await expect(
      page.locator(beside ? '.heading' : '.intro').getByRole('link', { name: text.footer.author }),
    ).toBeVisible();
    await expect(author).toHaveAttribute('href', 'https://jxxsteven7.github.io/');
    await expect(author).toHaveAttribute('target', '_blank');
    await expect(author).toHaveAttribute('rel', 'noopener noreferrer');
    const byline = interpolate(text.footer.byline, { name: text.footer.author });
    await expect(page.locator('main').getByText(byline, { exact: true }).filter({ visible: true })).toBeVisible();

    // Beside the first game's name, its rules, at the defaults of a new room in the page's language:
    // a Chinese room's ask for no clue that sounds like a word on the board.
    await page
      .locator('.entry[data-game="keywords"] .title')
      .getByRole('button', { name: text.rules.link, exact: true })
      .click();
    const rules = page.locator('[role=dialog]', { has: page.locator('.rules') });
    await expect(rules.locator('h2')).toHaveText(text.rules.title);
    await expect(rules.locator('.defaults')).toHaveText(text.rules.defaults);
    await expect(rules).toContainText(text.rules.clueQuiet);
    if (language === 'zh') await expect(rules).toContainText(text.rules.clueSound);
    else await expect(rules).not.toContainText(text.rules.clueSound);
    await page.keyboard.press('Escape');
    await expect(rules).toHaveCount(0);

    // The foot offers the cola and the way to send feedback, whose drawings screen readers skip, each
    // a pixel above the middle of its words' line, and names the version the page was built with,
    // which is the one the server reports, as a link to the history up to it on GitHub.
    const foot = page.locator('footer');
    for (const name of [text.footer.tip, text.footer.feedback]) {
      const button = foot.getByRole('button', { name, exact: true });
      await expect(button).toBeVisible();
      // The middle of the drawing, and of the words' own line, as the browser lays them out.
      const [drawing, words] = await button.evaluate((element) => {
        const svg = element.querySelector('svg')?.getBoundingClientRect();
        const text = [...(element.querySelector('.footnote')?.childNodes ?? [])].find(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        );
        const range = document.createRange();
        if (text) range.selectNodeContents(text);
        const line = range.getBoundingClientRect();
        return [svg ? svg.top + svg.height / 2 : NaN, line.top + line.height / 2];
      });
      expect(Math.abs((words ?? NaN) - (drawing ?? NaN) - 1)).toBeLessThanOrEqual(1.5);
    }
    const { version } = (await (await page.request.get('/healthz')).json()) as { version: string };
    const label = interpolate(text.footer.version, { version });
    await expect(foot.getByText(label, { exact: true })).toBeVisible();
    const history = foot.getByRole('link', { name: interpolate(text.footer.versionLink, { version }), exact: true });
    await expect(history).toHaveText(label);
    // A build without a version, as the tests' own is, leads to the history of main.
    const commits = `${REPOSITORY_URL}/commits/`;
    if (version === 'dev') await expect(history).toHaveAttribute('href', `${commits}main`);
    else expect((await history.getAttribute('href'))?.startsWith(commits)).toBe(true);
    await expect(history).toHaveAttribute('target', '_blank');
    await expect(history).toHaveAttribute('rel', 'noopener noreferrer');
    expect((await history.boundingBox())?.height).toBe(44);

    await page.getByRole('button', { name: text.footer.tip }).click();
    const sheet = page.locator('[role=dialog]');
    await expect(sheet).toContainText(text.footer.tipHint);
    // How to ask to be on the list of sponsors, in a note of its own.
    await expect(sheet.locator('.listing')).toBeVisible();
    await expect(sheet.locator('.listing')).toContainText(text.footer.listTitle);
    await expect(sheet.locator('.listing')).toContainText(text.footer.listHow);
    const code = sheet.getByRole('img', { name: text.footer.tipCode });
    await expect(code).toBeVisible();
    // Whole, from this server, and at its full size.
    await expect(code).toHaveJSProperty('naturalWidth', 1152);
    await expect(code).toHaveJSProperty('naturalHeight', 1152);
    const src = new URL((await code.getAttribute('src')) ?? '', page.url());
    expect(src.origin).toBe(new URL(page.url()).origin);
    const response = await page.request.get(src.toString());
    expect(response.headers()['content-type']).toBe('image/jpeg');
    expect((await response.body()).length).toBe(98_899);
    // Players without WeChat are sent to GitHub Sponsors, in a new tab.
    const sponsor = sheet.getByRole('link', { name: text.footer.sponsor });
    await expect(sponsor).toHaveAttribute('href', 'https://github.com/sponsors/jxxsteven7');
    await expect(sponsor).toHaveAttribute('target', '_blank');
    await expect(sponsor).toHaveAttribute('rel', 'noopener noreferrer');
  });
}

// On a wide screen the games stand on the right, and the left column is at least 30rem wide, so
// that the tagline stays on one line where the columns are at their narrowest, in both languages.
test('the tagline stays on one line where the columns are narrowest', async ({ browser }, testInfo) => {
  test.skip(isPhone(testInfo), 'on a wide screen only');
  for (const language of ['en', 'zh'] as const) {
    const page = await newPlayer(browser, language);
    await page.setViewportSize({ width: 960, height: 800 });
    await page.goto('/');
    await page.getByRole('link', { name: new RegExp(`^${TEXT[language].language[language]}`) }).click();
    const tagline = page.getByRole('heading', { level: 1, name: TEXT[language].app.tagline });
    await expect(tagline).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const lines = await tagline.evaluate((heading) => {
      const range = document.createRange();
      range.selectNodeContents(heading);
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
    });
    expect(lines, `the ${language} tagline at 960 px`).toBe(1);
    await page.context().close();
  }
});

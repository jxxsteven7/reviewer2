import { createRoom, interpolate, newPlayer, TEXT, expect, test } from './helpers';

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
    await createRoom(page, language, 'Ann');
    await expect(page.getByRole('button', { name: text.footer.tip })).toHaveCount(0);
    await page.getByRole('link', { name: TEXT.en.app.name, exact: true }).click();

    // Only the author's name links to their page.
    const author = page.getByRole('link', { name: text.footer.author, exact: true });
    await expect(author).toHaveAttribute('href', 'https://jxxsteven7.github.io/');
    await expect(author).toHaveAttribute('target', '_blank');
    await expect(author).toHaveAttribute('rel', 'noopener noreferrer');
    const byline = interpolate(text.footer.byline, { name: text.footer.author });
    await expect(page.locator('footer').getByText(byline, { exact: true })).toBeVisible();

    // The foot names the version the page was built with, which is the one the server reports.
    const { version } = (await (await page.request.get('/healthz')).json()) as { version: string };
    const label = interpolate(text.footer.version, { version });
    await expect(page.locator('footer').getByText(label, { exact: true })).toBeVisible();

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

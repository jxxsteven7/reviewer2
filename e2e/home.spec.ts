import { createRoom, newPlayer, TEXT, expect, test } from './helpers';

// The home page names the author and offers the reward code, which is served from our own server
// as it was given, and which the rooms never show.

for (const language of ['en', 'zh'] as const) {
  test(`the home page names the author and offers a cola, in ${language}`, async ({ browser }) => {
    const text = TEXT[language];
    const page = await newPlayer(browser, language);
    // Creating a room goes through the home page, and the room has no reward code.
    await createRoom(page, language, 'Ann');
    await expect(page.getByRole('button', { name: text.footer.tip })).toHaveCount(0);
    await page.getByRole('link', { name: TEXT.en.app.name, exact: true }).click();

    const byline = page.getByRole('link', { name: text.footer.byline });
    await expect(byline).toHaveAttribute('href', 'https://jxxsteven7.github.io/');
    await expect(byline).toHaveAttribute('target', '_blank');
    await expect(byline).toHaveAttribute('rel', 'noopener noreferrer');

    await page.getByRole('button', { name: text.footer.tip }).click();
    const sheet = page.locator('[role=dialog]');
    await expect(sheet).toContainText(text.footer.tipHint);
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
  });
}

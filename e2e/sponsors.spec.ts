import { rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPONSORS_END, SPONSORS_START } from '@reviewer2/shared';
import { expect, interpolate, newPlayer, plural, TEXT, test } from './helpers';

// The sponsors at the foot of the home page: while there are none, the fold asks for the first;
// and the server shows SPONSORS.md from CONTENT_DIR, which e2e/server.mjs sets, as it changes
// there, without a new build or a restart.

const contentDir = process.env.E2E_CONTENT_DIR as string;

for (const language of ['en', 'zh'] as const) {
  test(`while there are no sponsors, the fold asks for the first, in ${language}`, async ({ browser }) => {
    const text = TEXT[language];
    const page = await newPlayer(browser, language);
    // Whatever another test has written to CONTENT_DIR, this one sees an empty list.
    await page.route('**/api/sponsors', (route) => route.fulfill({ json: { ok: true, sections: [] } }));
    await page.goto('/');
    await page.getByRole('button', { name: new RegExp(`^${text.language[language]}`) }).click();

    const fold = page.locator('.fold.sponsors');
    // With nobody to count, the card's title is the list's name alone.
    await expect(fold.locator('h2')).toHaveText(text.sponsors.title);
    await fold.locator('h2 button').click();
    await expect(fold).toContainText(text.sponsors.intro);
    await expect(fold).toContainText(
      interpolate(text.sponsors.none, { github: text.sponsors.github, wechat: text.sponsors.wechat }),
    );
    const github = fold.getByRole('link', { name: text.sponsors.github });
    await expect(github).toHaveAttribute('href', 'https://github.com/sponsors/jxxsteven7');
    await expect(github).toHaveAttribute('target', '_blank');
    await expect(github).toHaveAttribute('rel', 'noopener noreferrer');
    // The WeChat tip is the one the foot of the page offers.
    await fold.getByRole('button', { name: text.sponsors.wechat }).click();
    await expect(page.locator('[role=dialog]').getByRole('img', { name: text.footer.tipCode })).toBeVisible();
  });
}

test('the home page shows SPONSORS.md as the server finds it in CONTENT_DIR', async ({ browser }, testInfo) => {
  // One browser is enough for what the server does, and only one test may write the file at a time.
  test.skip(testInfo.project.name !== 'desktop-chromium', 'the server is the same for every browser');
  const text = TEXT.en;
  const file = join(contentDir, 'SPONSORS.md');
  const write = (sponsors: string[], time: number) => {
    const github = sponsors.map((name) => `- [${name}](https://github.com/${name})`);
    writeFileSync(
      file,
      [
        '# Sponsors',
        '',
        SPONSORS_START,
        '## GitHub Sponsors',
        '',
        ...github,
        SPONSORS_END,
        '',
        '## Other ways',
        '',
        '- Dr\\. Who',
        '',
      ].join('\n'),
    );
    utimesSync(file, time, time);
  };
  const page = await newPlayer(browser, 'en');
  try {
    write(['octocat'], 1_000_000);
    await page.goto('/');
    await page.getByRole('button', { name: /^English/ }).click();
    const fold = page.locator('.fold.sponsors');
    await expect(fold.locator('h2')).toHaveText(plural(text.sponsors.counted, 2));
    await fold.locator('h2 button').click();
    await expect(fold.locator('h3')).toHaveText([text.sponsors.kinds.github, text.sponsors.kinds.other]);
    await expect(fold.locator('li')).toHaveText(['octocat', 'Dr. Who']);
    const octocat = fold.getByRole('link', { name: 'octocat' });
    await expect(octocat).toHaveAttribute('href', 'https://github.com/octocat');
    await expect(octocat).toHaveAttribute('rel', 'nofollow ugc noopener');
    await expect(octocat).toHaveAttribute('target', '_blank');

    // A new list arrives, and the next visit shows it.
    write(['octocat', 'Mona-Lisa'], 1_000_100);
    await page.reload();
    await expect(fold.locator('h2')).toHaveText(plural(text.sponsors.counted, 3));
    await fold.locator('h2 button').click();
    await expect(fold.locator('li')).toHaveText(['octocat', 'Mona-Lisa', 'Dr. Who']);
  } finally {
    rmSync(file, { force: true });
  }
});

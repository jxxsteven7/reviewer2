import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAcknowledgments } from '@reviewer2/shared';
import { expect, newPlayer, TEXT, test } from './helpers';

// The acknowledgments on the home page: ACKNOWLEDGMENTS.md as the maintainers wrote it, whatever
// the page's language, under a title that counts nobody. The feedback contributions come first,
// from the database (contributions.spec.ts), and the sponsors last (sponsors.spec.ts).
const file = parseAcknowledgments(readFileSync(join(import.meta.dirname, '..', 'ACKNOWLEDGMENTS.md'), 'utf8'));

test('the home page shows ACKNOWLEDGMENTS.md as it is written, between the contributions and the sponsors', async ({
  browser,
}) => {
  for (const language of ['en', 'zh'] as const) {
    const words = TEXT[language];
    const page = await newPlayer(browser, language);
    await page.goto('/');
    await page.getByRole('button', { name: new RegExp(`^${words.language[language]}`) }).click();
    await expect(page.locator('.thanks > .fold')).toHaveClass([/contributions/, /acknowledgments/, /sponsors/]);
    const fold = page.locator('.fold.acknowledgments');
    const toggle = fold.locator('h2 button');
    await expect(toggle).toHaveText(words.acknowledgments.title);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const count = (kind: string, level?: number) =>
      file.blocks.filter(
        (block) => block.kind === kind && (level === undefined || ('level' in block && block.level === level)),
      ).length;
    await expect(fold.locator('h3')).toHaveCount(count('heading', 2));
    await expect(fold.locator('h4')).toHaveCount(count('heading', 3));
    await expect(fold.locator('.list > p')).toHaveCount(count('paragraph'));
    await expect(fold.locator('li')).toHaveCount(
      file.blocks.reduce((sum, block) => sum + (block.kind === 'list' ? block.items.length : 0), 0),
    );
    if (file.blocks.length === 0) await expect(fold).toContainText(words.acknowledgments.none);
  }
});

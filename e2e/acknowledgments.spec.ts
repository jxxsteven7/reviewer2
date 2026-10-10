import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, newPlayer, register, TEXT, test } from './helpers';

// The acknowledgments end to end: a player with an account sends a suggestion with a name, the
// operator adopts it with the command, and the name appears at the foot of the home page and on
// the account's page; a playtester is added by hand. The command runs on the server's data
// directory, which e2e/server.mjs makes where playwright.config.ts says.
const text = TEXT.en;
const dataDir = process.env.E2E_DATA_DIR as string;
const own = (name: string) => `${name} ${Math.random().toString(36).slice(2, 7)}`;

// What the command printed, whether or not it could do what was asked.
const admin = (...args: string[]): string =>
  spawnSync(process.execPath, [join(import.meta.dirname, '..', 'server', 'dist', 'admin.cjs'), ...args], {
    env: { ...process.env, DATA_DIR: dataDir },
    encoding: 'utf8',
  }).stdout.trim();

// The number of the feedback that came with this name, as the status page would show it.
function feedbackWith(credit: string): number {
  const db = new DatabaseSync(join(dataDir, 'reviewer2.db'), { readOnly: true });
  try {
    return (db.prepare('SELECT id FROM feedback WHERE credit = ?').get(credit) as { id: number }).id;
  } finally {
    db.close();
  }
}

test('a suggestion that is adopted puts its author on the list, and on their account page', async ({ browser }) => {
  const page = await newPlayer(browser, 'en');
  const username = own('Ann');
  const credit = own('Dr');
  await register(page, username);
  await page.goto('/');
  await page.getByRole('button', { name: /^English/ }).click();

  // The list is folded, and empty of this name.
  const fold = page.locator('details.acknowledgments');
  await expect(fold.getByText(credit)).toHaveCount(0);
  await fold.locator('summary', { hasText: text.acknowledgments.title }).click();
  await expect(fold).toContainText(text.acknowledgments.intro);
  await expect(fold.getByText(credit)).toHaveCount(0);

  await page.getByRole('button', { name: text.feedback.open }).click();
  const sheet = page.getByRole('dialog', { name: text.feedback.title });
  await expect(sheet).toContainText(text.feedback.privacy);
  // The field says where the name goes public: the home page and the repository.
  await expect(sheet).toContainText(text.feedback.creditHint);
  await sheet.getByLabel(text.feedback.text).fill('Let the PI pass the clue to a student.');
  await sheet.getByLabel(text.feedback.credit).fill(credit);
  await sheet.getByRole('button', { name: text.feedback.submit, exact: true }).click();
  await expect(sheet).toBeHidden();

  // The operator adopts it, and it is linked to the account the player was logged in to.
  const adopted = admin('feedback', 'adopt', String(feedbackWith(credit)));
  expect(adopted).toContain(`${credit} for Ideas and bug reports, linked to the account ${username}.`);
  expect(admin('feedback', 'adopt', String(feedbackWith(credit)))).toContain('was adopted already');

  await page.reload();
  await page.locator('details.acknowledgments summary').click();
  const ideas = page.locator('details.acknowledgments section', { hasText: text.acknowledgments.kinds.feedback });
  await expect(ideas.getByText(credit)).toBeVisible();
  // The day, and nothing of the suggestion or the account.
  await expect(ideas.locator('li', { hasText: credit })).toContainText(String(new Date().getUTCFullYear()));
  await expect(page.locator('details.acknowledgments')).not.toContainText(username);
  await expect(page.locator('details.acknowledgments')).not.toContainText('pass the clue');

  await page.goto('/account');
  const titles = page.getByRole('region', { name: text.account.profile.titles });
  await expect(titles).toContainText(`Acknowledged: ${text.acknowledgments.kinds.feedback}`);

  // Unlinked, the name stays on the list and leaves the account's page.
  const id = adopted.match(/acknowledgment #(\d+)/)?.[1] as string;
  expect(admin('acknowledgments', 'unlink', id)).toContain(`from the account ${username}`);
  await page.reload();
  await expect(page.getByRole('region', { name: text.account.profile.titles })).toHaveCount(0);
  await page.goto('/');
  await page.locator('details.acknowledgments summary').click();
  await expect(page.locator('details.acknowledgments')).toContainText(credit);
});

test('the operator thanks a playtester by hand, in both languages', async ({ browser }) => {
  const tester = own('Tester');
  expect(admin('acknowledgments', 'add', tester, '--kind', 'playtesting')).toContain(
    `${tester} for Playtesting, linked to no account.`,
  );
  expect(admin('acknowledgments', 'markdown')).toContain(`- ${tester}, `);
  for (const language of ['en', 'zh'] as const) {
    const words = TEXT[language];
    const page = await newPlayer(browser, language);
    await page.goto('/');
    await page.getByRole('button', { name: new RegExp(`^${words.language[language]}`) }).click();
    await page.locator('details.acknowledgments summary').click();
    const group = page.locator('details.acknowledgments section', { hasText: words.acknowledgments.kinds.playtesting });
    await expect(group.getByText(tester)).toBeVisible();
  }
});

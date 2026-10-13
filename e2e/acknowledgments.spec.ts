import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseAcknowledgments } from '@reviewer2/shared';
import { expect, newPlayer, plural, register, TEXT, test } from './helpers';

// The acknowledgments end to end: a player with an account suggests a new game with a name, a link
// and leave to publish it, the operator adopts it with the command, which prints its entry for
// ACKNOWLEDGMENTS.md, and the account's page counts it; the home page shows ACKNOWLEDGMENTS.md and
// nothing of the database. The command runs on the server's data directory, which e2e/server.mjs
// makes where playwright.config.ts says.
const text = TEXT.en;
const dataDir = process.env.E2E_DATA_DIR as string;
const own = (name: string) => `${name} ${Math.random().toString(36).slice(2, 7)}`;
const file = parseAcknowledgments(readFileSync(join(import.meta.dirname, '..', 'ACKNOWLEDGMENTS.md'), 'utf8'));

// What the command printed, whether or not it could do what was asked.
const admin = (...args: string[]): string =>
  spawnSync(process.execPath, [join(import.meta.dirname, '..', 'server', 'dist', 'admin.cjs'), ...args], {
    env: { ...process.env, DATA_DIR: dataDir },
    encoding: 'utf8',
  }).stdout.trim();

// The feedback that came with this name, as the status page would show it.
function feedbackWith(credit: string): { id: number; kind: string; link: string | null; public_issue: number } {
  const db = new DatabaseSync(join(dataDir, 'reviewer2.db'), { readOnly: true });
  try {
    return db.prepare('SELECT id, kind, link, public_issue FROM feedback WHERE credit = ?').get(credit) as {
      id: number;
      kind: string;
      link: string | null;
      public_issue: number;
    };
  } finally {
    db.close();
  }
}

test("a suggestion that is adopted is counted on its author's account page, and never listed from the database", async ({
  browser,
}) => {
  const page = await newPlayer(browser, 'en');
  const username = own('Ann');
  const credit = own('Dr');
  await register(page, username);
  await page.goto('/');
  await page.getByRole('button', { name: /^English/ }).click();

  await page.getByRole('button', { name: text.footer.feedback, exact: true }).click();
  const sheet = page.getByRole('dialog', { name: text.feedback.title });
  await expect(sheet).toContainText(text.feedback.privacy);
  // The field says where the name goes public: the home page and the repository.
  await expect(sheet).toContainText(text.feedback.creditHint);
  await expect(sheet).not.toContainText(text.feedback.gameNote);
  await sheet.getByLabel(text.feedback.kinds.game).check();
  await expect(sheet).toContainText(text.feedback.gameNote);
  await sheet.getByLabel(text.feedback.text).fill('A game where the reviewers bid on papers.');
  // The link goes with a name, and its field shows once there is one.
  await expect(sheet.getByLabel(text.feedback.link)).toHaveCount(0);
  await sheet.getByLabel(text.feedback.credit).fill(credit);
  await sheet.getByLabel(text.feedback.link).fill('mailto:ann@example.com');
  await expect(sheet).toContainText(text.errors.credit_link_invalid);
  await sheet.getByLabel(text.feedback.link).fill('https://ann.example/');
  const consent = sheet.getByLabel(text.feedback.publicIssue);
  await expect(consent).not.toBeChecked();
  await expect(sheet).toContainText(text.feedback.publicIssueHint);
  await consent.check();
  await sheet.getByRole('button', { name: text.feedback.submit, exact: true }).click();
  await expect(sheet).toBeHidden();

  const sent = feedbackWith(credit);
  expect(sent).toMatchObject({ kind: 'game', link: 'https://ann.example/', public_issue: 1 });
  // The operator publishes it as an issue, adopts it, and gets the entry for ACKNOWLEDGMENTS.md.
  expect(admin('feedback', 'issue', String(sent.id), '7')).toContain(`Feedback #${sent.id} is issue #7`);
  const adopted = admin('feedback', 'adopt', String(sent.id));
  expect(adopted).toContain(`for Helpful discussions, counted for the account ${username}.`);
  expect(adopted).toContain('under "## Helpful discussions"');
  expect(adopted).toContain(`- [${credit}](https://ann.example/) \u{2014} <what they did> (#7)`);
  expect(admin('feedback', 'adopt', String(sent.id))).toContain('was adopted already');

  await page.goto('/account');
  const titles = page.getByRole('region', { name: text.account.profile.titles });
  await expect(titles).toContainText(`Acknowledged: ${text.acknowledgments.kinds.feedback}`);

  // The home page lists what ACKNOWLEDGMENTS.md has, not the database.
  await page.goto('/');
  const fold = page.locator('.fold.acknowledgments');
  await fold.locator('h2 button').click();
  await expect(fold).toContainText(text.acknowledgments.intro);
  await expect(fold).not.toContainText(credit);
  await expect(fold).not.toContainText('bid on papers');
});

test('the home page shows ACKNOWLEDGMENTS.md, under headings in its own language', async ({ browser }) => {
  for (const language of ['en', 'zh'] as const) {
    const words = TEXT[language];
    const page = await newPlayer(browser, language);
    await page.goto('/');
    await page.getByRole('button', { name: new RegExp(`^${words.language[language]}`) }).click();
    // The card counts the people the file names, each once, and every anonymous player.
    const entries = file.sections.flatMap(({ entries }) => entries);
    const people =
      new Set(entries.flatMap(({ name }) => (name === null ? [] : [name]))).size +
      entries.filter(({ name }) => name === null).length;
    const fold = page.locator('.fold.acknowledgments');
    const toggle = fold.locator('h2 button');
    await expect(toggle).toHaveText(plural(words.acknowledgments.counted, people));
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(fold.locator('h3')).toHaveText(file.sections.map(({ kind }) => words.acknowledgments.kinds[kind]));
    await expect(fold.locator('li')).toHaveCount(file.sections.flatMap(({ entries }) => entries).length);
    if (file.sections.length === 0) await expect(fold).toContainText(words.acknowledgments.none);
  }
});

test('the operator thanks a playtester by hand, counted for an account', async ({ browser }) => {
  const page = await newPlayer(browser, 'en');
  const username = own('Tess');
  await register(page, username);
  const added = admin('acknowledgments', 'add', 'Tess T.', '--kind', 'playtesting', '--account', username);
  expect(added).toContain(`Tess T., for Pilot study, counted for the account ${username}.`);
  expect(added).toContain('- Tess T\\. \u{2014} <what they did>');
  expect(admin('acknowledgments', 'list')).toContain(`Tess T.  (account ${username})`);
  await page.goto('/account');
  await expect(page.getByRole('region', { name: text.account.profile.titles })).toContainText(
    `Acknowledged: ${text.acknowledgments.kinds.playtesting}`,
  );
});

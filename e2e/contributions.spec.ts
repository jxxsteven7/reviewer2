import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Page } from '@playwright/test';
import { expect, newPlayer, register, TEXT, test } from './helpers';

// The feedback contributions end to end: a player with an account suggests a new game with a name,
// the operator adopts it with the command once it is a GitHub issue, and the home page lists it
// from the database, with what the operator wrote, while the account's page counts it. The name
// opens a card of the player's profile, as the box on the form, ticked until the player unticks
// it, lets it, and the card the whole page; unticked, the name stays plain text. The public page shows the counts once its owner shows
// them. A guest is asked to log in first, and may send all the same. The command runs on the
// server's data directory, which e2e/server.mjs makes where playwright.config.ts says.
const text = TEXT.en;
const dataDir = process.env.E2E_DATA_DIR as string;
const own = (name: string) => `${name} ${Math.random().toString(36).slice(2, 7)}`;
// What the operator writes of a contribution, in Chinese and in English.
const SUMMARY = [
  '--zh',
  '\u63d0\u51fa\u4e86\u4e00\u4e2a\u7ade\u62cd\u5ba1\u7a3f\u7684\u6e38\u620f',
  '--en',
  'Suggested a game of bidding on papers',
];

// What the command printed, whether or not it could do what was asked.
const admin = (...args: string[]): string =>
  spawnSync(process.execPath, [join(import.meta.dirname, '..', 'server', 'dist', 'admin.cjs'), ...args], {
    env: { ...process.env, DATA_DIR: dataDir },
    encoding: 'utf8',
  }).stdout.trim();

interface Sent {
  id: number;
  kind: string;
  account_id: number | null;
  link_profile: number | null;
  adopted_at: string | null;
}

// The feedback with this text, as the database keeps it.
function feedbackWith(sent: string): Sent {
  const db = new DatabaseSync(join(dataDir, 'reviewer2.db'), { readOnly: true });
  try {
    return db
      .prepare('SELECT id, kind, account_id, link_profile, adopted_at FROM feedback WHERE text = ?')
      .get(sent) as unknown as Sent;
  } finally {
    db.close();
  }
}

// Sends feedback from the home page, logged in, with a name, and ticks or unticks the box that
// lets the name open the player's page; the box comes ticked.
async function send(page: Page, kind: 'idea' | 'game', idea: string, credit: string, linkProfile: boolean) {
  await page.goto('/');
  await page.getByRole('button', { name: text.footer.feedback, exact: true }).click();
  const sheet = page.getByRole('dialog', { name: text.feedback.title });
  await sheet.getByLabel(text.feedback.kinds[kind]).check();
  await sheet.getByLabel(text.feedback.text).fill(idea);
  const box = sheet.getByLabel(text.feedback.linkProfile);
  await expect(box).toHaveCount(0);
  await sheet.getByLabel(text.feedback.credit).fill(credit);
  await expect(box).toBeChecked();
  if (!linkProfile) await box.uncheck();
  await sheet.getByRole('button', { name: text.feedback.submit, exact: true }).click();
  await expect(sheet).toBeHidden();
}

// Publishes the feedback as an issue and adopts it, as the operator does, and returns the issue.
function adopt(id: number): string {
  const issue = String(1000 + id);
  admin('feedback', 'issue', String(id), issue);
  admin('feedback', 'adopt', String(id), ...SUMMARY);
  return issue;
}

test("adopted feedback is listed on the home page and counted on its author's page", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, 'en');
  const username = own('Ann');
  const credit = own('Dr');
  await register(page, username);
  await page.goto('/');
  await page.getByRole('button', { name: /^English/ }).click();

  await page.getByRole('button', { name: text.footer.feedback, exact: true }).click();
  const sheet = page.getByRole('dialog', { name: text.feedback.title });
  await expect(sheet).toContainText(text.feedback.privacy);
  await expect(sheet).toContainText(text.feedback.creditHint);
  // Logged in, nobody is asked to log in, and there is nothing to tick without a name.
  await expect(sheet).not.toContainText(text.feedback.guest);
  await expect(sheet.getByRole('checkbox')).toHaveCount(0);
  const idea = `A game where the reviewers bid on papers. (${testInfo.project.name} ${credit})`;
  await send(page, 'game', idea, credit, true);

  const sent = feedbackWith(idea);
  expect(sent).toMatchObject({ kind: 'game', link_profile: 1, adopted_at: null });
  expect(sent.account_id).not.toBeNull();
  // Adopted feedback is a GitHub issue first; the operator writes what the player contributed.
  admin('feedback', 'adopt', String(sent.id), ...SUMMARY);
  expect(feedbackWith(idea).adopted_at).toBeNull();
  const issue = adopt(sent.id);
  expect(feedbackWith(idea).adopted_at).not.toBeNull();

  await page.goto('/account');
  const titles = page.getByRole('region', { name: text.account.profile.titles });
  await expect(titles).toContainText(`Contributions: ${text.contributions.kinds.game}`);
  const setup = page.locator('.public');
  const address = await setup.getByRole('link', { name: text.account.profile.public.view }).getAttribute('href');

  // The home page lists it at once, by name, with what was contributed and its issue, and the name
  // opens the player's page, as the box let it, but never says the username.
  await page.goto('/');
  const fold = page.locator('.fold.contributions');
  await fold.locator('h2 button').click();
  await expect(fold).toContainText(text.contributions.intro);
  const entry = fold.locator('li', { hasText: credit });
  await expect(entry).toContainText('Suggested a game of bidding on papers');
  await expect(entry.getByRole('link', { name: `#${issue}` })).toHaveAttribute(
    'href',
    `https://github.com/jxxsteven7/reviewer2/issues/${issue}`,
  );
  await expect(fold).not.toContainText(username);
  // The name opens a card over the home page, titled with it, and the card the way to the page.
  await entry.getByRole('button', { name: credit }).click();
  const panel = page.getByRole('dialog', { name: credit });
  await expect(panel.locator('.profile-card')).toContainText(username);
  await panel.getByRole('link', { name: text.contributions.fullPage }).click();
  await page.waitForURL(`**${address}`);
  // The page shows the counts only once its owner shows them.
  const card = page.locator('.profile-card');
  const pill = card.getByText(`Contributions: ${text.contributions.kinds.game}`);
  await expect(card).toContainText(username);
  await expect(pill).toHaveCount(0);
  await page.goto('/account');
  await setup.getByLabel(text.account.profile.public.showThanks).check();
  await setup.getByRole('button', { name: text.account.profile.public.save }).click();
  await expect(page.getByText(text.account.profile.public.saved)).toBeVisible();
  await page.goto(address as string);
  await expect(pill).toBeVisible();
});

test('a name whose box was unticked stays plain text', async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, 'en');
  const credit = own('Eve');
  await register(page, own('Eve'));
  await page.goto('/');
  await page.getByRole('button', { name: /^English/ }).click();
  const idea = `Let the PI pass a turn. (${testInfo.project.name} ${credit})`;
  await send(page, 'idea', idea, credit, false);
  const sent = feedbackWith(idea);
  expect(sent).toMatchObject({ kind: 'idea', link_profile: 0 });
  expect(sent.account_id).not.toBeNull();
  adopt(sent.id);

  await page.goto('/');
  const fold = page.locator('.fold.contributions');
  await fold.locator('h2 button').click();
  const entry = fold.locator('li', { hasText: credit });
  await expect(entry).toContainText('Suggested a game of bidding on papers');
  await expect(entry.getByRole('button', { name: credit })).toHaveCount(0);
  await expect(entry.locator('.name')).toHaveText(credit);
});

test('a guest is asked to log in first, comes back after, and may send without', async ({ browser }) => {
  const page = await newPlayer(browser, 'en');
  await page.goto('/');
  await page.getByRole('button', { name: /^English/ }).click();
  await page.getByRole('button', { name: text.footer.feedback, exact: true }).click();
  const sheet = page.getByRole('dialog', { name: text.feedback.title });
  await expect(sheet).toContainText(text.feedback.guest);
  await sheet.getByLabel(text.feedback.text).fill('Typed before logging in.');
  await sheet.getByRole('link', { name: text.feedback.signIn }).click();
  await page.waitForURL(/\/account$/);
  // Registered, the player is back on the home page, with what they wrote.
  await page.getByRole('button', { name: text.account.signIn.register, exact: true }).click();
  await page.getByLabel(text.account.username).fill(own('Cy'));
  await page.getByLabel(text.account.password, { exact: true }).fill('correct horse');
  await page.getByRole('button', { name: text.account.signIn.registerSubmit }).click();
  await page.waitForURL(/\/$/);
  await page.getByRole('button', { name: text.footer.feedback, exact: true }).click();
  await expect(sheet).not.toContainText(text.feedback.guest);
  await expect(sheet.getByLabel(text.feedback.text)).toHaveValue('Typed before logging in.');
});

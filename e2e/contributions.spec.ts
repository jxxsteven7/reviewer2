import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Page } from '@playwright/test';
import { expect, newPlayer, pageAddress, register, TEXT, test } from './helpers';

// The feedback contributions end to end: a player with an account suggests a new game, signed with
// the account, the operator adopts it with the command once it is a GitHub issue, and the home
// page lists it from the database, by the account's avatar and username, with what the operator
// wrote, while the account's page counts it. The avatar and the name open the account's panel, as
// an avatar does anywhere, and the panel the whole page over it; feedback sent anonymously names
// nobody, and counts for the account all the same. The public page shows the counts once its
// owner shows them. A guest is asked to log in first, and may send all the same; one who logs in
// in another tab is logged in on this one too. The command runs on the server's data directory,
// which e2e/server.mjs makes where playwright.config.ts says.
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
  credit: string | null;
  link_profile: number | null;
  adopted_at: string | null;
}

// The feedback with this text, as the database keeps it.
function feedbackWith(sent: string): Sent {
  const db = new DatabaseSync(join(dataDir, 'reviewer2.db'), { readOnly: true });
  try {
    return db
      .prepare('SELECT id, kind, account_id, credit, link_profile, adopted_at FROM feedback WHERE text = ?')
      .get(sent) as unknown as Sent;
  } finally {
    db.close();
  }
}

// Sends feedback from the home page, logged in as `username`, signed with the account, as the form
// starts, or anonymously.
async function send(page: Page, kind: 'idea' | 'game', idea: string, username: string, signed: boolean) {
  await page.goto('/');
  await page.getByRole('button', { name: text.footer.feedback, exact: true }).click();
  const sheet = page.getByRole('dialog', { name: text.feedback.title });
  await sheet.getByLabel(text.feedback.kinds[kind]).check();
  await sheet.getByLabel(text.feedback.text).fill(idea);
  // Signed, the account is shown as the contributions will show it, with no name to type.
  await expect(sheet.getByLabel(text.feedback.signatures.signed)).toBeChecked();
  await expect(sheet.locator('.signer')).toHaveText(username);
  await expect(sheet.getByLabel(text.feedback.credit)).toHaveCount(0);
  if (!signed) {
    await sheet.getByLabel(text.feedback.signatures.anonymous).check();
    await expect(sheet.locator('.signer')).toHaveCount(0);
  }
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
  await register(page, username);
  await page.goto('/');
  await page.getByRole('button', { name: /^English/ }).click();

  await page.getByRole('button', { name: text.footer.feedback, exact: true }).click();
  const sheet = page.getByRole('dialog', { name: text.feedback.title });
  await expect(sheet).toContainText(text.feedback.privacy);
  await expect(sheet).toContainText(text.feedback.accountHint);
  // Logged in, nobody is asked to log in, and there is nothing to tick.
  await expect(sheet).not.toContainText(text.feedback.guest);
  await expect(sheet.getByRole('checkbox')).toHaveCount(0);
  const idea = `A game where the reviewers bid on papers. (${testInfo.project.name} ${username})`;
  await send(page, 'game', idea, username, true);

  const sent = feedbackWith(idea);
  // The server takes the account's username for the name.
  expect(sent).toMatchObject({ kind: 'game', credit: username, link_profile: 1, adopted_at: null });
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
  const address = await pageAddress(page);

  // The home page lists it at once, by the account's avatar and username, with what was contributed
  // and its issue, and they open the account's panel.
  await page.goto('/');
  const fold = page.locator('.fold.contributions');
  await fold.locator('h2 button').click();
  await expect(fold).toContainText(text.contributions.intro);
  const entry = fold.locator('li', { hasText: username });
  await expect(entry).toContainText('Suggested a game of bidding on papers');
  await expect(entry.getByRole('link', { name: `#${issue}` })).toHaveAttribute(
    'href',
    `https://github.com/jxxsteven7/reviewer2/issues/${issue}`,
  );
  const person = entry.getByRole('button', { name: username });
  await expect(person.locator('.avatar')).toBeVisible();
  // No underline: the avatar says that it opens a player.
  await expect(person).toHaveCSS('text-decoration-line', 'none');
  // It opens the panel over the home page, titled with the username, which says that it is the
  // viewer: the whole page shows the account as others see it, over the panel, without leaving the
  // home page, and the way to the account page, where it is changed, opens that page at its top.
  await person.click();
  const panel = page.getByRole('dialog', { name: username });
  await expect(panel).toContainText(text.friends.self);
  await panel.getByRole('button', { name: text.room.panel.fullPage }).click();
  const whole = page.locator('[role=dialog]:has(button.back)');
  await expect(whole.locator('.profile-card')).toContainText(text.playerPage.edit);
  await whole.getByRole('button', { name: text.room.panel.back }).click();
  await expect(whole).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  await panel.getByRole('link', { name: text.room.panel.myAccount }).click();
  await page.waitForURL(/\/account$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  // Another player's panel offers to ask them to be friends.
  const other = await newPlayer(browser, 'en');
  await register(other, own('Bob'));
  await other.goto('/');
  await other.getByRole('button', { name: /^English/ }).click();
  const otherFold = other.locator('.fold.contributions');
  await otherFold.locator('h2 button').click();
  await otherFold.locator('li', { hasText: username }).getByRole('button', { name: username }).click();
  await expect(
    other.getByRole('dialog', { name: username }).getByRole('button', { name: text.friends.addFromRoom }),
  ).toBeVisible();

  // The public page shows the counts only once its owner shows them.
  await page.goto(address);
  const card = page.locator('.profile-card');
  const pill = card.getByText(`Contributions: ${text.contributions.kinds.game}`);
  await expect(card).toContainText(username);
  await expect(pill).toHaveCount(0);
  await page.goto('/account');
  await setup.getByLabel(text.account.profile.public.showThanks).check();
  await setup.getByRole('button', { name: text.account.profile.public.save }).click();
  await expect(page.getByText(text.account.profile.public.saved)).toBeVisible();
  await page.goto(address);
  await expect(pill).toBeVisible();
});

test('feedback sent anonymously names nobody, and counts for the account', async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, 'en');
  const username = own('Eve');
  await register(page, username);
  await page.goto('/');
  await page.getByRole('button', { name: /^English/ }).click();
  const idea = `Let the PI pass a turn. (${testInfo.project.name} ${username})`;
  await send(page, 'idea', idea, username, false);
  const sent = feedbackWith(idea);
  expect(sent).toMatchObject({ kind: 'idea', credit: null, link_profile: 0 });
  expect(sent.account_id).not.toBeNull();
  adopt(sent.id);

  await page.goto('/');
  const fold = page.locator('.fold.contributions');
  await fold.locator('h2 button').click();
  await expect(fold).toContainText(text.contributions.anonymous);
  await expect(fold).not.toContainText(username);
  await page.goto('/account');
  await expect(page.getByRole('region', { name: text.account.profile.titles })).toContainText(
    `Contributions: ${text.contributions.kinds.idea}`,
  );
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

test('a login in another tab counts for the feedback sent from this one', async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, 'en');
  await page.goto('/');
  await page.getByRole('button', { name: /^English/ }).click();
  // The connection of this tab is a guest's when the form opens.
  await page.getByRole('button', { name: text.footer.feedback, exact: true }).click();
  const sheet = page.getByRole('dialog', { name: text.feedback.title });
  await expect(sheet).toContainText(text.feedback.guest);
  const other = await page.context().newPage();
  const username = own('Di');
  await register(other, username);
  await other.close();
  // Following the way to the account page, the tab finds itself logged in, and comes back.
  await sheet.getByRole('link', { name: text.feedback.signIn }).click();
  await expect(page.getByRole('heading', { name: text.account.profile.title })).toBeVisible();
  await expect(page.locator('section.profile')).toBeVisible();
  await page.goBack();
  await page.getByRole('button', { name: text.footer.feedback, exact: true }).click();
  await expect(sheet).not.toContainText(text.feedback.guest);
  const idea = `Show the clue's number on the board. (${testInfo.project.name} ${username})`;
  await sheet.getByLabel(text.feedback.text).fill(idea);
  // Signed with the account it logged in to, with no name to type.
  await expect(sheet.locator('.signer')).toHaveText(username);
  await expect(sheet.getByLabel(text.feedback.credit)).toHaveCount(0);
  await sheet.getByRole('button', { name: text.feedback.submit, exact: true }).click();
  await expect(sheet).toBeHidden();
  const sent = feedbackWith(idea);
  expect(sent.account_id).not.toBeNull();
  expect(sent).toMatchObject({ credit: username, link_profile: 1 });
});

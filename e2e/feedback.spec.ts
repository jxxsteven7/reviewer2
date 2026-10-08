import { readFileSync } from 'node:fs';
import { expect, newPlayer, TEXT, test } from './helpers';

// Feedback from the home page, through its panel, to the server, which keeps it and logs its
// number and kind (docs/architecture.md). The browsers of every project come from 127.0.0.1 to
// the one server of a run, so e2e/server.mjs raises the limit per address, and each project
// sends a text of its own, since the server keeps the same text from one address only once.
const text = TEXT.en;

const logged = (): { event: string; id?: number; kind?: string }[] =>
  readFileSync(process.env.E2E_SERVER_LOG as string, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { event: string });

test('a bug report goes from the home page to the server, which logs its number and kind', async ({
  browser,
}, testInfo) => {
  const page = await newPlayer(browser, 'en');
  await page.goto('/');
  await page.getByRole('button', { name: /^English/ }).click();
  const before = logged().filter(({ event }) => event === 'feedback_received').length;

  await page.getByRole('button', { name: text.feedback.open }).click();
  const sheet = page.getByRole('dialog', { name: text.feedback.title });
  await expect(sheet).toContainText(text.feedback.privacy);
  await expect(sheet).not.toContainText(text.feedback.bugNote);
  await sheet.getByLabel(text.feedback.kinds.bug).check();
  await expect(sheet).toContainText(text.feedback.bugNote);
  const send = sheet.getByRole('button', { name: text.feedback.submit, exact: true });
  await expect(send).toBeDisabled();
  await sheet
    .getByLabel(text.feedback.text)
    .fill(`Lock the phone in a game,\nand the board is gone when it comes back. (${testInfo.project.name})`);
  await sheet.getByLabel(text.feedback.contact).fill('reviewer@example.com');
  await send.click();

  await expect(page.getByText(text.feedback.sent)).toBeVisible();
  await expect(sheet).toBeHidden();
  await expect.poll(() => logged().filter(({ event }) => event === 'feedback_received')).toHaveLength(before + 1);
  const received = logged()
    .filter(({ event }) => event === 'feedback_received')
    .at(-1);
  expect(received).toEqual({
    time: expect.any(String),
    event: 'feedback_received',
    id: expect.any(Number),
    kind: 'bug',
  });
  // The log never has what the player wrote.
  const log = readFileSync(process.env.E2E_SERVER_LOG as string, 'utf8');
  expect(log).not.toContain('Lock the phone');
  expect(log).not.toContain('reviewer@example.com');
});

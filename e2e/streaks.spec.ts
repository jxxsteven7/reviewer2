import type { Page } from '@playwright/test';
import { englishNumber, STREAK_MIN } from '@reviewer2/shared';
import { expect, interpolate, redWins, register, seatTable, TEXT, test } from './helpers';

// Streaks end to end (docs/architecture.md#streaks): Ann, red's PI, and Dan, blue's student, have
// accounts, and red wins three games in a row. After the third, Ann's page tells her of her winning
// streak and her new record, every page and the screen cheer her, Dan's page tells him of his losing
// streak and nobody else's does, and both titles are on their account pages.
//
// All tests share one server, on which a registered name is nobody else's, so every account here
// has a part that is the test's own.
const own = (name: string) => `${name}${Math.random().toString(36).slice(2, 7)}`;

const title = (text: (typeof TEXT)['en'], kind: 'wins' | 'losses', length: number) =>
  interpolate(text.streaks.names[kind], { n: englishNumber(length) });

test('a winning streak is cheered by the whole room, and a losing streak told to its player alone', async ({
  browser,
  browserName,
}) => {
  test.slow(browserName === 'webkit', 'three games on WebKit take a while');
  const text = TEXT.en;
  const names: Record<string, string> = { Ann: own('Ann'), Dan: own('Dan') };
  const table = await seatTable(browser, 'en', async (page, name) => {
    if (names[name]) await register(page, names[name]);
  });
  const ann = table.captains.red;
  const dan = table.guessers.blue;
  const others = [table.guessers.red, table.captains.blue, table.spectator, table.screen];

  for (let game = 1; game <= STREAK_MIN; game += 1) {
    if (game > 1) {
      await ann.getByRole('button', { name: text.game.letter.again }).click();
      await expect(ann.locator('.start-bar .ready')).toBeVisible();
      await ann.getByRole('button', { name: text.lobby.start }).click();
      await expect(ann.locator('.keywords-game')).toBeVisible();
    }
    await redWins(table, 'en');
    if (game < STREAK_MIN) {
      // Two in a row are nobody's business yet.
      for (const page of [ann, dan, ...others]) await expect(page.locator('.streak-notices')).toHaveCount(0);
    }
  }

  // Ann reads her own streak, a new record, and nobody cheers her to herself.
  const wins = title(text, 'wins', STREAK_MIN);
  const losses = title(text, 'losses', STREAK_MIN);
  const annsCard = ann.locator('.streak-notices .mine');
  await expect(annsCard).toHaveClass(/wins/);
  await expect(annsCard.locator('.title')).toHaveText(wins);
  await expect(annsCard.locator('.record')).toHaveText(text.streaks.record);
  await expect(ann.locator('.streak-notices .cheer')).toHaveCount(0);
  // Everyone else, the screen included, cheers her, and Dan reads his own losing streak as well.
  const cheer = interpolate(text.streaks.broadcast, { name: names.Ann as string, title: wins });
  for (const page of [dan, ...others]) await expect(page.locator('.streak-notices .cheer')).toHaveText(cheer);
  const dansCard = dan.locator('.streak-notices .mine');
  await expect(dansCard).toHaveClass(/losses/);
  await expect(dansCard.locator('.title')).toHaveText(losses);
  await expect(dansCard.locator('.record')).toHaveText(text.streaks.record);
  for (const page of [ann, ...others]) {
    await expect(page.locator('.streak-notices .mine')).toHaveCount(page === ann ? 1 : 0);
    await expect(page.locator('.streak-notices')).not.toContainText(losses);
  }

  // The titles on the account pages.
  const titlesOf = async (page: Page) => {
    await page.goto('/account');
    const titles = page.locator('section[aria-labelledby=profile-titles] .titles');
    await expect(titles).toBeVisible();
    return titles;
  };
  await expect(await titlesOf(ann)).toContainText(wins);
  await expect(await titlesOf(dan)).toContainText(losses);
});

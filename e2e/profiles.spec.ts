import type { Page } from '@playwright/test';
import { createRoom, expect, interpolate, joinByLink, newPlayer, pageAddress, register, TEXT, test } from './helpers';

// Public profiles end to end (docs/architecture.md#public-profiles): a player sets up the page on
// the account page; another opens it by its address, sees the number, the line as the text it is,
// the link and the record, likes it and asks to be friends; the owner sees the badge on the home
// page, the liker on the account page, and accepts, and looks at the page in a sheet; a guest sees
// the count and nothing to do; and in a room, the page opens from the player menu in a sheet, so
// that nobody leaves the room.
//
// All tests share one server, so every account here has a part that is the test's own.
const own = (name: string) => `${name}${Math.random().toString(36).slice(2, 7)}`;

test('a public page is set up, opened by its address and from a room, liked and befriended from', async ({
  browser,
}) => {
  const text = TEXT.en;
  const [annName, bobName] = [own('Ann'), own('Bob')];
  const ann = await newPlayer(browser, 'en');
  await register(ann, annName);
  const bob = await newPlayer(browser, 'en');
  await register(bob, bobName);

  // Ann writes a link and a line, shows her record, and finds her number; the page's address is
  // the one she shares.
  await ann.goto('/account');
  const setup = ann.locator('.public');
  await setup.getByLabel(text.account.profile.public.link).fill(' https://ann.example/me ');
  await setup.getByLabel(text.account.profile.public.bio).fill('  Reviewer of <b>everything</b>  ');
  await setup.getByLabel(text.account.profile.public.showRecord).check();
  await setup.getByRole('button', { name: text.account.profile.public.save }).click();
  await expect(ann.getByText(text.account.profile.public.saved)).toBeVisible();
  await expect(ann.locator('.profile .number')).toContainText(/Player No\. \d+/);
  const address = await pageAddress(ann);
  expect(address).toMatch(/^\/p\/[0-9a-f]{12}$/);

  // Bob opens it by its address: the line is text, not markup, and the link is the address it is.
  await bob.goto(address as string);
  const card = bob.locator('.profile-card');
  await expect(card).toContainText(annName);
  await expect(card).toContainText(text.ranks.names.kindergarten);
  await expect(card.locator('.bio')).toHaveText('Reviewer of <b>everything</b>');
  expect(await card.locator('.bio b').count()).toBe(0);
  const link = card.getByRole('link', { name: 'https://ann.example/me' });
  await expect(link).toHaveAttribute('href', 'https://ann.example/me');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'nofollow ugc noopener');
  // The record that Ann shows, as numbers: no games, no rate and no matches yet.
  await expect(card.locator('.record-stats .block .value')).toHaveText(['0', '\u2014', '\u2014', '\u2014', '0', '0']);
  await expect(card).toContainText(interpolate(text.playerPage.likes, { heart: text.playerPage.heart, count: '0' }));
  // The rank opens the ladder of every rank, Ann's marked and her points nowhere on it.
  await card.locator('.rank-button').click();
  const ladder = bob.locator('[role=dialog]', { has: bob.locator('.ladder') });
  await expect(ladder.locator('.rung[aria-current="true"]')).toContainText(text.ranks.names.kindergarten);
  await expect(ladder.locator('.rung[aria-current="true"]')).not.toContainText(text.ranks.names.primary);
  await expect(ladder).not.toContainText(interpolate(text.ranks.points, { points: '0' }));
  await ladder.getByRole('button', { name: text.room.close }).click();
  await expect(ladder).toHaveCount(0);

  // Bob likes the page, and asks Ann to be friends from it, in the sheet with a line for her that a
  // room's panel has too; the page then says that the request went.
  await card.getByRole('button', { name: text.playerPage.like, exact: true }).click();
  await expect(card.getByRole('button', { name: text.playerPage.liked })).toBeVisible();
  await expect(card).toContainText(interpolate(text.playerPage.likes, { heart: text.playerPage.heart, count: '1' }));
  await card.getByRole('button', { name: text.friends.addFromRoom }).click();
  const asking = bob.getByRole('dialog', { name: interpolate(text.friends.addTitle, { name: annName }) });
  await asking.getByRole('button', { name: text.friends.addSubmit }).click();
  await expect(bob.getByText(text.friends.requestSent)).toBeVisible();
  await expect(card.getByRole('button', { name: text.friends.requestPending })).toBeDisabled();

  // Ann's home page counts the request on her avatar, which leads to her account page, with the way
  // back before its title, on the bar that takes the masthead's place at the top of the screen as
  // the page scrolls. The account page shows Bob among those who liked her page, not yet a friend,
  // and the request, which she accepts.
  await ann.goto('/');
  // The language gate stands on the browser's first visit to the home page.
  await expect(ann.locator('.gate, .home').first()).toBeVisible();
  const gate = ann.getByRole('link', { name: new RegExp(`^${text.language.en}`) });
  if (await gate.count()) await gate.click();
  await expect(ann.locator('.avatar-link .badge')).toHaveText('1');
  await ann.locator('.avatar-link').click();
  await ann.waitForURL(/\/account$/);
  const back = ann.locator('main .page-title > .back-button');
  await expect(back).toHaveAccessibleName(text.account.back);
  await expect(ann.locator('header.masthead .back-button')).toHaveCount(0);
  const onTop = (page: Page) =>
    page.evaluate(() => document.elementFromPoint(innerWidth / 2, 4)?.closest('.page-title, .masthead')?.className);
  await ann.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => onTop(ann)).toContain('page-title');
  await ann.evaluate(() => window.scrollTo(0, 0));
  // Opened on its own, as in a new tab, the account page has nothing to go back to, and keeps the
  // masthead at the top.
  const tab = await ann.context().newPage();
  await tab.goto('/account');
  await expect(tab.locator('.page-title h1')).toHaveText(text.account.profile.title);
  await expect(tab.getByRole('button', { name: text.account.back })).toHaveCount(0);
  await tab.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => onTop(tab)).toContain('masthead');
  await tab.close();
  await expect(ann.locator('.profile h2 .badge')).toHaveText('1');
  const liker = ann.locator('.likers .line', { hasText: bobName });
  await expect(liker.getByRole('button', { name: text.friends.addFromRoom })).toBeVisible();
  await ann.locator('.friends').getByRole('button', { name: text.friends.accept }).click();
  await expect(ann.locator('.friends .friend', { hasText: bobName })).toContainText(text.friends.online);
  await expect(ann.locator('.profile h2 .badge')).toHaveCount(0);
  // The list of likers hears of it too, without a reload, and so does Ann's page, which Bob has open
  // and which offers him nothing more.
  await expect(ann.locator('.likers .line', { hasText: bobName })).toContainText(text.account.profile.public.friend);
  await expect(card.getByRole('button', { name: text.friends.requestPending })).toHaveCount(0);
  await expect(card.getByRole('button', { name: text.friends.addFromRoom })).toHaveCount(0);

  // Ann looks at her own page from the account page, in the sheet that shows an account's page
  // anywhere on the site, without leaving the account page: the panel says that it is hers, and the
  // whole page over it offers no way to like it. The way back leads home.
  await ann.getByRole('button', { name: text.account.profile.public.view }).click();
  const mine = ann.getByRole('dialog', { name: annName, exact: true });
  await expect(mine).toContainText(text.friends.self);
  await mine.getByRole('button', { name: text.room.panel.fullPage }).click();
  const whole = ann.locator('[role=dialog]:has(button.back)');
  await expect(whole.locator('.profile-card')).toContainText(text.playerPage.edit);
  expect(await whole.locator('.profile-card .actions button').count()).toBe(0);
  await ann.keyboard.press('Escape');
  await expect(ann.getByRole('dialog')).toHaveCount(0);
  await expect(ann).toHaveURL(/\/account$/);
  await back.click();
  await expect(ann).toHaveURL(/\/$/);

  // A guest sees the count and the line, and nothing to do; an address that is no page says so.
  const guest = await newPlayer(browser, 'en');
  await guest.goto(address as string);
  await expect(guest.locator('.profile-card')).toContainText(
    interpolate(text.playerPage.likes, { heart: text.playerPage.heart, count: '1' }),
  );
  // Opened on its own, the page has no way back: the wordmark leads home.
  await expect(guest.getByRole('button', { name: text.account.back })).toHaveCount(0);
  await expect(guest.locator('.profile-card')).toContainText(text.playerPage.logInToLike);
  expect(await guest.locator('.profile-card .actions button').count()).toBe(0);
  await guest.goto('/p/000000000000');
  await expect(guest.locator('.player-page')).toContainText(text.errors.no_such_profile);

  // In a room, Bob taps Ann's avatar: her panel, with a brief card, and her whole page, which hides
  // the panel until he goes back to it. He stays in the room throughout.
  const room = await createRoom(ann, 'en');
  await joinByLink(bob, room, 'en');
  await bob
    .locator('.lobby .player', { hasText: annName })
    .getByRole('button', { name: `View ${annName}'s profile` })
    .click();
  const panel = bob.locator('[role=dialog]:not(:has(button.back))', { has: bob.locator('.profile-card') });
  await expect(panel.locator('.profile-card .number')).toContainText(/Player No\. \d+/);
  await expect(panel.locator('.profile-card')).not.toContainText('https://ann.example/me');
  // The panel stays on the page meanwhile, the same one, where it was scrolled to: marked, and
  // scrolled as far as it goes, which is nowhere when it all fits.
  await panel.evaluate((element) => element.setAttribute('data-kept', 'yes'));
  const scroller = panel.locator('.scroller');
  const scrolledTo = await scroller.evaluate((element) => {
    element.scrollTop = 40;
    return element.scrollTop;
  });
  await panel.getByRole('button', { name: text.room.panel.fullPage }).click();
  const page = bob.locator('[role=dialog]:has(button.back)');
  await expect(page.locator('.profile-card')).toContainText('https://ann.example/me');
  await expect(panel).toBeHidden();
  await page.getByRole('button', { name: text.room.panel.back }).click();
  await expect(page).toHaveCount(0);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-kept', 'yes');
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(scrolledTo);
  await expect(bob).toHaveURL(room);
  await bob.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(bob.locator('.lobby')).toContainText(annName);
});

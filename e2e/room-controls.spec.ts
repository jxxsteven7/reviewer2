import type { Browser, Page } from '@playwright/test';
import {
  createRoom,
  expect,
  interpolate,
  isPhone,
  joinByLink,
  newPlayer,
  register,
  roomMenu,
  sit,
  TEXT,
  test,
} from './helpers';

// The room's main controls stand where the players look: the chair's start bar above the waiting
// room, which stays at the top of the screen; the game, which opens at its top; the switch for the
// sounds in the room menu; the tag beside the heading, which the chair switches between public and
// private; and the invitation of friends in the share row (friends.spec.ts) and the button to pause
// at the end of the clock (pause.spec.ts).

const text = TEXT.en;
const own = (name: string) => `${name}${Math.random().toString(36).slice(2, 7)}`;

async function box(page: Page, selector: string) {
  const found = await page.locator(selector).boundingBox();
  if (!found) throw new Error(`${selector} has no box`);
  return {
    top: found.y,
    bottom: found.y + found.height,
    left: found.x,
    right: found.x + found.width,
    width: found.width,
  };
}

const scrollToFoot = (page: Page) => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

// Ann chairs; Bob, Cat and Dan take the other seats.
async function seatRoom(browser: Browser, ann: Page, url: string): Promise<[Page, Page, Page]> {
  const join = async () => {
    const page = await newPlayer(browser, 'en');
    await joinByLink(page, url, 'en');
    return page;
  };
  const [bob, cat, dan] = await Promise.all([join(), join(), join()]);
  await Promise.all([
    sit(ann, 'red', 'captain', 'en'),
    sit(bob, 'red', 'guesser', 'en'),
    sit(cat, 'blue', 'captain', 'en'),
    sit(dan, 'blue', 'guesser', 'en'),
  ]);
  return [bob, cat, dan];
}

test('the chair starts from a bar that stays in sight, and the game opens at its top', async ({ browser }) => {
  const ann = await newPlayer(browser, 'en');
  const url = await createRoom(ann, 'en');

  // Alone, the chair reads on the first screen what is still missing, and can't start yet.
  const bar = ann.locator('.start-bar');
  await expect(bar).toBeInViewport();
  const firstNeed = interpolate(text.lobby.problems.needs_captain, { group: text.games.keywords.groups.red });
  await expect(bar.locator('.readiness')).toHaveText(firstNeed);
  await expect(ann.locator('.desk .problems li').first()).toHaveText(firstNeed);
  await expect(bar.getByRole('button', { name: text.lobby.start })).toBeDisabled();

  const [bob] = await seatRoom(browser, ann, url);
  await expect(bar.locator('.ready')).toHaveText(text.lobby.ready);
  // The page is drawn, with the bar in it: an html rule for the bar's shade reached the html
  // element itself once (PageMasthead.vue). Of the masthead and the bar, which both stay, the
  // lowest one that is stuck draws the shade under it: at the top of the page neither, a little
  // down the masthead, with the bar still lower down, and at the foot the bar, stuck under the
  // masthead, which then draws none.
  const shadeOf = (selector: string) =>
    ann.evaluate((found) => getComputedStyle(document.querySelector(found) as Element, '::after').opacity, selector);
  expect(await ann.evaluate(() => getComputedStyle(document.documentElement).opacity)).toBe('1');
  await expect(ann.locator('.start-dock')).not.toHaveClass(/\bstuck\b/);
  expect(await shadeOf('header.masthead')).toBe('0');
  expect(await shadeOf('.start-dock')).toBe('0');
  await ann.evaluate(() => window.scrollTo(0, 24));
  await expect.poll(() => shadeOf('header.masthead')).toBe('1');
  await expect(ann.locator('.start-dock')).not.toHaveClass(/\bstuck\b/);
  expect(await shadeOf('.start-dock')).toBe('0');
  await scrollToFoot(ann);
  await expect(ann.locator('.start-dock')).toHaveClass(/\bstuck\b/);
  await expect.poll(() => shadeOf('.start-dock')).toBe('1');
  await expect.poll(() => shadeOf('header.masthead')).toBe('0');
  await ann.evaluate(() => window.scrollTo(0, 0));
  await expect(ann.locator('.start-dock')).not.toHaveClass(/\bstuck\b/);
  // The page has one start button, the chair's, in the bar above the groups.
  await expect(ann.getByRole('button', { name: text.lobby.start })).toHaveCount(1);
  expect((await box(ann, '.start-bar')).bottom).toBeLessThanOrEqual((await box(ann, '.groups')).top);
  await expect(bob.locator('.start-bar')).toHaveCount(0);
  await expect(bob.getByRole('button', { name: text.lobby.start })).toHaveCount(0);

  // A field of the desk that takes the focus comes into view below the bar, not under it.
  const words = ann.locator('.desk textarea');
  await words.focus();
  await expect(words).toBeInViewport();
  expect((await box(ann, '.desk textarea')).top).toBeGreaterThanOrEqual((await box(ann, '.start-bar')).bottom);

  // At the foot of the desk the masthead is still at the top of the screen, with the reaction
  // button left of the room menu, and the bar right under it.
  await scrollToFoot(ann);
  await expect(bar).toBeInViewport();
  expect((await box(ann, 'header.masthead')).top).toBe(0);
  await expect(ann.locator('header.masthead .emote-button')).toBeVisible();
  expect((await box(ann, 'header.masthead .emote-button')).right).toBeLessThanOrEqual(
    (await box(ann, 'header.masthead .room-button')).left,
  );
  expect((await box(ann, '.start-bar')).top).toBeLessThan((await box(ann, 'header.masthead')).bottom + 40);
  expect((await box(ann, '.start-bar')).top).toBeGreaterThanOrEqual((await box(ann, 'header.masthead')).bottom);
  // The room menu opens from the masthead and closes without the page moving under it: neither as
  // the sheet takes the focus, nor as it gives the focus back to the button in the masthead. The
  // button is tapped where it is, as a finger taps it: a click by its locator would first scroll
  // the page to where the button stands in it, as the browser brings an element into view.
  const foot = await ann.evaluate(() => window.scrollY);
  const button = await box(ann, 'header.masthead .room-button');
  await ann.mouse.click((button.left + button.right) / 2, (button.top + button.bottom) / 2);
  await expect(ann.locator('[role=dialog]:has(.room-menu)')).toBeVisible();
  expect(await ann.evaluate(() => window.scrollY), 'the page under the open menu').toBe(foot);
  await ann.keyboard.press('Escape');
  await expect(ann.locator('[role=dialog]')).toHaveCount(0);
  expect(await ann.evaluate(() => window.scrollY), 'the page once the menu has closed').toBe(foot);
  await bar.getByRole('button', { name: text.lobby.start }).click();

  // The game opens at its top, with the turn strip and the clock in sight, and no banner; the
  // reaction button is in the clock's bar now, after the chair's button to pause.
  await expect(ann.locator('.keywords-game')).toBeVisible();
  await expect.poll(() => ann.evaluate(() => window.scrollY)).toBe(0);
  await expect(ann.locator('.strip')).toBeInViewport();
  await expect(ann.locator('.role-banner')).toHaveCount(0);
  await expect(ann.locator('.sticky-clock .pause + .emote-button')).toBeVisible();

  // The room menu has the switch for the sounds, the same as the quick reactions': off in one is
  // off in the other.
  const menu = await roomMenu(ann);
  const switchInMenu = menu.locator('.sound-toggle input');
  await expect(switchInMenu).not.toBeChecked();
  await switchInMenu.check();
  await ann.keyboard.press('Escape');
  await ann.locator('.sticky-clock').getByRole('button', { name: text.emotes.open }).click();
  const reactions = ann.locator('[role=dialog]', { has: ann.locator('.phrase') });
  await expect(reactions.locator('.sound-toggle input')).toBeChecked();
  await reactions.locator('.sound-toggle input').uncheck();
  await ann.keyboard.press('Escape');
  await expect((await roomMenu(ann)).locator('.sound-toggle input')).not.toBeChecked();
});

test('the chair switches the room between public and private from the tag beside the heading', async ({ browser }) => {
  const ann = await newPlayer(browser, 'en');
  await register(ann, own('Ann'));
  const url = await createRoom(ann, 'en');
  const bob = await newPlayer(browser, 'en');
  await joinByLink(bob, url, 'en');

  // Eve, on the home page, finds the room among the public rooms once it is listed, and no more
  // once it is private again; the list is asked for afresh each time.
  const eve = await newPlayer(browser, 'en');
  await eve.goto('/');
  await eve.getByRole('link', { name: /^English/ }).click();
  await eve.getByRole('button', { name: text.home.publicRooms.open }).click();
  const inList = eve.locator('.public-rooms .room', { has: eve.locator(`a[href="/room/${url.slice(-4)}"]`) });
  await expect(eve.locator('.public-rooms .rooms, .public-rooms .hint').last()).toBeVisible();
  await expect(inList).toHaveCount(0);

  const tag = ann.locator('.lobby-head').getByRole('button', { name: text.room.makePublic });
  await expect(tag.locator('.tag')).toHaveText(text.room.private);
  const height = (await tag.boundingBox())?.height ?? 0;
  expect(Math.round(height)).toBeGreaterThanOrEqual(44);
  await expect(bob.locator('.lobby-head .public')).toHaveCount(0);
  await tag.click();
  const listed = ann.locator('.lobby-head').getByRole('button', { name: text.room.makePrivate });
  await expect(listed.locator('.tag')).toHaveText(text.room.public);
  await expect(bob.locator('.lobby-head .public')).toHaveText(text.room.public);
  await expect((await roomMenu(ann)).locator('.visibility')).toHaveText(text.room.listed);
  await ann.keyboard.press('Escape');
  await eve.getByRole('button', { name: text.home.publicRooms.refresh }).click();
  await expect(inList).toHaveCount(1);
  await expect(inList).toContainText(text.home.publicRooms.waiting);

  await listed.click();
  await expect(ann.locator('.lobby-head .visibility .tag')).toHaveText(text.room.private);
  await expect(bob.locator('.lobby-head .public')).toHaveCount(0);
  await eve.getByRole('button', { name: text.home.publicRooms.refresh }).click();
  await expect(eve.locator('.public-rooms .rooms, .public-rooms .hint').last()).toBeVisible();
  await expect(inList).toHaveCount(0);
});

// On a phone as narrow as 320 px the start bar's line takes a row of its own, and its buttons share
// the next one evenly: whatever the desk brings into view still comes below the bar.
test.describe('on a 320 px phone', () => {
  test.use({ viewport: { width: 320, height: 700 } });

  test('a desk field that takes the focus comes into view below the taller start bar', async ({
    browser,
  }, testInfo) => {
    test.skip(!isPhone(testInfo), 'the bar wraps only where the screen is narrow');
    const ann = await newPlayer(browser, 'en');
    const url = await createRoom(ann, 'en');
    await seatRoom(browser, ann, url);
    await expect(ann.locator('.start-bar .ready')).toBeVisible();
    // The masthead, which stays at the top, has room for the room's number and the two buttons
    // beside the tile, on one row, with nothing to scroll sideways to.
    expect((await box(ann, 'header.masthead .manuscript')).left).toBeGreaterThanOrEqual(
      (await box(ann, 'header.masthead .tile')).right,
    );
    expect((await box(ann, 'header.masthead .room-button')).right).toBeLessThanOrEqual(320);
    expect(await ann.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    const line = await box(ann, '.start-bar .readiness');
    const shuffle = await box(ann, '.start-bar .button:not(.primary)');
    const start = await box(ann, '.start-bar .primary');
    expect(shuffle.top, 'the buttons stand under the line').toBeGreaterThanOrEqual(line.bottom);
    expect(Math.abs(start.top - shuffle.top), 'the buttons share a row').toBeLessThanOrEqual(1);
    expect(Math.abs(start.width - shuffle.width), 'the buttons share it evenly').toBeLessThanOrEqual(1);

    // From the foot of the desk, back up through its controls with the keyboard, which brings each
    // one that takes the focus into view: none of them ends up under the bar. Focus set from a
    // script scrolls otherwise, and doesn't show it.
    await scrollToFoot(ann);
    await ann.locator('.desk input, .desk textarea, .desk button').last().focus();
    const covered: string[] = [];
    for (let step = 0; step < 60; step += 1) {
      await ann.keyboard.press('Shift+Tab');
      const focused = await ann.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        const dock = document.querySelector('.start-dock');
        if (!active?.closest('.desk') || !dock) return null;
        const name = active.id || active.closest('label')?.textContent?.trim() || active.tagName;
        return { name, top: active.getBoundingClientRect().top, bar: dock.getBoundingClientRect().bottom };
      });
      if (!focused) break;
      if (focused.top < focused.bar)
        covered.push(`${focused.name} at ${Math.round(focused.top)}, bar to ${Math.round(focused.bar)}`);
    }
    expect(covered, 'controls of the desk under the start bar').toEqual([]);
  });
});

test('a chair without an account is told how to list the room, and comes back as the chair', async ({ browser }) => {
  const gus = await newPlayer(browser, 'en');
  const url = await createRoom(gus, 'en');
  const hal = await newPlayer(browser, 'en');
  await joinByLink(hal, url, 'en');
  // A guest has no friends to invite.
  await expect(gus.locator('.start-dock .invite-friends')).toHaveCount(0);

  await gus.locator('.lobby-head').getByRole('button', { name: text.room.makePublic }).click();
  const sheet = gus.locator('[role=dialog]', { has: gus.locator('.needs-account') });
  await expect(sheet).toContainText(text.room.publicNeedsAccount);
  await sheet.getByRole('link', { name: text.room.signIn }).click();
  await gus.waitForURL(/\/account\?next=/);
  const name = own('Gus');
  await gus.getByRole('button', { name: text.account.signIn.register, exact: true }).click();
  await gus.getByLabel(text.account.username).fill(name);
  await gus.getByLabel(text.account.password, { exact: true }).fill('correct horse');
  await gus.getByLabel(text.account.signIn.agree).check();
  await gus.getByRole('button', { name: text.account.signIn.registerSubmit }).click();

  // Back in the room, in the same seat, still the chair: the start bar is there, and the tag lists
  // the room.
  await gus.waitForURL(url);
  await expect(gus.locator('.lobby')).toBeVisible();
  await expect(gus.locator('.start-bar')).toBeVisible();
  await expect(gus.locator('.start-dock .invite-friends')).toBeVisible();
  await gus.locator('.lobby-head').getByRole('button', { name: text.room.makePublic }).click();
  await expect(hal.locator('.lobby-head .public')).toHaveText(text.room.public);
  await expect(hal.locator('.start-bar')).toHaveCount(0);
});

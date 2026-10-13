import type { Browser, Page } from '@playwright/test';
import {
  createRoom,
  expect,
  interpolate,
  joinByLink,
  newPlayer,
  register,
  roomMenu,
  sit,
  snapshotsOf,
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
  return { top: found.y, bottom: found.y + found.height };
}

const scrollToFoot = (page: Page) => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

// Ann chairs; Bob, Cat and Dan take the other seats.
async function seatRoom(browser: Browser, ann: Page, url: string): Promise<[Page, Page, Page]> {
  const join = async (name: string) => {
    const page = await newPlayer(browser, 'en');
    snapshotsOf(page);
    await joinByLink(page, url, name, 'en');
    return page;
  };
  const [bob, cat, dan] = await Promise.all([join('Bob'), join('Cat'), join('Dan')]);
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
  snapshotsOf(ann);
  const url = await createRoom(ann, 'en', 'Ann');

  // Alone, the chair reads on the first screen what is still missing, and can't start yet.
  const bar = ann.locator('.start-bar');
  await expect(bar).toBeInViewport();
  const firstNeed = interpolate(text.lobby.problems.needs_captain, { group: text.lobby.group.red });
  await expect(bar.locator('.readiness')).toHaveText(firstNeed);
  await expect(ann.locator('.desk .problems li').first()).toHaveText(firstNeed);
  await expect(bar.getByRole('button', { name: text.lobby.start })).toBeDisabled();

  const [bob] = await seatRoom(browser, ann, url);
  await expect(bar.locator('.ready')).toHaveText(text.lobby.ready);
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

  // At the foot of the desk the bar is still at the top of the screen.
  await scrollToFoot(ann);
  await expect(bar).toBeInViewport();
  expect((await box(ann, '.start-bar')).top).toBeLessThan(40);
  await bar.getByRole('button', { name: text.lobby.start }).click();

  // The game opens at its top, with the banner and the clock in sight.
  await expect(ann.locator('.keywords-game')).toBeVisible();
  await expect.poll(() => ann.evaluate(() => window.scrollY)).toBe(0);
  await expect(ann.locator('.role-banner')).toBeInViewport();

  // The room menu has the switch for the sounds, the same as the quick reactions': off in one is
  // off in the other.
  const menu = await roomMenu(ann);
  const switchInMenu = menu.locator('.sound-toggle input');
  await expect(switchInMenu).not.toBeChecked();
  await switchInMenu.check();
  await ann.keyboard.press('Escape');
  await ann.locator('.role-banner').getByRole('button', { name: text.emotes.open }).click();
  const reactions = ann.locator('[role=dialog]', { has: ann.locator('.phrase') });
  await expect(reactions.locator('.sound-toggle input')).toBeChecked();
  await reactions.locator('.sound-toggle input').uncheck();
  await ann.keyboard.press('Escape');
  await expect((await roomMenu(ann)).locator('.sound-toggle input')).not.toBeChecked();
});

test('the chair switches the room between public and private from the tag beside the heading', async ({ browser }) => {
  const ann = await newPlayer(browser, 'en');
  snapshotsOf(ann);
  await register(ann, own('Ann'));
  const url = await createRoom(ann, 'en', '');
  const bob = await newPlayer(browser, 'en');
  await joinByLink(bob, url, 'Bob', 'en');

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
  await listed.click();
  await expect(ann.locator('.lobby-head .visibility .tag')).toHaveText(text.room.private);
  await expect(bob.locator('.lobby-head .public')).toHaveCount(0);
});

test('a chair without an account is told how to list the room, and comes back as the chair', async ({ browser }) => {
  const gus = await newPlayer(browser, 'en');
  snapshotsOf(gus);
  const url = await createRoom(gus, 'en', 'Gus');
  const hal = await newPlayer(browser, 'en');
  await joinByLink(hal, url, 'Hal', 'en');
  // A guest has no friends to invite.
  await expect(gus.locator('.share .invite-friends')).toHaveCount(0);

  await gus.locator('.lobby-head').getByRole('button', { name: text.room.makePublic }).click();
  const sheet = gus.locator('[role=dialog]', { has: gus.locator('.needs-account') });
  await expect(sheet).toContainText(text.room.publicNeedsAccount);
  await sheet.getByRole('link', { name: text.room.signIn }).click();
  await gus.waitForURL(/\/account\?next=/);
  const name = own('Gus');
  await gus.getByRole('button', { name: text.account.signIn.register, exact: true }).click();
  await gus.getByLabel(text.account.username).fill(name);
  await gus.getByLabel(text.account.password, { exact: true }).fill('correct horse');
  await gus.getByRole('button', { name: text.account.signIn.registerSubmit }).click();

  // Back in the room, in the same seat, still the chair: the start bar is there, and the tag lists
  // the room.
  await gus.waitForURL(url);
  await expect(gus.locator('.lobby')).toBeVisible();
  await expect(gus.locator('.start-bar')).toBeVisible();
  await expect(gus.locator('.share .invite-friends')).toBeVisible();
  await gus.locator('.lobby-head').getByRole('button', { name: text.room.makePublic }).click();
  await expect(hal.locator('.lobby-head .public')).toHaveText(text.room.public);
  await expect(hal.locator('.start-bar')).toHaveCount(0);
});

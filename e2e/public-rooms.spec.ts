import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createRoom, expect, interpolate, logIn, newPlayer, register, TEXT, test } from './helpers';

// Public rooms end to end: a player with an account creates one, a guest finds it on the home
// page and is sent to register, which brings them back into the room; a player reports another,
// which the operator's command shows; the chair removes the player, who then can't come back on
// any device; and the operator bars an account, which then can't join a public room, but may join
// a private one, from which a removal lasts two minutes. The command runs on the server's data
// directory, which e2e/server.mjs makes where playwright.config.ts says.
const own = (name: string) => `${name}${Math.random().toString(36).slice(2, 7)}`;
const dataDir = process.env.E2E_DATA_DIR as string;

const admin = (...args: string[]): string =>
  spawnSync(process.execPath, [join(import.meta.dirname, '..', 'server', 'dist', 'admin.cjs'), ...args], {
    env: { ...process.env, DATA_DIR: dataDir },
    encoding: 'utf8',
  }).stdout.trim();

test('a public room is joined from the home page with an account, and a removed player stays out', async ({
  browser,
}) => {
  const text = TEXT.en;
  const annName = own('Ann');
  const bobName = own('Bob');
  const ann = await newPlayer(browser, 'en');
  await register(ann, annName);
  const url = await createRoom(ann, 'en', '', async (page) => {
    await page.getByRole('radio', { name: new RegExp(`^${text.create.public}\\b`) }).check();
  });
  await expect(ann.locator('.lobby-head .public')).toHaveText(text.room.public);

  // A guest finds the room on the home page, among those of the other tests that run meanwhile,
  // and is sent to register, which leads back to it.
  const code = url.slice(-4);
  const bob = await newPlayer(browser, 'en');
  await bob.goto('/');
  await bob.getByRole('button', { name: /^English/ }).click();
  await bob.getByRole('button', { name: text.home.publicRooms.open }).click();
  const listed = bob.locator('.public-rooms .room', { has: bob.locator(`a[href="/room/${code}"]`) });
  await expect(listed).toHaveCount(1);
  await expect(listed).toContainText(text.home.publicRooms.waiting);
  await expect(listed).toContainText(interpolate(text.home.publicRooms.players, { count: '1' }));
  await listed.getByRole('link', { name: text.home.publicRooms.join }).click();
  await bob.waitForURL(url);
  await expect(bob.getByText(text.errors.account_required)).toBeVisible();
  await bob.getByRole('link', { name: text.room.signIn }).click();
  await bob.getByRole('button', { name: text.account.signIn.register, exact: true }).click();
  await bob.getByLabel(text.account.username).fill(bobName);
  await bob.getByLabel(text.account.password, { exact: true }).fill('correct horse');
  await bob.getByRole('button', { name: text.account.signIn.registerSubmit }).click();
  await bob.waitForURL(url);
  await expect(bob.locator('.name-form')).toContainText(bobName);
  await bob.getByRole('button', { name: text.room.join.submit, exact: true }).click();
  await expect(bob.locator('.lobby')).toContainText(annName);
  await expect(ann.locator('.lobby')).toContainText(bobName);

  // Bob reports Ann, with a note, which the operator's command shows.
  await bob.locator('.lobby').getByRole('button', { name: annName }).click();
  await bob.getByRole('button', { name: text.lobby.manage.report }).click();
  await bob.getByLabel(text.lobby.manage.reportNote).fill('Rude clues');
  await bob.getByRole('button', { name: text.lobby.manage.reportSubmit }).click();
  await expect(bob.getByText(text.lobby.manage.reportSent)).toBeVisible();
  await expect
    .poll(() => admin('reports', 'list'))
    .toContain(`${bobName} reported ${annName} (account ${annName}) in R2-${code}: Rude clues`);

  // Ann removes Bob, after a word of warning. Bob is told, and can't come back by a reload, by the
  // link, or on another device.
  await ann.locator('.lobby').getByRole('button', { name: bobName }).click();
  await ann.getByRole('button', { name: text.lobby.manage.remove }).click();
  const warning = ann.locator('[role=dialog]');
  await expect(warning).toContainText(interpolate(text.lobby.manage.removeConfirm, { name: bobName }));
  await warning.getByRole('button', { name: text.lobby.manage.remove }).click();
  await expect(bob.getByText(text.room.closed.removed)).toBeVisible();
  await expect(ann.locator('.lobby')).not.toContainText(bobName);
  await bob.reload();
  await expect(bob.getByText(text.errors.removed)).toBeVisible();
  const bobsPhone = await newPlayer(browser, 'en');
  await logIn(bobsPhone, bobName);
  await bobsPhone.goto(url);
  await expect(bobsPhone.getByText(text.errors.removed)).toBeVisible();
  await expect(ann.locator('.lobby')).toContainText(annName);

  // The operator bars Bob, who then can't join any public room, and the room's menu says that
  // it is public, which the chair may change in the waiting room.
  expect(admin('accounts', 'bar', bobName)).toContain(`${bobName} may not create or join public rooms.`);
  const cat = await newPlayer(browser, 'en');
  await register(cat, own('Cat'));
  const other = await createRoom(cat, 'en', '', async (page) => {
    await page.getByRole('radio', { name: new RegExp(`^${text.create.public}\\b`) }).check();
  });
  await bobsPhone.goto(other);
  await expect(bobsPhone.getByText(text.errors.public_barred)).toBeVisible();
  await cat.locator('.masthead .room-button').click();
  const menu = cat.locator('[role=dialog]:has(.room-menu)');
  await expect(menu).toContainText(text.room.listed);
  await menu.getByRole('button', { name: text.room.makePrivate }).click();
  await expect(menu).toContainText(text.room.unlisted);
  await expect(cat.locator('.lobby-head .public')).toHaveCount(0);
  await cat.keyboard.press('Escape');

  // The room is private now, so Bob, who is barred from public rooms only, gets in. Removed from a
  // private room, he is told that he may come back in two minutes.
  await bobsPhone.goto(other);
  await bobsPhone.getByRole('button', { name: text.room.join.submit, exact: true }).click();
  await expect(cat.locator('.lobby')).toContainText(bobName);
  await cat.locator('.lobby').getByRole('button', { name: bobName }).click();
  await cat.getByRole('button', { name: text.lobby.manage.remove }).click();
  const privateWarning = cat.locator('[role=dialog]');
  await expect(privateWarning).toContainText(interpolate(text.lobby.manage.removeConfirmPrivate, { name: bobName }));
  await privateWarning.getByRole('button', { name: text.lobby.manage.remove }).click();
  await expect(bobsPhone.getByText(text.room.closed.removed_recently)).toBeVisible();
  await bobsPhone.reload();
  await expect(bobsPhone.getByText(text.errors.removed_recently)).toBeVisible();
});

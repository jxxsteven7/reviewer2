import type { Page } from '@playwright/test';
import { ACCOUNT_API } from '@reviewer2/shared';
import {
  closeSheet,
  createRoom,
  expect,
  gameOf,
  joinByLink,
  logIn,
  mailedLink,
  nameOf,
  newPlayer,
  openGroups,
  playToTheEnd,
  register,
  roomMenu,
  seatTable,
  snapshotsOf,
  TEXT,
  test,
} from './helpers';

// Accounts end to end: a game played by players with accounts and guests, on the records; the
// name and the avatar that rooms show; an email address bound with the link in a mail, and a
// forgotten password reset with another; and an account deleted. Guests play as they always did,
// in this file and in all the others, by the numbers their rooms give them.
//
// All tests share one server, on which a registered name is nobody else's. So every account and
// address here has a part that is the test's own.
const own = (name: string) => `${name}${Math.random().toString(36).slice(2, 7)}`;

// The requests that a page makes for its records, which only the account's own page asks for: a
// page that logs in and leaves must not show it on the way out, not even for a moment.
function recordsRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === ACCOUNT_API.records) urls.push(request.url());
  });
  return urls;
}

// A picture as a phone would give it: larger than an avatar, not square, and a PNG.
async function picture(page: Page): Promise<Buffer> {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    context.fillStyle = '#1f4f8f';
    context.fillRect(0, 0, 640, 480);
    context.fillStyle = '#f5d0a9';
    context.beginPath();
    context.arc(320, 240, 150, 0, Math.PI * 2);
    context.fill();
    return canvas.toDataURL('image/png').split(',')[1] as string;
  });
  return Buffer.from(data, 'base64');
}

test('players with accounts play a whole game with guests, and find it on their records', async ({
  browser,
  browserName,
}) => {
  test.slow(browserName === 'webkit', 'a whole game on WebKit takes about a minute');
  const text = TEXT.en;
  // Ann chairs the room as red's PI and Dan guesses for blue, both logged in; Bob, Cat and Eve are
  // guests.
  const usernames: Record<string, string> = { Ann: own('Ann'), Dan: own('Dan') };
  const table = await seatTable(browser, 'en', async (page, seat) => {
    if (usernames[seat]) await register(page, usernames[seat]);
  });
  const ann = table.captains.red;
  // Their names in the room are their usernames, with the default avatar, which is the initial.
  await expect((await roomMenu(ann)).locator('.who')).toContainText(usernames.Ann as string);
  await closeSheet(ann);
  await expect(await openGroups(table.spectator)).toContainText(usernames.Dan as string);

  await playToTheEnd(table);
  // Nobody's snapshots say more about a player than the name, a guest's number, whether they are
  // online, the avatar and the rank: nothing of an account, a login or an address.
  for (const states of table.everyone) {
    for (const state of states) {
      for (const player of state.players) {
        expect(
          Object.keys(player).filter(
            (key) => !['id', 'name', 'guest', 'online', 'avatar', 'rank', 'handle'].includes(key),
          ),
        ).toEqual([]);
      }
    }
  }
  const winner = gameOf(snapshotsOf(table.spectator).at(-1))?.result?.winner;
  const annWon = winner === 'red';

  await ann.goto('/account');
  // The game is an ordinary one, outside a match.
  const stats = ann.locator('.records .record-stats');
  await expect(stats.locator('.block .value')).toHaveText(['1', annWon ? '100%' : '0%', '0', '0']);
  await expect(ann.locator('.records .record .tag')).toHaveText([text.account.profile.ordinaryTag]);
  const record = ann.locator('.records .record');
  await expect(record).toHaveCount(1);
  await expect(record).toContainText(text.game.letter.short[annWon ? 'poster' : 'reject']);
  await expect(record).toContainText(`${text.lobby.group.red}, ${text.account.profile.roles.captain}`);
  // However narrow the page, nothing on the line runs under the button on its right.
  expect(
    await record.evaluate((line) => {
      const button = line.querySelector('.watch')?.getBoundingClientRect();
      const words = [...line.querySelectorAll(':scope > :not(.watch)')].map((part) => part.getBoundingClientRect());
      return button !== undefined && words.every((part) => part.right <= button.left);
    }),
  ).toBe(true);

  const dan = table.guessers.blue;
  await dan.goto('/account');
  await expect(dan.locator('.records .record')).toContainText(
    `${text.lobby.group.blue}, ${text.account.profile.roles.guesser}`,
  );
});

test('a new name and avatar show in the room', async ({ browser }) => {
  const text = TEXT.zh;
  const name = own('\u{5b89}\u{59ae}');
  const ann = await newPlayer(browser, 'zh');
  await register(ann, name);
  const url = await createRoom(ann, 'zh');
  const guest = await newPlayer(browser, 'zh');
  await joinByLink(guest, url, 'zh');
  await expect(guest.locator('.lobby')).toContainText(name);

  // Ann goes to her page and back, as a player can at any time, and keeps her seat.
  const renamed = own('Annie');
  await ann.goto('/account');
  await ann.getByRole('button', { name: text.account.profile.rename, exact: true }).click();
  await ann.getByRole('textbox', { name: text.account.username, exact: true }).fill(renamed);
  await ann.getByRole('button', { name: text.account.profile.renameSubmit, exact: true }).click();
  await expect(ann.locator('.profile .name')).toHaveText(renamed);
  await expect(guest.locator('.lobby')).toContainText(renamed);

  await ann.locator('input[type=file]').setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: await picture(ann),
  });
  await expect(ann.locator('.cropper canvas')).toBeVisible();
  await ann.getByRole('button', { name: text.account.avatar.use }).click();
  await expect(ann.locator('.identity img')).toHaveAttribute('src', /^\/avatars\/[0-9a-f]{64}\.(webp|jpg)$/);
  const avatar = await ann.locator('.identity img').getAttribute('src');
  await expect(guest.locator(`.lobby img[src="${avatar}"]`)).toBeVisible();
  // The picture is served as an image, and nothing more.
  const response = await guest.request.get(avatar as string);
  expect(response.headers()).toMatchObject({
    'content-type': expect.stringMatching(/^image\/(webp|jpeg)$/),
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'",
  });
  expect((await response.body()).length).toBeLessThanOrEqual(64 * 1024);

  await ann.goto(url);
  const menu = await roomMenu(ann);
  await expect(menu.locator('.who img')).toHaveAttribute('src', avatar as string);
});

test('a guest who registers in the middle of a game keeps their seat, as the account', async ({ browser }) => {
  const chair = await newPlayer(browser);
  const url = await createRoom(chair, 'en');
  const player = await newPlayer(browser);
  await joinByLink(player, url, 'en');
  const guest = nameOf(player);
  await expect(chair.locator('.lobby')).toContainText(guest);
  // Ann registers on the account page, and opens the room again: the seat she took as a guest is
  // hers, as the account, by its username, and the guest's number is gone.
  const name = own('Ann');
  await register(player, name);
  await player.goto(url);
  await expect(player.locator('.lobby')).toBeVisible();
  await expect(player.locator('.join-form')).toHaveCount(0);
  const menu = await roomMenu(player);
  await expect(menu.locator('.who')).toContainText(name);
  await expect(chair.locator('.lobby .player', { hasText: name })).toHaveCount(1);
  await expect(chair.locator('.lobby')).not.toContainText(guest);
});

test('a password change keeps the browser logged in, on the page and on its connection', async ({ browser }) => {
  const text = TEXT.en;
  const name = own('Ann');
  const page = await newPlayer(browser);
  const records = recordsRequests(page);
  await register(page, name);
  expect(records).toEqual([]);
  const url = await createRoom(page, 'en');
  // To the account page from the home page, without loading the page again: the connection, which
  // the server closes with the login, is the one the page keeps using.
  await page.goBack();
  await page.waitForURL(/\/$/);
  await page.locator('.avatar-link').click();
  await page.waitForURL(/\/account$/);
  await page.getByRole('button', { name: text.account.profile.changePassword, exact: true }).click();
  await page.getByLabel(text.account.profile.currentPassword).fill('correct horse');
  await page.getByLabel(text.account.profile.newPassword).fill('battery staple');
  await page
    .locator('[role=dialog]')
    .getByRole('button', { name: text.account.profile.passwordSubmit, exact: true })
    .click();
  await expect(page.getByText(text.account.profile.passwordChanged)).toBeVisible();
  await expect(page.locator('.profile .name')).toHaveText(name);
  // Still logged in, with the new password, in the room as before and after a reload.
  await page.goto(url);
  await expect((await roomMenu(page)).locator('.who')).toContainText(name);
  await page.reload();
  await expect((await roomMenu(page)).locator('.who')).toContainText(name);
  await page.goto('/account');
  await expect(page.locator('.profile .name')).toHaveText(name);
});

test('an address is bound with the link in a mail, and resets a forgotten password', async ({ browser }) => {
  const text = TEXT.en;
  const name = own('Ann ');
  const address = `${name.slice(4)}@example.com`;
  const phone = await newPlayer(browser);
  await register(phone, name);
  await phone.goto('/account');
  await phone.getByRole('button', { name: text.account.profile.bind }).click();
  await phone.getByRole('textbox', { name: text.account.forgot.email }).fill(address.toUpperCase());
  await phone.getByLabel(text.account.profile.yourPassword).fill('correct horse');
  await phone.getByRole('button', { name: text.account.profile.bindSubmit }).click();
  await expect(phone.locator('.email .state')).toHaveText(text.account.profile.emailStates.pending);

  // The mail is opened on another device, which isn't logged in.
  const inbox = await newPlayer(browser);
  const confirm = await mailedLink('bind', address);
  expect(confirm).toMatch(/\/account\/confirm#[\w-]{43}$/);
  await inbox.goto(confirm);
  // The secret leaves the address bar at once, and nothing happens until the button is pressed.
  await expect(inbox).toHaveURL(/\/account\/confirm$/);
  await inbox.getByRole('button', { name: text.account.confirm.submit }).click();
  await expect(inbox.getByText(text.account.confirm.done)).toBeVisible();
  await phone.reload();
  await expect(phone.locator('.email .state')).toHaveText(text.account.profile.emailStates.bound);

  // Ann forgets her password, and resets it from a laptop.
  const laptop = await newPlayer(browser);
  await laptop.goto('/account/forgot');
  await laptop.getByRole('textbox', { name: text.account.forgot.email }).fill(address);
  await laptop.getByRole('button', { name: text.account.forgot.submit }).click();
  await expect(laptop.getByText(text.account.forgot.sent)).toBeVisible();
  await laptop.goto(await mailedLink('reset', address));
  await expect(laptop).toHaveURL(/\/account\/reset$/);
  await laptop.getByLabel(text.account.profile.newPassword).fill('battery staple');
  await laptop.getByRole('button', { name: text.account.reset.submit }).click();
  await expect(laptop.locator('.profile .name')).toHaveText(name);

  // The phone was logged out, and the old password no longer works.
  await phone.reload();
  await expect(phone.locator('.tabs').getByRole('button', { name: text.account.signIn.login })).toBeVisible();
  await phone.getByLabel(text.account.username).fill(name);
  await phone.getByLabel(text.account.password, { exact: true }).fill('correct horse');
  await phone.locator('form').getByRole('button', { name: text.account.signIn.loginSubmit }).click();
  await expect(phone.getByRole('alert')).toHaveText(text.errors.login_failed);
  const records = recordsRequests(phone);
  await logIn(phone, name, 'battery staple');
  expect(records).toEqual([]);
  await phone.goto('/account');
  await expect(phone.locator('.profile .name')).toHaveText(name);
});

test('an account that is deleted is gone, and its name is free', async ({ browser }) => {
  const text = TEXT.en;
  const name = own('Ann');
  const page = await newPlayer(browser);
  await register(page, name);
  await page.goto('/account');
  await page.getByRole('button', { name: text.account.profile.delete }).click();
  await page.locator('[role=dialog]').getByLabel(text.account.profile.yourPassword).fill('correct horse');
  await page.getByRole('button', { name: text.account.profile.deleteSubmit }).click();
  await page.waitForURL(/\/$/);
  await page.goto('/account');
  await expect(page.locator('.tabs').getByRole('button', { name: text.account.signIn.login })).toBeVisible();

  const other = await newPlayer(browser);
  await register(other, name.toUpperCase());
  await other.goto('/account');
  await expect(other.locator('.profile .name')).toHaveText(name.toUpperCase());
});

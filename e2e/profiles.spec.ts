import { createRoom, expect, interpolate, joinByLink, newPlayer, register, TEXT, test } from './helpers';

// Public profiles end to end (docs/architecture.md#public-profiles): a player sets up the page on
// the account page; another opens it by its address, sees the number, the line as the text it is,
// the link and the record, likes it and asks to be friends; the owner sees the badge on the home
// page, the liker on the account page, and accepts; a guest sees the count and nothing to do; and
// in a room, the page opens from the player menu in a sheet, so that nobody leaves the room.
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

  // Ann writes a link and a line, shows her record, and finds her number and the way to her page.
  await ann.goto('/account');
  const setup = ann.locator('.public');
  await setup.getByLabel(text.account.profile.public.link).fill(' https://ann.example/me ');
  await setup.getByLabel(text.account.profile.public.bio).fill('  Reviewer of <b>everything</b>  ');
  await setup.getByLabel(text.account.profile.public.showRecord).check();
  await setup.getByRole('button', { name: text.account.profile.public.save }).click();
  await expect(ann.getByText(text.account.profile.public.saved)).toBeVisible();
  await expect(ann.locator('.profile .number')).toContainText(/Player No\. \d+/);
  const address = await setup.getByRole('link', { name: text.account.profile.public.view }).getAttribute('href');
  expect(address).toMatch(/^\/p\/[0-9a-f]{12}$/);

  // Bob opens it by its address: the line is text, not markup, and the link is the address it is.
  await bob.goto(address as string);
  const card = bob.locator('.profile-card');
  await expect(card).toContainText(annName);
  await expect(card).toContainText(text.ranks.names.undergraduate);
  await expect(card.locator('.bio')).toHaveText('Reviewer of <b>everything</b>');
  expect(await card.locator('.bio b').count()).toBe(0);
  const link = card.getByRole('link', { name: 'https://ann.example/me' });
  await expect(link).toHaveAttribute('href', 'https://ann.example/me');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'nofollow ugc noopener');
  await expect(card).toContainText(interpolate(text.playerPage.record, { games: '0', wins: '0', matches: '0' }));
  await expect(card).toContainText(interpolate(text.playerPage.likes, { count: '0' }));

  // Bob likes the page, and asks Ann to be friends from it.
  await card.getByRole('button', { name: text.playerPage.like, exact: true }).click();
  await expect(card.getByRole('button', { name: text.playerPage.liked })).toBeVisible();
  await expect(card).toContainText(interpolate(text.playerPage.likes, { count: '1' }));
  await card.getByRole('button', { name: text.friends.addFromRoom }).click();
  await expect(bob.getByText(text.friends.requestSent)).toBeVisible();

  // Ann's home page counts the request on her avatar; her account page shows Bob among those who
  // liked her page, not yet a friend, and the request, which she accepts.
  await ann.goto('/');
  // The language gate stands on the browser's first visit to the home page.
  await expect(ann.locator('.gate, .home').first()).toBeVisible();
  const gate = ann.getByRole('button', { name: new RegExp(`^${text.language.en}`) });
  if (await gate.count()) await gate.click();
  await expect(ann.locator('.avatar-link .badge')).toHaveText('1');
  await ann.goto('/account');
  await expect(ann.locator('.profile h2 .badge')).toHaveText('1');
  const liker = ann.locator('.likers .line', { hasText: bobName });
  await expect(liker.getByRole('button', { name: text.friends.addFromRoom })).toBeVisible();
  await ann.locator('.friends').getByRole('button', { name: text.friends.accept }).click();
  await expect(ann.locator('.friends .line', { hasText: bobName })).toContainText(text.friends.online);
  await expect(ann.locator('.profile h2 .badge')).toHaveCount(0);
  await ann.reload();
  await expect(ann.locator('.likers .line', { hasText: bobName })).toContainText(text.account.profile.public.friend);

  // Ann opens her own page: no way to like it, and the way back to the account page.
  await ann.goto(address as string);
  await expect(ann.locator('.profile-card')).toContainText(text.playerPage.edit);
  expect(await ann.locator('.profile-card button').count()).toBe(0);

  // A guest sees the count and the line, and nothing to do; an address that is no page says so.
  const guest = await newPlayer(browser, 'en');
  await guest.goto(address as string);
  await expect(guest.locator('.profile-card')).toContainText(interpolate(text.playerPage.likes, { count: '1' }));
  await expect(guest.locator('.profile-card')).toContainText(text.playerPage.logInToLike);
  expect(await guest.locator('.profile-card button').count()).toBe(0);
  await guest.goto('/p/000000000000');
  await expect(guest.locator('.player-page')).toContainText(text.errors.no_such_profile);

  // In a room, Bob opens Ann's page from the player menu, in a sheet, and stays in the room.
  const room = await createRoom(ann, 'en', '');
  await joinByLink(bob, room, '', 'en');
  await bob.locator('.lobby .player', { hasText: annName }).click();
  await bob.getByRole('button', { name: text.lobby.manage.viewPage }).click();
  const sheet = bob.locator('[role=dialog]', { has: bob.locator('.profile-card') });
  await expect(sheet.locator('.profile-card')).toContainText('https://ann.example/me');
  await expect(sheet.locator('.profile-card .number')).toContainText(/Player No\. \d+/);
  await expect(bob).toHaveURL(room);
  await bob.keyboard.press('Escape');
  await expect(bob.locator('.lobby')).toContainText(annName);
});

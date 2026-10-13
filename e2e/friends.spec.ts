import { createRoom, expect, interpolate, joinByLink, newPlayer, register, roomMenu, TEXT, test } from './helpers';

// Friends, invitations and academic ranks end to end (docs/architecture.md#friends): a player asks
// another to be friends from the player menu in a room, the other accepts on the account page, a
// friend is asked by username too; the friend list says who is online and where; an invitation,
// which shows on the account page, leads into a private room; a public room is joined from the
// list; and the rank shows beside the name in the room and on the account page.
//
// All tests share one server, so every account here has a part that is the test's own.
const own = (name: string) => `${name}${Math.random().toString(36).slice(2, 7)}`;

test('friends are made in a room and by username, invited into a private room, and ranked', async ({ browser }) => {
  const text = TEXT.en;
  const [annName, bobName, catName] = [own('Ann'), own('Bob'), own('Cat')];
  const ann = await newPlayer(browser, 'en');
  await register(ann, annName);
  const bob = await newPlayer(browser, 'en');
  await register(bob, bobName);
  const cat = await newPlayer(browser, 'en');
  await register(cat, catName);

  // Ann's private room, where Bob joins her. Both are kindergartners, which shows beside their names.
  const first = await createRoom(ann, 'en', '');
  await joinByLink(bob, first, '', 'en');
  const annInRoom = bob.locator('.lobby .player', { hasText: annName });
  await expect(annInRoom).toContainText(text.ranks.names.kindergarten);
  await expect(ann.locator('.lobby .player', { hasText: bobName })).toContainText(text.ranks.names.kindergarten);

  // Bob asks Ann to be friends from the player menu.
  await annInRoom.click();
  await bob.getByRole('button', { name: text.friends.addFromRoom }).click();
  await expect(bob.getByText(text.friends.requestSent)).toBeVisible();

  // Ann accepts on her account page, where the request is waiting, and then sees Bob among her
  // friends, online and in a room, whose number she isn't told since the room is private.
  await ann.goto('/account');
  const annsFriends = ann.locator('.friends');
  await expect(annsFriends.locator('.line', { hasText: bobName })).toBeVisible();
  await annsFriends.getByRole('button', { name: text.friends.accept }).click();
  const bobsLine = annsFriends.locator('.line', { hasText: bobName });
  await expect(bobsLine).toContainText(text.friends.online);
  await expect(bobsLine).toContainText(text.friends.inRoom);
  await expect(bobsLine.getByRole('link', { name: text.friends.join })).toHaveCount(0);
  // Ann asks Cat by username, and Cat accepts on her own page, which heard of the request.
  await annsFriends.getByLabel(text.friends.addLabel).fill(catName.toUpperCase());
  await annsFriends.getByRole('button', { name: text.friends.addSubmit }).click();
  await expect(ann.getByText(text.friends.requestSent)).toBeVisible();
  await cat.goto('/account');
  await cat.locator('.friends').getByRole('button', { name: text.friends.accept }).click();
  await expect(cat.locator('.friends .line', { hasText: annName })).toContainText(text.friends.online);
  await expect(annsFriends.locator('.line', { hasText: catName })).toContainText(text.friends.online);

  // The rank on the account page: a kindergartner with no points, 30 short of primary school. The
  // rank opens the ladder of every rank, the kindergartner marked at the bottom and Reviewer 2 at
  // the top, which Escape closes.
  await expect(ann.locator('.rank-line')).toContainText(text.ranks.names.kindergarten);
  await expect(ann.locator('.rank-line')).toContainText(interpolate(text.ranks.points, { points: '0' }));
  await ann.locator('.rank-button').click();
  const ladder = ann.locator('[role=dialog]', { has: ann.locator('.ladder') });
  await expect(ladder).toContainText(text.ranks.ladder.title);
  await expect(ladder.locator('.rung')).toHaveCount(13);
  await expect(ladder.locator('.rung').first()).toContainText(text.ranks.names.reviewer2);
  const marked = ladder.locator('.rung[aria-current="true"]');
  await expect(marked).toHaveCount(1);
  await expect(marked).toContainText(text.ranks.names.kindergarten);
  await expect(marked).toContainText(interpolate(text.ranks.next, { points: '30', rank: text.ranks.names.primary }));
  await expect(marked).toBeInViewport();
  await ann.keyboard.press('Escape');
  await expect(ladder).toHaveCount(0);

  // Ann makes a second private room and invites Bob from the room menu. Bob, who is on his account
  // page, sees the invitation there and follows it into the room.
  const second = await createRoom(ann, 'en', '');
  await bob.goto('/account');
  await expect(bob.locator('.friends .line', { hasText: annName })).toContainText(text.friends.inRoom);
  const menu = await roomMenu(ann);
  await menu.getByRole('button', { name: text.friends.invite }).click();
  const sheet = ann.locator('[role=dialog]:has(.invite)');
  await expect(sheet.locator('.friend', { hasText: catName })).toBeVisible();
  await sheet.locator('.friend', { hasText: bobName }).getByRole('button', { name: text.friends.inviteOne }).click();
  await expect(sheet.locator('.friend', { hasText: bobName })).toContainText(text.friends.invited);
  const code = second.slice(-4);
  const invitation = bob.locator('.invitation', { hasText: annName });
  await expect(invitation).toContainText(interpolate(text.friends.invitation, { name: annName, code: `R2-${code}` }));
  await invitation.getByRole('button', { name: text.friends.invitationJoin }).click();
  await bob.waitForURL(/\/room\/[0-9A-Z]{4}\?invite=/);
  await expect(bob.locator('.name-form')).toContainText(bobName);
  await bob.getByRole('button', { name: text.room.join.submit, exact: true }).click();
  await expect(bob.locator('.lobby')).toContainText(annName);
  await expect(bob).toHaveURL(second);
  await expect(ann.locator('.lobby')).toContainText(bobName);
  await ann.keyboard.press('Escape');
  await ann.keyboard.press('Escape');

  // Ann lists the room: Cat, who is friends with her, sees which room she is in and joins it from
  // her friend list.
  const again = await roomMenu(ann);
  await again.getByRole('button', { name: text.room.makePublic }).click();
  await expect(again).toContainText(text.room.listed);
  await ann.keyboard.press('Escape');
  await cat.locator('.friends').getByRole('button', { name: text.friends.refresh }).click();
  const annsLine = cat.locator('.friends .line', { hasText: annName });
  await expect(annsLine).toContainText(interpolate(text.friends.inPublicRoom, { code: `R2-${code}` }));
  await annsLine.getByRole('link', { name: text.friends.join }).click();
  await cat.waitForURL(second);
  await cat.getByRole('button', { name: text.room.join.submit, exact: true }).click();
  await expect(cat.locator('.lobby')).toContainText(bobName);
  await expect(ann.locator('.lobby .player', { hasText: catName })).toContainText(text.ranks.names.kindergarten);
});

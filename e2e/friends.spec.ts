import {
  askFriend,
  avatarOf,
  createRoom,
  expect,
  interpolate,
  joinByLink,
  newPlayer,
  register,
  roomMenu,
  searchFriends,
  TEXT,
  test,
} from './helpers';

// Friends, invitations and academic ranks end to end (docs/architecture.md#friends): a player asks
// another to be friends from the player menu in a room, the other accepts on the account page; on
// the account page, a player finds another by username or by a link to their page, and asks or
// answers in their panel; the friend list says who is online and where; an invitation,
// which shows on the account page, leads into a private room; a public room is joined from the
// list; and the rank shows beside the name in the room and on the account page. A friend in a
// private room is asked to let a player in, from the home page or the account page, and invites
// them, or ignores it.
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

  // Bob asks Ann to be friends from her panel, which her avatar opens, with a line for her.
  await annInRoom.locator('.avatar-button').click();
  await bob.getByRole('button', { name: text.friends.addFromRoom }).click();
  const asking = bob.getByRole('dialog', { name: interpolate(text.friends.addTitle, { name: annName }) });
  await asking.getByLabel(text.friends.noteLabel).fill('We met at the  workshop');
  await asking.getByRole('button', { name: text.friends.addSubmit }).click();
  await expect(bob.getByText(text.friends.requestSent)).toBeVisible();
  // Asked once, the panel says so, and asks no more.
  await annInRoom.locator('.avatar-button').click();
  await expect(bob.getByRole('button', { name: text.friends.requestPending })).toBeDisabled();
  await expect(bob.getByRole('button', { name: text.friends.addFromRoom })).toHaveCount(0);
  await bob.keyboard.press('Escape');

  // Ann accepts on her account page, where the request is waiting with Bob's line, and then sees Bob
  // among her friends, online and in a room, whose number she is told although the room is private,
  // since she has a seat there too. The line is gone with the request.
  await ann.goto('/account');
  const annsFriends = ann.locator('.friends');
  await expect(annsFriends.locator('.card', { hasText: bobName })).toContainText(
    interpolate(text.friends.noteQuoted, { note: 'We met at the workshop' }),
  );
  await annsFriends.getByRole('button', { name: text.friends.accept }).click();
  const bobsLine = annsFriends.locator('.card', { hasText: bobName });
  await expect(bobsLine).not.toContainText('We met at the workshop');
  await expect(bobsLine).toContainText(text.friends.online);
  await expect(bobsLine).toContainText(interpolate(text.friends.inPublicRoom, { code: `R2-${first.slice(-4)}` }));
  await expect(bobsLine.getByRole('link', { name: text.friends.join })).toHaveAttribute(
    'href',
    `/room/${first.slice(-4)}`,
  );
  // Ann finds Cat by her username, in capitals, which the search reads as names are compared, and
  // asks her from her panel, with a line for her. The panel and the box are cleared after.
  await searchFriends(ann, catName.toUpperCase());
  const catForAnn = ann.getByRole('dialog', { name: catName });
  await expect(catForAnn.locator('.profile-card')).toContainText(text.ranks.names.kindergarten);
  await catForAnn.getByRole('button', { name: text.friends.addFromRoom }).click();
  const askingCat = ann.getByRole('dialog', { name: interpolate(text.friends.addTitle, { name: catName }) });
  await askingCat.getByLabel(text.friends.noteLabel).fill('Lab mate?');
  await askingCat.getByRole('button', { name: text.friends.addSubmit }).click();
  await expect(ann.getByText(text.friends.requestSent)).toBeVisible();
  await expect(ann.getByRole('dialog')).toHaveCount(0);
  await expect(annsFriends.getByLabel(text.friends.search.label)).toHaveValue('');
  // Found again, Cat's panel says that the request went.
  await searchFriends(ann, catName);
  await expect(catForAnn.getByRole('button', { name: text.friends.requestPending })).toBeDisabled();
  await ann.keyboard.press('Escape');
  // Cat finds Ann by the link to her page, pasted with words around it, and accepts in Ann's panel,
  // which shows Ann's line.
  const annsPage = await ann.getByRole('link', { name: text.account.profile.public.view }).getAttribute('href');
  await cat.goto('/account');
  await searchFriends(cat, `Here is my page: ${new URL(annsPage as string, ann.url()).href} see you`);
  const annForCat = cat.getByRole('dialog', { name: annName });
  await expect(annForCat).toContainText(text.friends.askedYou);
  await expect(annForCat).toContainText(interpolate(text.friends.noteQuoted, { note: 'Lab mate?' }));
  await annForCat.getByRole('button', { name: text.friends.accept, exact: true }).click();
  await expect(cat.getByText(text.friends.nowFriends)).toBeVisible();
  await expect(cat.locator('.friends .card', { hasText: annName })).toContainText(text.friends.online);
  await expect(annsFriends.locator('.card', { hasText: catName })).toContainText(text.friends.online);
  // Outside a room too, a tap on an avatar opens the panel, and the whole page rises over it.
  await annsFriends.locator('.card', { hasText: catName }).getByRole('button', avatarOf(catName)).click();
  const catsPanel = ann.getByRole('dialog', { name: catName });
  await expect(catsPanel.getByRole('button', { name: text.friends.aliasEdit })).toBeVisible();
  await catsPanel.getByRole('button', { name: text.room.panel.fullPage }).click();
  const catsPage = ann.locator('[role=dialog].tall');
  await expect(catsPage.getByRole('button', { name: text.friends.short.remove, exact: true })).toBeVisible();
  await catsPage.getByRole('button', { name: text.room.panel.back }).click();
  await expect(catsPage).toHaveCount(0);
  await expect(catsPanel).toBeVisible();
  await ann.keyboard.press('Escape');
  await expect(ann.getByRole('dialog')).toHaveCount(0);
  // Now Ann is a friend, whom the panel offers a name or parting; a part of a name finds nobody, and
  // Cat finds herself.
  await searchFriends(cat, annName);
  await expect(annForCat.getByRole('button', { name: text.friends.aliasEdit })).toBeVisible();
  await expect(annForCat.getByRole('button', { name: text.friends.removeFriend })).toBeVisible();
  await expect(annForCat.getByRole('button', { name: text.friends.addFromRoom })).toHaveCount(0);
  await cat.keyboard.press('Escape');
  await searchFriends(cat, annName.slice(0, -1));
  await expect(cat.locator('.friends .search')).toContainText(text.friends.search.notFound);
  await searchFriends(cat, catName);
  await expect(cat.getByRole('dialog', { name: catName })).toContainText(text.friends.self);
  await cat.keyboard.press('Escape');

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

  // Ann makes a second private room and invites Bob from the start bar at the top of the waiting
  // room, beside the start button; the share row has no invitation. Bob, who is on his account
  // page, sees the invitation there and follows it into the room.
  const second = await createRoom(ann, 'en', '');
  await bob.goto('/account');
  // Bob has no seat in this one, and isn't told its number.
  await expect(bob.locator('.friends .card', { hasText: annName })).toContainText(text.friends.inRoom);
  await expect(
    bob.locator('.friends .card', { hasText: annName }).getByRole('link', { name: text.friends.join }),
  ).toHaveCount(0);
  // Bob gives Ann a name of his own, from her card's "more" button, which he alone sees.
  await bob
    .locator('.friends .card', { hasText: annName })
    .getByRole('button', { name: interpolate(text.friends.more, { name: annName }) })
    .click();
  await bob.getByRole('button', { name: text.friends.aliasEdit }).click();
  const naming = bob.getByRole('dialog', { name: interpolate(text.friends.aliasTitle, { name: annName }) });
  await naming.getByLabel(text.friends.aliasLabel).fill('Annie');
  await naming.getByRole('button', { name: text.friends.aliasSave }).click();
  await expect(naming).toHaveCount(0);
  const annForBob = bob.locator('.friends .card', { hasText: annName });
  await expect(annForBob.locator('.name')).toHaveText('Annie');
  await expect(annForBob.locator('.username')).toHaveText(annName);
  await expect(ann.locator('.lobby-head .share').getByRole('button', { name: text.friends.invite })).toHaveCount(0);
  const bar = ann.locator('.start-dock .start-actions');
  await expect(bar.locator('.button')).toHaveText([text.lobby.shuffle, text.friends.invite, text.lobby.start]);
  await bar.getByRole('button', { name: text.friends.invite }).click();
  const sheet = ann.locator('[role=dialog]:has(.invite)');
  await expect(sheet.locator('.friend', { hasText: catName })).toBeVisible();
  await sheet.locator('.friend', { hasText: bobName }).getByRole('button', { name: text.friends.inviteOne }).click();
  await expect(sheet.locator('.friend', { hasText: bobName })).toContainText(text.friends.invited);
  const code = second.slice(-4);
  const invitation = bob.locator('.invitation', { hasText: annName });
  await expect(invitation).toContainText(
    interpolate(text.friends.invitation, {
      name: interpolate(text.friends.aliasWithName, { alias: 'Annie', username: annName }),
      code: `R2-${code}`,
    }),
  );
  await invitation.getByRole('button', { name: text.friends.invitationJoin }).click();
  await bob.waitForURL(/\/room\/[0-9A-Z]{4}\?invite=/);
  await expect(bob.locator('.name-form')).toContainText(bobName);
  await bob.getByRole('button', { name: text.room.join.submit, exact: true }).click();
  await expect(bob.locator('.lobby')).toContainText(annName);
  await expect(bob).toHaveURL(second);
  // In the room Ann goes by her username, and her panel, by Bob's name for her, offers no request.
  await expect(bob.locator('.lobby .player', { hasText: annName }).locator('.name')).toHaveText(annName);
  await bob.locator('.lobby .player', { hasText: annName }).locator('.avatar-button').click();
  const annsPanel = bob.getByRole('dialog', { name: `Annie ${annName}` });
  await expect(annsPanel).toBeVisible();
  await expect(annsPanel.getByRole('button', { name: text.friends.addFromRoom })).toHaveCount(0);
  await bob.keyboard.press('Escape');
  await expect(ann.locator('.lobby')).toContainText(bobName);
  await ann.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  // Ann lists the room: Cat, who is friends with her, sees which room she is in and joins it from
  // her friend list. In the waiting room, the room menu leaves the invitation to the start bar.
  const again = await roomMenu(ann);
  await expect(again.getByRole('button', { name: text.friends.invite })).toHaveCount(0);
  await again.getByRole('button', { name: text.room.makePublic }).click();
  await expect(again).toContainText(text.room.listed);
  await ann.keyboard.press('Escape');
  await cat.locator('.friends').getByRole('button', { name: text.friends.refresh }).click();
  const annsLine = cat.locator('.friends .card', { hasText: annName });
  await expect(annsLine).toContainText(interpolate(text.friends.inPublicRoom, { code: `R2-${code}` }));
  await annsLine.getByRole('link', { name: text.friends.join }).click();
  await cat.waitForURL(second);
  await cat.getByRole('button', { name: text.room.join.submit, exact: true }).click();
  await expect(cat.locator('.lobby')).toContainText(bobName);
  await expect(ann.locator('.lobby .player', { hasText: catName })).toContainText(text.ranks.names.kindergarten);
});

test('a friend in a private room is asked to let a player in, and invites them or ignores it', async ({ browser }) => {
  const text = TEXT.en;
  const [annName, bobName, catName] = [own('Ann'), own('Bob'), own('Cat')];
  const ann = await newPlayer(browser, 'en');
  await register(ann, annName);
  const bob = await newPlayer(browser, 'en');
  await register(bob, bobName);
  const cat = await newPlayer(browser, 'en');
  await register(cat, catName);
  // Ann finds Bob and Cat by username and asks them, and both accept.
  await ann.goto('/account');
  for (const name of [bobName, catName]) {
    await askFriend(ann, name);
    await expect(ann.locator('.friends .card', { hasText: name })).toBeVisible();
  }
  for (const page of [bob, cat]) {
    await page.goto('/account');
    await page.locator('.friends').getByRole('button', { name: text.friends.accept }).click();
    await expect(page.locator('.friends .card', { hasText: annName })).toContainText(text.friends.online);
  }

  // Ann makes a private room. Bob's home page shows it among the rooms his friends are in, without
  // its number, and he asks to join.
  const code = (await createRoom(ann, 'en', '')).slice(-4);
  await bob.goto('/');
  await bob.getByRole('button', { name: new RegExp(`^${text.language.en}`) }).click();
  const playing = bob.locator('.friends-playing');
  await expect(playing.locator('h2')).toHaveText(text.home.friendsPlaying.title);
  const row = playing.locator('.room', { hasText: annName });
  await expect(row).toContainText(text.home.publicRooms.waiting);
  await expect(playing).not.toContainText(code);
  await row.getByRole('button', { name: text.friends.askJoin }).click();
  await expect(bob.getByText(text.friends.askSent)).toBeVisible();
  await expect(row.getByRole('button', { name: text.friends.asked })).toBeDisabled();

  // Ann sees the request in her room and invites Bob, who follows the invitation in.
  const notice = ann.locator('.join-ask', { hasText: bobName });
  await expect(notice).toContainText(interpolate(text.friends.askNotice, { name: bobName }));
  await notice.getByRole('button', { name: text.friends.askInvite }).click();
  await expect(notice).toHaveCount(0);
  await expect(row.getByRole('button', { name: text.friends.askJoin })).toBeEnabled();
  await bob
    .locator('.invitation', { hasText: annName })
    .getByRole('button', { name: text.friends.invitationJoin })
    .click();
  await bob.waitForURL(/\/room\/[0-9A-Z]{4}\?invite=/);
  await bob.getByRole('button', { name: text.room.join.submit, exact: true }).click();
  await expect(bob.locator('.lobby')).toContainText(annName);
  await expect(ann.locator('.lobby')).toContainText(bobName);

  // Cat asks from Ann's card on her account page; Ann ignores it, and Cat may ask again.
  await cat.reload();
  const annsCard = cat.locator('.friends .card', { hasText: annName });
  await expect(annsCard).toContainText(text.friends.inRoom);
  await annsCard.getByRole('button', { name: text.friends.askJoin }).click();
  await expect(annsCard.getByRole('button', { name: text.friends.asked })).toBeDisabled();
  const catsNotice = ann.locator('.join-ask', { hasText: catName });
  await catsNotice.getByRole('button', { name: text.friends.askIgnore }).click();
  await expect(catsNotice).toHaveCount(0);
  await expect(annsCard.getByRole('button', { name: text.friends.askJoin })).toBeEnabled();
});

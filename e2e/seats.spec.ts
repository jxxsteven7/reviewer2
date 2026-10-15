import type { Locator } from '@playwright/test';
import {
  avatarOf,
  closeSheet,
  createRoom,
  expect,
  guestName,
  isPhone,
  joinByLink,
  nameOf,
  newPlayer,
  openGroups,
  openLog,
  playFor,
  roomMenu,
  seatSaid,
  seatTable,
  sideChannel,
  test,
  TEXT,
} from './helpers';

const guesserIn = (team: 'red' | 'blue') => seatSaid(team);

test('players who come to play are dealt into the groups evenly, and the shuffle picks the PIs', async ({
  browser,
}) => {
  const ann = await newPlayer(browser);
  const url = await createRoom(ann, 'en');
  // One at a time, so that each finds the groups as the one before left them.
  for (let player = 0; player < 3; player += 1) await joinByLink(await newPlayer(browser), url, 'en');
  const eve = await newPlayer(browser);
  await joinByLink(eve, url, 'en', { watch: true });
  for (const team of ['red', 'blue'] as const) {
    await expect(ann.locator(`.group.${team} .names li`)).toHaveCount(2);
    await expect(ann.locator(`.group.${team}`)).toContainText(TEXT.en.lobby.vacant);
  }
  await expect(ann.locator('.spectators')).toContainText(nameOf(eve));

  await ann.getByRole('button', { name: TEXT.en.lobby.shuffle }).click();
  await expect(ann.locator('.start-bar .ready')).toBeVisible();
  await expect(ann.locator('.spectators')).toContainText(nameOf(eve));
});

test('a latecomer who comes to play gets a seat in the smaller group in the middle of a game', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  // Eve joins the blue group, which leaves the red one smaller.
  await openGroups(table.spectator);
  await table.spectator.getByRole('button', playFor('blue')).click();
  await openGroups(table.captains.red);
  await expect(table.captains.red.locator('.rosters .group.blue')).toContainText(table.names.spectator);
  // Ann's name, with the marks of the viewer and the chair after it, is shown whole: where the
  // line is too long, the rank gives way first (PlayerName.vue).
  const annsName = table.names.captains.red;
  const ann = table.captains.red.locator('.rosters .group.red .player', { hasText: annsName }).locator('.name');
  await expect(ann).toHaveText(annsName);
  expect(await ann.evaluate((name) => name.scrollWidth <= name.clientWidth)).toBe(true);

  const fay = await newPlayer(browser);
  await joinByLink(fay, table.url, 'en');
  await expect(fay.locator('.strip .who')).toHaveText(guesserIn('red'));
  await expect(table.captains.red.locator('.rosters .group.red')).toContainText(nameOf(fay));

  // A latecomer who comes to watch may still choose either group.
  const gus = await newPlayer(browser);
  await joinByLink(gus, table.url, 'en', { watch: true });
  await expect(gus.locator('.strip .who')).toHaveText(seatSaid(null));
  await openGroups(gus);
  await gus.getByRole('button', playFor('blue')).click();
  await expect(gus.locator('.strip .who')).toHaveText(guesserIn('blue'));
});

test('nobody changes groups in the middle of a game', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const bob = table.guessers.red;
  await openGroups(bob);
  await openGroups(table.captains.red);
  // A student is offered no seat in the other group, also after stepping out to watch.
  await expect(bob.getByRole('button', playFor('blue'))).toHaveCount(0);
  await bob.getByRole('button', { name: TEXT.en.game.watch }).click();
  await expect(bob.locator('.strip .who')).toHaveText(seatSaid(null));
  const name = table.names.guessers.red;
  await expect(table.captains.red.locator('.rosters .spectators')).toContainText(name);
  await expect(bob.getByRole('button', playFor('red'))).toBeVisible();
  await expect(bob.getByRole('button', playFor('blue'))).toHaveCount(0);
  // A page that asks for it anyway, such as an outdated tab, is refused.
  const tab = await sideChannel(bob, table.url);
  expect(await tab.send('keywords:seat', { team: 'blue', role: 'guesser' })).toEqual({
    ok: false,
    error: 'other_team',
  });
  await bob.getByRole('button', playFor('red')).click();
  // Back in the red group, on his own page and on the PI's.
  await expect(bob.locator('.strip .who')).toHaveText(guesserIn('red'));
  await expect(table.captains.red.locator('.rosters .spectators')).not.toContainText(name);
  await expect(table.captains.red.locator('.rosters .group.red')).toContainText(name);
});

test('an empty PI seat can be taken over, and its new PI sees the key and stays out of guessing', async ({
  browser,
}) => {
  const table = await seatTable(browser, 'en');
  const ann = table.captains.red;
  await (await roomMenu(ann)).getByRole('button', { name: TEXT.en.room.leave }).click();
  await ann.getByRole('dialog', { name: TEXT.en.room.leave }).getByRole('button', { name: TEXT.en.room.leave }).click();
  await ann.waitForURL(/\/$/);

  const eve = table.spectator;
  await openGroups(eve);
  await eve.locator('.rosters .group.red').getByRole('button', { name: TEXT.en.game.takeOver }).click();
  await eve
    .getByRole('dialog', { name: TEXT.en.game.takeOver })
    .getByRole('button', { name: TEXT.en.game.takeOver })
    .click();
  await expect(eve.locator('.board .card.known')).toHaveCount(25);

  // Ann comes back with the same browser, to play. Having seen the key, she can't play as a
  // student, and the server leaves her watching.
  await joinByLink(ann, table.url, 'en');
  await expect(ann.locator('.strip .who')).toHaveText(seatSaid(null));
  await expect(ann.locator('.keywords-game')).toBeVisible();
  await openGroups(ann);
  for (const team of ['red', 'blue'] as const) await expect(ann.getByRole('button', playFor(team))).toHaveCount(0);
  // Nor by asking the server straight out, as an outdated tab could.
  const tab = await sideChannel(ann, table.url);
  expect(await tab.send('keywords:seat', { team: 'red', role: 'guesser' })).toEqual({ ok: false, error: 'key_viewer' });
});

test('on a phone, the groups and the clue log open as sheets from the bar under the board', async ({
  browser,
}, testInfo) => {
  test.skip(!isPhone(testInfo), 'on a wide screen they stand beside the board');
  const table = await seatTable(browser, 'en');
  const text = TEXT.en;
  // The spectator, a PI and a student open both, read them, and close them: the groups with the
  // close button, the log with Escape.
  for (const page of [table.spectator, table.captains.red, table.guessers.blue]) {
    await expect(page.locator('.rosters, .clue-log')).toHaveCount(0);
    const groups = page.getByRole('dialog', { name: text.game.groups });
    await openGroups(page);
    await expect(groups.locator('.rosters .group.red')).toContainText(table.names.captains.red);
    await expect(groups.locator('.rosters .group.blue')).toContainText(table.names.guessers.blue);
    await groups.getByRole('button', { name: text.room.close }).click();
    await expect(groups).toHaveCount(0);
    const log = page.getByRole('dialog', { name: text.game.log });
    await openLog(page);
    await expect(log.locator('.clue-log')).toContainText(text.game.noClues);
    await closeSheet(page);
    await expect(log).toHaveCount(0);
  }
  // The seats work from the sheet: Eve plays for the blue group, and sees it on her own page and
  // on the PI's.
  await openGroups(table.spectator);
  await table.spectator.getByRole('button', playFor('blue')).click();
  await expect(table.spectator.locator('.strip .who')).toHaveText(guesserIn('blue'));
  await expect((await openGroups(table.captains.blue)).locator('.group.blue')).toContainText(table.names.spectator);
});

// The initial on a default avatar, which CSS draws from an attribute (PlayerAvatar.vue).
const initial = (avatar: Locator) => avatar.locator('.initial');

// Guests give no name (docs/architecture.md#players-and-identity): the room numbers them in the
// order they first come in, from the chair who opened it, and a guest who leaves and comes back from
// the same browser has their number again, which nobody else is ever given.
test('guests are numbered in the order they come in, and keep their number when they come back', async ({
  browser,
}) => {
  const text = TEXT.en;
  const ann = await newPlayer(browser);
  const url = await createRoom(ann, 'en');
  // One at a time, so that the order is known.
  const bob = await newPlayer(browser);
  await joinByLink(bob, url, 'en');
  const cat = await newPlayer(browser);
  await joinByLink(cat, url, 'en', { watch: true });
  const names = [1, 2, 3].map((number) => guestName(number));
  expect([ann, bob, cat].map(nameOf)).toEqual(names);
  // Everyone sees everyone by their number, with a G on the default avatar, and their own number in
  // the room menu, which offers no other name.
  for (const page of [ann, bob, cat]) {
    for (const name of names) {
      const player = page.locator('.lobby .player', { hasText: name });
      await expect(player.locator('.name')).toHaveText(name);
      await expect(initial(player)).toHaveAttribute('data-initial', 'G');
    }
  }
  const menu = await roomMenu(bob);
  await expect(menu.locator('.who')).toHaveText(names[1] as string);
  await expect(menu.getByRole('textbox')).toHaveCount(0);

  // Bob leaves. Dan, who comes next, is the fourth guest, and Bob, back from the same browser, is
  // the second again.
  await menu.getByRole('button', { name: text.room.leave }).click();
  await bob.getByRole('dialog', { name: text.room.leave }).getByRole('button', { name: text.room.leave }).click();
  await bob.waitForURL(/\/$/);
  await expect(ann.locator('.lobby')).not.toContainText(names[1] as string);
  const dan = await newPlayer(browser);
  await joinByLink(dan, url, 'en');
  expect(nameOf(dan)).toBe(guestName(4));
  await joinByLink(bob, url, 'en');
  expect(nameOf(bob)).toBe(names[1]);
  const everyone = ann.locator('.lobby .player .name');
  await expect.poll(async () => (await everyone.allTextContents()).sort()).toEqual([...names, guestName(4)].sort());
});

test('a Chinese room calls its guests by the word for a guest and the number', async ({ browser }) => {
  const ann = await newPlayer(browser, 'zh');
  const url = await createRoom(ann, 'zh');
  const bob = await newPlayer(browser, 'zh');
  await joinByLink(bob, url, 'zh');
  const names = [guestName(1, 'zh'), guestName(2, 'zh')];
  expect([ann, bob].map(nameOf)).toEqual(names);
  for (const page of [ann, bob]) {
    for (const name of names) {
      const player = page.locator('.lobby .player', { hasText: name });
      await expect(player.locator('.name')).toHaveText(name);
      await expect(initial(player)).toHaveAttribute('data-initial', '游');
    }
  }
});

// Anyone may tap a guest's avatar. The panel names the guest; the chair finds the chair's actions
// in it, and anyone else the avatar alone, since a guest has no page.
test("a guest's panel offers the chair's actions to the chair, and nothing to anyone else", async ({ browser }) => {
  const text = TEXT.en;
  const ann = await newPlayer(browser);
  const url = await createRoom(ann, 'en');
  const bob = await newPlayer(browser);
  await joinByLink(bob, url, 'en');
  const cat = await newPlayer(browser);
  await joinByLink(cat, url, 'en');
  const name = nameOf(bob);

  await ann.locator('.lobby').getByRole('button', avatarOf(name)).click();
  const chairs = ann.getByRole('dialog', { name, exact: true });
  await expect(chairs.locator('.panel-body button')).toHaveText([
    text.lobby.manage.spectate,
    text.lobby.manage.chair,
    text.lobby.manage.remove,
  ]);
  await closeSheet(ann);

  await cat.locator('.lobby').getByRole('button', avatarOf(name)).click();
  const others = cat.getByRole('dialog', { name, exact: true });
  await expect(initial(others.locator('.panel-body .avatar'))).toHaveAttribute('data-initial', 'G');
  await expect(others.locator('.panel-body button, .panel-body a')).toHaveCount(0);
  await expect(others.locator('.panel-body')).toHaveText('');
});

// The bars above the board show who is in each group (GroupBars.vue): every avatar there opens the
// player's panel, as anywhere in a room, the PI's too. A big screen's bars are pictures alone.
test("the group bars above the board open the players' panels", async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const bob = table.guessers.red;
  const pi = table.names.captains.blue;
  await bob.locator('.strip .score.blue .pi').getByRole('button', avatarOf(pi)).click();
  const panel = bob.getByRole('dialog', { name: pi, exact: true });
  await expect(initial(panel.locator('.panel-body .avatar'))).toHaveAttribute('data-initial', 'G');
  await closeSheet(bob);
  await expect(panel).toHaveCount(0);
  // The viewer comes first among the students of his group, and opens his own panel too.
  const own = bob.locator('.strip .score.red .students .avatar-button').first();
  await expect(own).toHaveAccessibleName(avatarOf(table.names.guessers.red).name);
  await own.click();
  await expect(bob.getByRole('dialog', { name: table.names.guessers.red, exact: true })).toBeVisible();
  await closeSheet(bob);
  await expect(table.screen.locator('.strip .scores .avatar')).toHaveCount(4);
  await expect(table.screen.locator('.strip .scores button')).toHaveCount(0);
});

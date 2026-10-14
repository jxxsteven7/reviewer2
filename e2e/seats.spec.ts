import {
  closeSheet,
  createRoom,
  expect,
  isPhone,
  joinByLink,
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
  const url = await createRoom(ann, 'en', 'Ann');
  // One at a time, so that each finds the groups as the one before left them.
  for (const name of ['Bob', 'Cat', 'Dan']) await joinByLink(await newPlayer(browser), url, name, 'en');
  await joinByLink(await newPlayer(browser), url, 'Eve', 'en', { watch: true });
  for (const team of ['red', 'blue'] as const) {
    await expect(ann.locator(`.group.${team} .names li`)).toHaveCount(2);
    await expect(ann.locator(`.group.${team}`)).toContainText(TEXT.en.lobby.vacant);
  }
  await expect(ann.locator('.spectators')).toContainText('Eve');

  await ann.getByRole('button', { name: TEXT.en.lobby.shuffle }).click();
  await expect(ann.locator('.start-bar .ready')).toBeVisible();
  await expect(ann.locator('.spectators')).toContainText('Eve');
});

test('a latecomer who comes to play gets a seat in the smaller group in the middle of a game', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  // Eve joins the blue group, which leaves the red one smaller.
  await openGroups(table.spectator);
  await table.spectator.getByRole('button', playFor('blue')).click();
  await openGroups(table.captains.red);
  await expect(table.captains.red.locator('.rosters .group.blue')).toContainText('Eve');
  // Ann's name, with the marks of the viewer and the chair after it, is shown whole: where the
  // line is too long, the rank gives way first (PlayerName.vue).
  const ann = table.captains.red.locator('.rosters .group.red .player', { hasText: 'Ann' }).locator('.name');
  await expect(ann).toHaveText('Ann');
  expect(await ann.evaluate((name) => name.scrollWidth <= name.clientWidth)).toBe(true);

  const fay = await newPlayer(browser);
  await joinByLink(fay, table.url, 'Fay', 'en');
  await expect(fay.locator('.role-banner .who')).toHaveText(guesserIn('red'));
  await expect(table.captains.red.locator('.rosters .group.red')).toContainText('Fay');

  // A latecomer who comes to watch may still choose either group.
  const gus = await newPlayer(browser);
  await joinByLink(gus, table.url, 'Gus', 'en', { watch: true });
  await expect(gus.locator('.role-banner .who')).toHaveText(seatSaid(null));
  await openGroups(gus);
  await gus.getByRole('button', playFor('blue')).click();
  await expect(gus.locator('.role-banner .who')).toHaveText(guesserIn('blue'));
});

test('nobody changes groups in the middle of a game', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const bob = table.guessers.red;
  await openGroups(bob);
  await openGroups(table.captains.red);
  // A student is offered no seat in the other group, also after stepping out to watch.
  await expect(bob.getByRole('button', playFor('blue'))).toHaveCount(0);
  await bob.getByRole('button', { name: TEXT.en.game.watch }).click();
  await expect(bob.locator('.role-banner .who')).toHaveText(seatSaid(null));
  await expect(table.captains.red.locator('.rosters .spectators')).toContainText('Bob');
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
  await expect(bob.locator('.role-banner .who')).toHaveText(guesserIn('red'));
  await expect(table.captains.red.locator('.rosters .spectators')).not.toContainText('Bob');
  await expect(table.captains.red.locator('.rosters .group.red')).toContainText('Bob');
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
  await joinByLink(ann, table.url, 'Ann', 'en');
  await expect(ann.locator('.role-banner .who')).toHaveText(seatSaid(null));
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
    await expect(groups.locator('.rosters .group.red')).toContainText('Ann');
    await expect(groups.locator('.rosters .group.blue')).toContainText('Dan');
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
  await expect(table.spectator.locator('.role-banner .who')).toHaveText(guesserIn('blue'));
  await expect((await openGroups(table.captains.blue)).locator('.group.blue')).toContainText('Eve');
});

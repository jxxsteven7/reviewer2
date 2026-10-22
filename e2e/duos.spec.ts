import { DUO_MIN } from '@reviewer2/shared';
import {
  askFriend,
  avatarOf,
  expect,
  interpolate,
  logIn,
  newPlayer,
  redWins,
  register,
  seatTable,
  TEXT,
  test,
} from './helpers';

// Friend duos end to end (docs/architecture.md#friend-duos): Ann, red's PI, and Bob, red's student,
// are friends, and red wins three games in a row. At the end of the third, each is told that the
// other is now their co-first author, and nobody else in the room is. Ann's friends list shows what
// the two have played and the title, a tap on which explains it; Bob's profile shows Ann the same;
// and the decision on her record explains itself too (docs/architecture.md#titles).
//
// All tests share one server, on which a registered name is nobody else's, so every account here
// has a part that is the test's own.
const own = (name: string) => `${name}${Math.random().toString(36).slice(2, 7)}`;

test('friends who win together become co-first authors, which they alone are told', async ({
  browser,
  browserName,
}) => {
  test.slow(browserName === 'webkit', 'three games on WebKit take a while');
  const text = TEXT.en;
  const names: Record<string, string> = { Ann: own('Ann'), Bob: own('Bob') };

  // Ann and Bob register and become friends, each on a page of their own, before the game.
  const [annAlone, bobAlone] = await Promise.all([newPlayer(browser), newPlayer(browser)]);
  await register(annAlone, names.Ann as string);
  await register(bobAlone, names.Bob as string);
  await annAlone.goto('/account');
  await askFriend(annAlone, names.Bob as string);
  await bobAlone.goto('/account');
  await bobAlone.locator('.friends').getByRole('button', { name: text.friends.accept }).click();
  await expect(bobAlone.locator('.friends .list .friend', { hasText: names.Ann as string })).toBeVisible();
  // Friends who have played nothing together have nothing to show.
  await expect(bobAlone.locator('.friends .friend .rest')).toHaveCount(0);
  await expect(bobAlone.locator('.friends .board')).toHaveCount(0);

  const table = await seatTable(browser, 'en', async (page, seat) => {
    if (names[seat]) await logIn(page, names[seat]);
  });
  const ann = table.captains.red;
  const bob = table.guessers.red;
  const others = [table.captains.blue, table.guessers.blue, table.spectator, table.screen];

  for (let game = 1; game <= DUO_MIN; game += 1) {
    if (game > 1) {
      await ann.getByRole('button', { name: text.games.keywords.letter.again }).click();
      await expect(ann.locator('.start-bar .ready')).toBeVisible();
      await ann.getByRole('button', { name: text.lobby.start }).click();
      await expect(ann.locator('.keywords-game')).toBeVisible();
    }
    await redWins(table, 'en');
    // Two games won together are not enough yet.
    if (game < DUO_MIN) for (const page of [ann, bob]) await expect(page.locator('.duo-notices')).toHaveCount(0);
  }

  // Each is told of the other, and nobody else is told anything.
  const told = (name: string) => interpolate(text.duos.notice.coauthor, { name, count: String(DUO_MIN) });
  for (const [page, friend] of [
    [ann, names.Bob],
    [bob, names.Ann],
  ] as const) {
    const card = page.locator('.duo-notices .notice');
    await expect(card).toHaveCount(1);
    await expect(card.locator('.title')).toHaveText(text.duos.names.coauthor);
    await expect(card.locator('.headline')).toHaveText(told(friend as string));
  }
  for (const page of others) await expect(page.locator('.duo-notices')).toHaveCount(0);
  // The title on the card explains itself.
  await ann.locator('.duo-notices .title button').click();
  const sheet = ann.getByRole('dialog', { name: text.duos.names.coauthor });
  await expect(sheet).toContainText(interpolate(text.duos.explain.coauthor, { min: String(DUO_MIN) }));
  await ann.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  // Ann's friends list: what the two have played, the title, and the board above the list.
  await ann.goto('/account');
  const bobsLine = ann.locator('.friends .list .friend', { hasText: names.Bob as string });
  await expect(bobsLine.locator('.games')).toHaveText(
    interpolate(text.duos.together, { won: String(DUO_MIN), lost: '0' }),
  );
  await expect(bobsLine.locator('.folded-titles .title .pill')).toHaveText(text.duos.names.coauthor);
  const board = ann.locator('.friends .board');
  await expect(board.locator('li')).toHaveCount(1);
  await expect(board.locator('.holder-name')).toHaveText(names.Bob as string);
  await bobsLine.locator('.folded-titles .title .pill').click();
  await expect(ann.getByRole('dialog', { name: text.duos.names.coauthor })).toContainText(text.duos.private);
  await ann.keyboard.press('Escape');

  // The decision of the latest game on her record: red won with blue far behind.
  const latest = ann.locator('.records .record').first();
  await latest.getByRole('button', { name: text.games.keywords.letter.short.oral }).click();
  await expect(ann.getByRole('dialog', { name: text.games.keywords.letter.verdicts.oral })).toContainText(
    text.games.keywords.letter.explain.oral,
  );
  await ann.keyboard.press('Escape');

  // Bob's page, which his avatar's panel opens, shows Ann what the two have played; she is the only
  // one it shows that to.
  await bobsLine.getByRole('button', avatarOf(names.Bob as string)).click();
  await ann
    .getByRole('dialog', { name: names.Bob as string })
    .getByRole('button', { name: text.room.panel.fullPage })
    .click();
  const duo = ann.locator('[role=dialog]:has(button.back) .profile-card section.duo');
  await expect(duo.locator('h3')).toHaveText(interpolate(text.playerPage.duo, { name: names.Bob as string }));
  await expect(duo.locator('.badge')).toHaveText(text.duos.names.coauthor);
  const page = await bob.evaluate(() => fetch('/api/account').then((reply) => reply.json()));
  const stranger = table.captains.blue;
  await stranger.goto(`/p/${(page as { account: { handle: string } }).account.handle}`);
  await expect(stranger.locator('.profile-card .name')).toHaveText(names.Bob as string);
  await expect(stranger.locator('.profile-card section.duo')).toHaveCount(0);
});

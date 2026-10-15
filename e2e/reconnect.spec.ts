import { formatCode } from '@reviewer2/shared';
import {
  expect,
  gameOf,
  giveClue,
  interpolate,
  revealByKey,
  seatSaid,
  seatTable,
  snapshotsOf,
  teamOnTurn,
  test,
  TEXT,
} from './helpers';

// After a refresh, a locked screen, a lost network or a visit to the home page, players come back
// to their room, group and role (docs/rules/constraints.md).

test('a player who reloads the page is back in their seat', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const team = await teamOnTurn(table.captains.red);
  await giveClue(table.captains[team], 'Hint', 2, 'en');
  const guesser = table.guessers[team];
  await guesser.reload();
  await expect(guesser.locator('.keywords-game')).toBeVisible();
  await expect(guesser.locator('form.join-form')).toHaveCount(0);
  await revealByKey(table, team);
});

test('a player who goes to the home page and back is in their seat at once', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const team = await teamOnTurn(table.captains.red);
  const guesser = table.guessers[team];
  const received = snapshotsOf(guesser);
  // The page leaves the room and its connection stays in it, so the clue reaches the page anyway.
  await guesser.getByRole('link', { name: TEXT.en.app.name, exact: true }).click();
  await expect(guesser.locator('.keywords-game')).toHaveCount(0);
  const clue = await giveClue(table.captains[team], 'Hint', 2, 'en');
  await expect.poll(() => gameOf(received.at(-1))?.clue?.word).toBe(clue);
  const before = received.length;
  await guesser.goBack();
  // At once: from what the connection has, with no handshake and no new snapshot, so the page
  // never says that the room is opening or asks whether the player plays.
  await expect(guesser.locator('.strip .clue .word')).toHaveText(clue, { timeout: 2_000 });
  await expect(guesser.locator('.loading, .banner, form.join-form')).toHaveCount(0);
  expect(received.length, 'snapshots received on the way back').toBe(before);
  await revealByKey(table, team);
});

// The home page, opened anew, knows nothing of the room until the server names it (meta:seats).
test('a player who opens the home page anew is offered the way back to their seat', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const team = await teamOnTurn(table.captains.red);
  const guesser = table.guessers[team];
  const code = new URL(table.url).pathname.split('/').at(-1) ?? '';
  await guesser.goto('/');
  // Whoever came in by the room's link chooses a language first.
  await guesser.getByRole('button', { name: new RegExp(`^${TEXT.en.language.en}`) }).click();
  const seat = guesser.locator('.seat');
  await expect(seat).toContainText(interpolate(TEXT.en.home.seats.playing, { code: formatCode(code) }));
  // Nobody is taken back without asking.
  expect(new URL(guesser.url()).pathname).toBe('/');
  await seat.getByRole('link', { name: TEXT.en.home.seats.back }).click();
  await expect(guesser).toHaveURL(new RegExp(`/room/${code}$`));
  await expect(guesser.locator('.strip .who')).toHaveText(seatSaid(team));
  await expect(guesser.locator('form.join-form')).toHaveCount(0);
  await giveClue(table.captains[team], 'Hint', 2, 'en');
  await revealByKey(table, team);
});

test('a player whose network drops until the page says so comes back by themselves', async ({ browser }) => {
  test.slow();
  const table = await seatTable(browser, 'en');
  const team = await teamOnTurn(table.captains.red);
  const guesser = table.guessers[team];
  await guesser.context().setOffline(true);
  await expect(guesser.locator('.banner')).toHaveText(TEXT.en.room.reconnecting, { timeout: 30_000 });
  const clue = await giveClue(table.captains[team], 'Hint', 2, 'en');
  await guesser.context().setOffline(false);
  await expect(guesser.locator('.banner')).toHaveCount(0, { timeout: 15_000 });
  // The clue that came while it was away is there, and the player can carry on.
  await expect(guesser.locator('.strip .clue .word')).toHaveText(clue);
  await revealByKey(table, team);
});

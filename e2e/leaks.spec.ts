import { otherTeam } from '@reviewer2/shared/keywords';
import {
  endTurn,
  expectNoKey,
  gameOf,
  giveClue,
  revealByKey,
  seatTable,
  snapshotsOf,
  teamOnTurn,
  expect,
  test,
} from './helpers';

// Socket.IO falls back to HTTP long-polling when a network blocks WebSockets. The key must stay
// hidden there too.
test('a guesser who can only long-poll never receives the key', async ({ browser }) => {
  let cut = 0;
  const table = await seatTable(browser, 'en', async (page, seat) => {
    if (seat !== 'Bob') return;
    await page.routeWebSocket(/\/socket\.io\//, (socket) => {
      cut += 1;
      socket.close();
    });
  });
  const bob = table.guessers.red;
  await expect(bob.locator('.board .card')).toHaveCount(25);
  // A turn, so that the snapshots after a clue, after a reveal and after the end of a turn come
  // by polling too, whichever group is on.
  const team = await teamOnTurn(table.captains.red);
  const clue = await giveClue(table.captains[team], 'Hint', 2, 'en');
  await revealByKey(table, team);
  await endTurn(table.guessers[team], 'en');
  // A snapshot is read from the body of a polling response, a moment after the page has shown it.
  const polled = snapshotsOf(bob);
  await expect.poll(() => gameOf(polled.at(-1))?.team).toBe(otherTeam(team));
  const games = polled.map(gameOf);
  expect(
    games.some((game) => game?.clue?.word === clue),
    'a snapshot with the clue',
  ).toBe(true);
  expect(
    games.some((game) => game?.cards.some((card) => card.revealed)),
    'a snapshot with the reveal',
  ).toBe(true);
  expect(expectNoKey(polled)).toBeGreaterThan(0);
  // Bob's browser did try WebSockets and was cut off every time, so all of that came by polling.
  expect(cut, 'WebSocket connections cut off').toBeGreaterThan(0);
});

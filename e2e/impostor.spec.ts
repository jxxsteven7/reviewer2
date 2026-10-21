import type { RoomView } from '@reviewer2/shared';
import type { ImpostorRoomData, ImpostorView } from '@reviewer2/shared/impostor';
import type { Page } from '@playwright/test';
import {
  createGameRoom,
  expect,
  interpolate,
  joinByLink,
  newPlayer,
  setSetting,
  snapshotsOf,
  test,
  TEXT,
} from './helpers';

// The second game from the room setup to its end (docs/games/impostor.md): four players describe
// their terms in turn, one reports another and the others judge it, one reloads in the middle and
// is back at their number, and everyone votes Reviewer 2 out.

const text = TEXT.en;
const impostor = text.games.impostor;

const gameIn = (state: RoomView | undefined): ImpostorView | null =>
  (state?.data as ImpostorRoomData | undefined)?.game ?? null;
const latest = (page: Page): ImpostorView | null => gameIn(snapshotsOf(page).at(-1));
const numberOf = (page: Page): number => latest(page)?.you?.number ?? 0;

// Lines made of no word that a term of the lists could hold, so that none gives a term away, and
// far enough apart that none is refused as the same as another.
const LINES = ['zorbly quaxing', 'wibbly flonk', 'plimsy groat', 'drabble snorf'];

// The page of the player whose turn it is to describe writes their line.
async function describe(players: Page[], line: string): Promise<void> {
  await expect.poll(() => latest(players[0]!)?.speaker ?? null).not.toBeNull();
  const speaker = latest(players[0]!)?.speaker;
  const page = players.find((player) => numberOf(player) === speaker);
  if (!page) throw new Error(`no page has #${speaker}`);
  const said = latest(players[0]!)?.lines.length ?? 0;
  const box = page.locator('.line-box');
  await box.getByRole('textbox').fill(line);
  await box.getByRole('button', { name: impostor.describe.send }).click();
  await expect.poll(() => latest(players[0]!)?.lines.length).toBe(said + 1);
}

test('four players describe, judge a report, come back after a reload and vote Reviewer 2 out', async ({ browser }) => {
  const chair = await newPlayer(browser);
  // No time limits, so that the test sets the pace.
  const url = await createGameRoom(chair, 'impostor', 'en', async (page) => {
    await setSetting(page, impostor.settings.boxes.describeTime, 0);
    await setSetting(page, impostor.settings.boxes.voteTime, 0);
  });
  const players = [chair];
  for (let joined = 0; joined < 3; joined += 1) {
    const page = await newPlayer(browser);
    await joinByLink(page, url, 'en');
    players.push(page);
  }
  // Whoever came to play has a place at the table, and the room can start.
  await expect(chair.locator('.lobby')).toContainText(
    interpolate(impostor.lobby.count, { count: '4', max: '12', min: '4' }),
  );
  await chair.getByRole('button', { name: text.lobby.start, exact: true }).click();
  for (const page of players) await expect(page.locator('.impostor-game')).toBeVisible();

  // Everyone has a number of their own and a term; Reviewer 2's differs from the three students'.
  await expect.poll(() => new Set(players.map(numberOf).filter(Boolean)).size).toBe(4);
  const termOf = (page: Page) => latest(page)?.you?.word ?? null;
  const terms = players.map(termOf);
  const reviewer2 = players.find((page) => terms.filter((term) => term === termOf(page)).length === 1);
  if (!reviewer2) throw new Error('no player has a term of their own');
  for (const page of players) {
    await expect(page.locator('.strip .who')).toHaveText(
      interpolate(impostor.strip.you, { number: String(numberOf(page)) }),
    );
  }

  // The first line, which a player who isn't its writer reports, and everyone else judges.
  await describe(players, LINES[0]!);
  const first = latest(chair)?.lines[0]?.number ?? 0;
  const reporter = players.find((page) => numberOf(page) !== first)!;
  await reporter
    .getByRole('button', { name: interpolate(impostor.openSeat, { number: String(first) }) })
    .first()
    .click();
  const panel = reporter.getByRole('dialog', { name: interpolate(impostor.number, { number: String(first) }) });
  await panel.getByRole('button', { name: impostor.panel.report, exact: true }).click();
  const report = reporter.getByRole('dialog', { name: interpolate(impostor.report.title, { number: String(first) }) });
  await report.getByLabel(impostor.report.noLine).check();
  await report.getByLabel(impostor.report.reason).fill('not a real description');
  await report.getByRole('button', { name: interpolate(impostor.report.submit, { number: String(first) }) }).click();
  // The whole room is asked, on a sheet of its own; the player reported can't judge, and the three
  // others disagree. Nobody else's sheet is left open.
  const judging = interpolate(impostor.report.made, { by: String(numberOf(reporter)), target: String(first) });
  const question = interpolate(impostor.report.question, { number: String(first) });
  for (const page of players) {
    const sheet = page.getByRole('dialog', { name: judging });
    await expect(sheet).toContainText('not a real description');
    await expect(page.getByRole('dialog')).toHaveCount(1);
    if (numberOf(page) === first) await expect(sheet).not.toContainText(question);
    else await expect(sheet).toContainText(question);
  }
  for (const page of players) {
    if (numberOf(page) === first) continue;
    const sheet = page.getByRole('dialog', { name: judging });
    await sheet.getByRole('button', { name: impostor.report.disagree, exact: true }).click();
  }
  // Once all three have judged, everyone sees that it was rejected, which costs the reporter.
  for (const page of players) {
    await expect(page.getByRole('dialog')).toContainText(
      interpolate(impostor.report.outcomeFailed, { number: String(numberOf(reporter)) }),
    );
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }

  // A player who reloads is back at their number, with their term, and the game goes on.
  const reloading = players[2]!;
  const before = { number: numberOf(reloading), term: termOf(reloading) };
  await reloading.reload();
  await expect(reloading.locator('.impostor-game')).toBeVisible();
  await expect(reloading.locator('form.join-form')).toHaveCount(0);
  await expect(reloading.locator('.strip .who')).toHaveText(
    interpolate(impostor.strip.you, { number: String(before.number) }),
  );
  expect({ number: numberOf(reloading), term: termOf(reloading) }).toEqual(before);

  for (const line of LINES.slice(1)) await describe(players, line);
  await expect.poll(() => latest(chair)?.phase).toBe('vote');

  // Everyone votes for Reviewer 2, who votes for someone else.
  const target = numberOf(reviewer2);
  for (const page of players) {
    const choice = page === reviewer2 ? numberOf(players.find((other) => other !== reviewer2)!) : target;
    await page
      .locator('.board label.seat-card')
      .filter({ has: page.locator(`input[value="${choice}"]`) })
      .locator('.text')
      .click();
    await page.getByRole('button', { name: interpolate(impostor.vote.submit, { number: String(choice) }) }).click();
  }

  // The game is over: Reviewer 2 was caught, everyone sees who was who, and may rate the pair.
  for (const page of players) {
    await expect(page.locator('.letter .verdict')).toHaveText(impostor.letter.results.caught);
    await expect(page.locator('.reveal li')).toHaveCount(4);
    await expect(page.getByRole('region', { name: impostor.rating })).toBeVisible();
  }
  const rating = chair.getByRole('region', { name: impostor.rating });
  await rating.getByText(text.rating.options.good, { exact: true }).click();
  await expect(rating.locator('label.chosen')).toHaveText(text.rating.options.good);
  expect(gameIn(snapshotsOf(chair).at(-1))?.result).toEqual({ winner: 'student', reason: 'caught' });
});

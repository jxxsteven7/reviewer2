import type { RoomView } from '@reviewer2/shared';
import type { ImpostorRoomData, ImpostorView } from '@reviewer2/shared/impostor';
import type { Browser, Page } from '@playwright/test';
import {
  createGameRoom,
  expect,
  interpolate,
  isPhone,
  joinByLink,
  newPlayer,
  register,
  setSetting,
  snapshotsOf,
  test,
  TEXT,
} from './helpers';

// The second game from the room setup to its end (docs/games/impostor.md): four players with
// accounts describe their terms in turn, one reports another and the others judge it, one reloads
// in the middle and is back at their number, everyone votes Reviewer 2 out, and each finds the game
// on their record. Then its matches (docs/games/impostor.md#matches): one of three games played to
// the end and ranked, and one that the chair ends between two games.

const text = TEXT.en;
const impostor = text.games.impostor;

const gameIn = (state: RoomView | undefined): ImpostorView | null =>
  (state?.data as ImpostorRoomData | undefined)?.game ?? null;
const latest = (page: Page): ImpostorView | null => gameIn(snapshotsOf(page).at(-1));
const numberOf = (page: Page): number => latest(page)?.you?.number ?? 0;

// An account's username, which no other test on the same server has.
const own = (name: string) => `${name}${Math.random().toString(36).slice(2, 7)}`;

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

test('four players describe, judge a report, come back after a reload, vote Reviewer 2 out and find it on their records', async ({
  browser,
}) => {
  const chair = await newPlayer(browser);
  await register(chair, own('Ann'));
  // No time limits, so that the test sets the pace.
  const url = await createGameRoom(chair, 'impostor', 'en', async (page) => {
    await setSetting(page, impostor.settings.boxes.describeTime, 0);
    await setSetting(page, impostor.settings.boxes.voteTime, 0);
  });
  const players = [chair];
  for (const name of ['Bob', 'Cat', 'Dan']) {
    const page = await newPlayer(browser);
    await register(page, own(name));
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
  const termOf = (page: Page) => latest(page)?.you?.word?.word ?? null;
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
  // The chair rates it: the option stays pressed, a line says it was noted, and the × then only
  // closes the card, keeping the rating rather than dismissing the question.
  const rating = chair.getByRole('region', { name: impostor.rating });
  const good = rating.getByRole('button', { name: text.rating.options.good, exact: true });
  await good.click();
  await expect(good).toHaveAttribute('aria-pressed', 'true');
  await expect(rating.getByRole('status')).toHaveText(text.rating.noted);
  await rating.getByRole('button', { name: text.rating.close }).click();
  await expect(rating).toBeHidden();
  expect(snapshotsOf(chair).at(-1)?.rating?.rating).toBe('good');
  expect(gameIn(snapshotsOf(chair).at(-1))?.result).toEqual({ winner: 'student', reason: 'caught' });

  // Each finds the game on their record of the second game, with their role and how their game
  // went, which a line on a phone puts under the role rather than cutting it short.
  for (const page of players) {
    await page.goto('/account');
    await page.locator('.game-tabs label').filter({ hasText: impostor.name }).click();
    const line = page.locator('.records .games .record');
    await expect(line).toHaveCount(1);
    const caught = page === reviewer2;
    await expect(line.locator('.role')).toHaveText(impostor.roles[caught ? 'reviewer2' : 'student']);
    const verdict = line.locator('.verdict');
    await expect(verdict).toHaveText(impostor.letter.short[caught ? 'voted_out' : 'alive']);
    expect(await verdict.evaluate((part) => part.scrollWidth <= part.clientWidth)).toBe(true);
  }
});

// A room of four for a match, with no time limits, so that the test sets the pace: the chair picks
// how many games, and three others join to play.
async function matchTable(browser: Browser, games: number): Promise<Page[]> {
  const chair = await newPlayer(browser);
  const url = await createGameRoom(chair, 'impostor', 'en', async (page) => {
    await setSetting(page, impostor.settings.boxes.describeTime, 0);
    await setSetting(page, impostor.settings.boxes.voteTime, 0);
    await page.getByRole('radio', { name: new RegExp(`^${text.match.match}`) }).check();
    // A few numbers of games to pick from, as pills, 3 picked first.
    const form = page.locator('.match-form');
    await expect(form).toContainText(impostor.match.note);
    await expect(form.getByLabel(interpolate(text.match.gamesChoice, { count: '3' }))).toBeChecked();
    await form.getByText(interpolate(text.match.gamesChoice, { count: String(games) }), { exact: true }).click();
  });
  const players = [chair];
  for (let joined = 0; joined < 3; joined += 1) {
    const page = await newPlayer(browser);
    await joinByLink(page, url, 'en');
    players.push(page);
  }
  return players;
}

// The chair starts a game of the match, which the four play to its end: each describes in turn, and
// all vote Reviewer 2 out, who votes for someone else. Every game deals the numbers anew.
async function playGame(players: Page[]): Promise<ImpostorView> {
  const [chair] = players as [Page];
  const before = latest(chair)?.gameId ?? null;
  await chair.getByRole('button', { name: text.lobby.start, exact: true }).click();
  for (const page of players) {
    await expect.poll(() => latest(page)?.gameId ?? before).not.toBe(before);
    await expect(page.locator('.impostor-game')).toBeVisible();
  }
  await expect.poll(() => new Set(players.map(numberOf).filter(Boolean)).size).toBe(4);
  const termOf = (page: Page) => latest(page)?.you?.word?.word ?? null;
  const terms = players.map(termOf);
  const reviewer2 = players.find((page) => terms.filter((term) => term === termOf(page)).length === 1);
  if (!reviewer2) throw new Error('no player has a term of their own');
  for (const line of LINES) await describe(players, line);
  await expect.poll(() => latest(chair)?.phase).toBe('vote');
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
  for (const page of players) await expect(page.locator('.letter .verdict')).toHaveText(impostor.letter.results.caught);
  return latest(chair)!;
}

// The chair goes on to the next game, which brings everyone back to the waiting room.
async function nextGame(players: Page[]): Promise<void> {
  await players[0]!.getByRole('button', { name: text.match.next }).click();
  for (const page of players) await expect(page.locator('.lobby')).toBeVisible();
}

test('four players play a match of three games, each dealt anew, and are ranked with no title', async ({ browser }) => {
  const players = await matchTable(browser, 3);
  const [chair, other] = players as [Page, Page];

  const first = await playGame(players);
  // Under the result, the match's table, with where each player's points came from, their role
  // first; the chair goes on, and the others wait.
  for (const page of players) {
    const table = page.locator('.match-table');
    await expect(table).toContainText(interpolate(text.match.progress, { game: '1', games: '3' }));
    await expect(table.locator('.detail.below').first()).toContainText(
      new RegExp(`^(${impostor.roles.student}|${impostor.roles.reviewer2})`),
    );
    await expect(table).toContainText(impostor.match.scoringLead);
  }
  await expect(other.getByText(text.match.waitNext)).toBeVisible();
  await nextGame(players);
  // The waiting room has the table first.
  await expect(chair.locator('.lobby .match-table')).toContainText(
    interpolate(text.match.progress, { game: '2', games: '3' }),
  );

  const second = await playGame(players);
  expect(second.words).not.toEqual(first.words);
  await nextGame(players);

  // During a game, the table opens in a sheet, with each player's total and not the points of the
  // game, which come only at its end.
  await players[0]!.getByRole('button', { name: text.lobby.start, exact: true }).click();
  await expect(other.locator('.impostor-game')).toBeVisible();
  await other
    .getByRole('button', { name: isPhone(other) ? text.game.buttons.match : text.match.progressTitle, exact: true })
    .click();
  const sheet = other.getByRole('dialog', { name: text.match.progressTitle });
  await expect(sheet.locator('.match-table')).toContainText(
    interpolate(text.match.progress, { game: '3', games: '3' }),
  );
  await expect(sheet.locator('thead th')).toHaveCount(3);
  await other.keyboard.press('Escape');
  await expect(other.getByRole('dialog')).toHaveCount(0);
  // The chair ends the game, which the match plays again.
  await chair.getByRole('button', { name: text.game.end, exact: true }).click();
  await chair.getByRole('dialog').getByRole('button', { name: text.game.end, exact: true }).click();
  for (const page of players) {
    await expect(page.locator('.match-table .note')).toHaveText(
      interpolate(impostor.match.unscored.withdrawn, { game: '3' }),
    );
  }
  await nextGame(players);

  const third = await playGame(players);
  expect(new Set([first, second, third].map((game) => JSON.stringify(game.words))).size).toBe(3);
  // The final ranking, which awards no title while the game is in beta; nothing offers another game.
  for (const page of players) {
    const results = page.locator('.match-results');
    await expect(results.getByRole('heading', { name: text.match.over })).toBeVisible();
    await expect(results).toContainText(interpolate(text.match.gamesPlayed, { played: '3', games: '3' }));
    await expect(results.locator('li')).toHaveCount(4);
    await expect(results.locator('li .rank').first()).toHaveText('1');
    await expect(results).not.toContainText(text.match.titleNames.best_paper);
    await expect(results).not.toContainText(text.match.titleNames.black_hole);
    await expect(page.getByRole('button', { name: text.match.next })).toHaveCount(0);
  }
  const standings = snapshotsOf(chair).at(-1)?.match?.standings ?? [];
  expect(standings.map((line) => line.games)).toEqual([3, 3, 3, 3]);
  expect(standings.every((line) => line.title === undefined)).toBe(true);
});

test('the chair ends a match between two games, and the waiting room offers no start', async ({ browser }) => {
  const players = await matchTable(browser, 5);
  const [chair, other] = players as [Page, Page];
  await playGame(players);
  await nextGame(players);
  const table = chair.locator('.lobby .match-table');
  await expect(table).toContainText(interpolate(text.match.progress, { game: '2', games: '5' }));
  await table.getByRole('button', { name: text.match.end, exact: true }).click();
  const confirm = chair.getByRole('dialog', { name: text.match.end });
  await expect(confirm).toContainText(text.match.endConfirmUntitled);
  await confirm.getByRole('button', { name: text.match.end, exact: true }).click();
  // Everyone sees the ranking by the one game that counted, with nothing on titles; the chair has
  // no start, which the server would refuse, but another match or an ordinary room.
  for (const page of [chair, other]) {
    const results = page.locator('.match-results');
    await expect(results.getByRole('heading', { name: text.match.stopped })).toBeVisible();
    await expect(results).toContainText(interpolate(text.match.gamesPlayed, { played: '1', games: '5' }));
    await expect(results).not.toContainText(text.match.stoppedNote);
    await expect(page.getByRole('button', { name: text.lobby.start, exact: true })).toHaveCount(0);
  }
  await expect(chair.locator('.desk')).toHaveCount(0);
  await chair.getByRole('button', { name: text.match.ordinaryRoom }).click();
  await expect(chair.getByRole('button', { name: text.lobby.start, exact: true })).toBeVisible();
  await expect(chair.locator('.match-results, .match-table')).toHaveCount(0);
});

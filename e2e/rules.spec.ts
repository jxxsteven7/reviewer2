import { checkClue, otherTeam } from '@reviewer2/shared/keywords';
import {
  chooseRule,
  createRoom,
  endTurn,
  gameOf,
  giveClue,
  interpolate,
  joinByLink,
  newPlayer,
  openLog,
  revealByKey,
  seatTable,
  setSetting,
  snapshotsOf,
  teamOnTurn,
  TEXT,
  expect,
  test,
} from './helpers';

const { settings } = TEXT.en;

test('under the free rule, a group goes on for as long as it finds its own cards', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const team = await teamOnTurn(table.captains.red);
  const captain = table.captains[team];
  // The numbers on offer run from 1 to the cards the group has left, which is 9 at the start.
  await expect(captain.locator('.counts button')).toHaveText(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  await giveClue(captain, 'Everything', 1, 'en');
  const guesser = table.guessers[team];
  for (let i = 0; i < 3; i += 1) await revealByKey(table, team);
  await expect(guesser.locator('.guess-bar')).toBeVisible();
  await expect(guesser.locator('.strip')).not.toContainText(TEXT.en.game.noLimit);
  await expect(guesser.locator('.strip .left')).toHaveCount(0);
  await endTurn(guesser, 'en');
  await expect(guesser.locator('.strip')).toHaveClass(new RegExp(`\\b${otherTeam(team)}\\b`));
});

test('under the standard rule, an unlimited clue allows any number of guesses, until the group ends its turn', async ({
  browser,
}) => {
  const table = await seatTable(browser, 'en', undefined, (page) => chooseRule(page, settings.guess.standard));
  const team = await teamOnTurn(table.captains.red);
  const guesser = table.guessers[team];
  await giveClue(table.captains[team], 'Everything', 'unlimited', 'en');
  for (let i = 0; i < 4; i += 1) await revealByKey(table, team);
  await expect(guesser.locator('.strip')).toContainText(TEXT.en.game.noLimit);
  await endTurn(guesser, 'en');
  await expect(guesser.locator('.strip')).not.toHaveClass(new RegExp(`\\b${team}\\b`));
});

test('the chair changes the rules in the waiting room, and everyone sees them', async ({ browser }) => {
  const ann = await newPlayer(browser, 'en');
  const url = await createRoom(ann, 'en');
  const bob = await newPlayer(browser, 'en');
  await joinByLink(bob, url, 'en');
  const summary = bob.locator('.settings-summary');
  await expect(summary).toContainText(settings.guess.free);
  await expect(summary).toContainText(settings.clue.strict);
  await expect(summary).toContainText(interpolate(settings.seconds, { count: '120' }));
  // The chair sees the form instead, and the save button only once something has changed.
  await expect(ann.locator('.settings-summary')).toHaveCount(0);
  await expect(ann.getByRole('button', { name: TEXT.en.lobby.save })).toHaveCount(0);
  await chooseRule(ann, settings.guess.standard);
  await chooseRule(ann, settings.clue.loose);
  await setSetting(ann, settings.guessTime, 5);
  await expect(ann.locator('.settings-form')).toContainText(interpolate(settings.timeRange, { min: '10', max: '600' }));
  await expect(ann.getByRole('button', { name: TEXT.en.lobby.save })).toBeDisabled();
  await setSetting(ann, settings.guessTime, 0);
  await ann.getByRole('button', { name: TEXT.en.lobby.save }).click();
  await expect(summary).toContainText(settings.guess.standard);
  await expect(summary).toContainText(settings.clue.loose);
  await expect(summary).toContainText(settings.noLimit);
  await expect(ann.getByRole('button', { name: TEXT.en.lobby.save })).toHaveCount(0);
});

test('the game starts with what the chair changed at the desk, saved or not', async ({ browser }) => {
  const table = await seatTable(browser, 'en', undefined, undefined, async (ann) => {
    await chooseRule(ann, settings.guess.standard);
    await expect(ann.locator('.desk .save')).toContainText(TEXT.en.lobby.saveHint);
  });
  const team = await teamOnTurn(table.captains.red);
  // The standard rule offers 0 to 9 and unlimited; the free rule, which the room was created
  // with, never offers unlimited.
  await expect(table.captains[team].locator('.counts button').last()).toHaveText('∞');
});

test('the server ends a turn whose time has run out', async ({ browser }) => {
  const table = await seatTable(browser, 'en', undefined, (page) => setSetting(page, settings.firstClueTime, 10));
  const team = await teamOnTurn(table.captains.red);
  const other = otherTeam(team);
  // The PI on turn, who has to act, has the red clock, and everyone else an ink one; the strip takes
  // the tint of the group on turn for its own members alone.
  await expect(table.captains[team].locator('.clock.mine').first()).toBeVisible();
  for (const page of [table.guessers[team], table.guessers[other], table.spectator, table.screen]) {
    await expect(page.locator('.clock').first()).toBeVisible();
    await expect(page.locator('.clock.mine')).toHaveCount(0);
  }
  await expect(table.guessers[team].locator('.strip')).toHaveClass(/\bours\b/);
  await expect(table.guessers[other].locator('.strip')).not.toHaveClass(/\bours\b/);
  // The PI gives no clue, and the turn passes to the other group with a note in the log.
  await expect(table.spectator.locator('.strip')).toHaveClass(new RegExp(`\\b${other}\\b`), {
    timeout: 20_000,
  });
  // Everyone in the room, the PI and the screen included, hears of the missed deadline at once,
  // by the PI's name; the PI is a guest, whose misses nobody counts.
  const pages = [...Object.values(table.captains), ...Object.values(table.guessers), table.spectator, table.screen];
  for (const page of pages) {
    const call = page.locator('.bubbles .call');
    await expect(call).toContainText(table.names.captains[team]);
    await expect(call).not.toContainText('\u00d7');
  }
  await expect(await openLog(table.spectator)).toContainText(TEXT.en.game.noClueInTime);
  // The red clock is the other group's PI's now.
  await expect(table.captains[other].locator('.clock.mine').first()).toBeVisible();
  await expect(table.captains[team].locator('.clock.mine')).toHaveCount(0);
});

test('the clock stays at the top of the screen as the page scrolls, under the reconnecting banner', async ({
  browser,
}) => {
  const table = await seatTable(browser, 'en');
  const page = table.spectator;
  // A phone's screen with the keyboard up, which leaves the board more than a screen to scroll.
  await page.setViewportSize({ width: 390, height: 420 });
  // The bar that holds the clock, and the chair's button to pause, is what sticks.
  const clock = page.locator('.sticky-clock');
  await expect(clock.locator('[role="timer"]')).toBeVisible();
  const top = async (locator: typeof clock) => Math.round((await locator.boundingBox())?.y ?? -1);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  await expect.poll(() => top(clock)).toBe(0);
  // The page finds its connection gone as soon as it looks, as when the phone comes back online.
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const banner = page.locator('.banner');
  await expect(banner).toHaveText(TEXT.en.room.reconnecting, { timeout: 10_000 });
  expect(await top(banner)).toBe(0);
  const height = Math.round((await banner.boundingBox())?.height ?? 0);
  await expect.poll(() => top(clock)).toBe(height);
  await page.context().setOffline(false);
  await expect(banner).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => top(clock)).toBe(0);
});

test('a clue that repeats a word on the board is refused while the PI types, naming the card', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const team = await teamOnTurn(table.captains.red);
  const captain = table.captains[team];
  // The cards as the PI's page has them, translations included, which is what the clue panel
  // checks a clue against, and the first word among them that would be a clue on its own: one
  // word with nothing else wrong with it. The rules refuse it as being on the board and name a
  // card. Which card is up to them, as the word may repeat part of an earlier card's word or a
  // translation; the rules have tests of their own.
  const cards = gameOf(snapshotsOf(captain).at(-1))?.cards ?? [];
  expect(cards).toHaveLength(25);
  const clue = cards.map((card) => card.word).find((word) => checkClue(word, []).problem === null);
  if (clue === undefined) throw new Error('no card on the board carries a single word');
  const { problem, conflict } = checkClue(clue, cards);
  expect(problem).toBe('clue_on_board');
  await captain.getByLabel(TEXT.en.game.clueInput).fill(clue);
  await expect(captain.locator('.clue-panel .problem')).toHaveText(
    interpolate(TEXT.en.game.onBoard, { word: `\u201c${conflict?.text}\u201d` }),
  );
  await expect(captain.getByRole('button', { name: TEXT.en.game.sendClue })).toBeDisabled();
});

test('revealing Reviewer 2 rejects the group at once', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const team = await teamOnTurn(table.captains.red);
  await giveClue(table.captains[team], 'Danger', 1, 'en');
  await revealByKey(table, team, 'reviewer2');
  const { verdicts } = TEXT.en.game.letter;
  await expect(table.guessers[team].locator('.letter .verdict')).toHaveText(verdicts.deskReject);
  // The other group still had all its cards to find: an oral.
  await expect(table.guessers[otherTeam(team)].locator('.letter .verdict')).toHaveText(verdicts.oral);
  await expect(table.screen.locator('.letter .verdict')).toHaveText([verdicts.oral, verdicts.deskReject]);
  await expect(table.screen.locator('.board .stamp')).toHaveText(TEXT.en.game.stamp);
});

test('the chair can withdraw a game and play again with the same seats', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const chair = table.captains.red;
  await chair.getByRole('button', { name: TEXT.en.game.end }).click();
  await chair.locator('[role=dialog]').getByRole('button', { name: TEXT.en.game.end }).click();
  // One letter for everyone, since nobody won.
  for (const page of [table.spectator, table.guessers.red]) {
    await expect(page.locator('.letter .verdict')).toHaveText(TEXT.en.game.letter.verdicts.withdrawn);
  }
  await chair.getByRole('button', { name: TEXT.en.game.letter.again }).click();
  await expect(table.guessers.blue.locator('.lobby')).toBeVisible();
  await expect(chair.locator('.start-bar .ready')).toBeVisible();
});

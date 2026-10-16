import {
  gameOf,
  giveClue,
  openLog,
  revealByKey,
  seatTable,
  setSetting,
  sideChannel,
  snapshotsOf,
  teamOnTurn,
  TEXT,
  expect,
  test,
} from './helpers';

// The chair pauses the game: nobody gets the board, every action is refused, and the clock
// stands still until the chair resumes it (docs/games/keywords.md#pauses-and-extensions).

// A string as a regular expression that matches it and nothing else.
const literally = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the chair pauses the game, which hides the board and stops the clock, and resumes it', async ({ browser }) => {
  const text = TEXT.en;
  const table = await seatTable(browser, 'en', undefined, async (page) => {
    await setSetting(page, text.settings.firstClueTime, 60);
    await setSetting(page, text.settings.clueTime, 60);
    await setSetting(page, text.settings.guessTime, 60);
  });
  const ann = table.captains.red;
  const team = await teamOnTurn(ann);
  const guesser = table.guessers[team];
  const tab = await sideChannel(guesser, table.url);
  const game = () => gameOf(snapshotsOf(ann).at(-1));

  const dealt = game()?.cards.map((card) => card.word) ?? [];
  expect(dealt).toHaveLength(25);
  // The chair's button to pause stands after the clock, before the reaction button, and the
  // bar stays at the top of the screen, so it is in sight at the foot of the page too. Nobody else
  // has one, only the reaction button, and the tools at the foot of the page don't.
  const bar = ann.locator('.sticky-clock');
  await expect(bar.locator('[role="timer"]')).toBeVisible();
  await expect(ann.locator('.tools').getByRole('button', { name: text.game.pause })).toHaveCount(0);
  for (const page of [guesser, table.captains.blue, table.spectator]) {
    await expect(page.locator('.sticky-clock [role="timer"]')).toBeVisible();
    await expect(page.locator('.sticky-clock button')).toHaveText([text.emotes.open]);
  }
  await ann.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(bar.getByRole('button', { name: text.game.pause })).toBeInViewport();
  await bar.getByRole('button', { name: text.game.pause }).click();
  // Everyone sees that the game is paused, and nobody has a card to look at, the PIs and the screen
  // included; the words of the board are nowhere on the page.
  for (const page of [ann, table.captains.blue, guesser, table.spectator, table.screen]) {
    await expect(page.locator('.paused-title')).toHaveText(text.game.paused);
    await expect(page.locator('.board .card')).toHaveCount(0);
    // Not as a word of its own, at least: "TA" is also in "SPECTATOR".
    const body = await page.locator('main').innerText();
    for (const word of dealt) expect(body).not.toMatch(new RegExp(`(^|\\P{L})${literally(word)}(\\P{L}|$)`, 'u'));
  }
  expect(game()?.paused).toBe(true);
  expect(game()?.cards).toEqual([]);
  // The paused snapshots carry no cards at all.
  for (const states of table.everyone) {
    const paused = states.filter((state) => gameOf(state)?.paused);
    expect(paused.length).toBeGreaterThan(0);
    for (const state of paused) expect(gameOf(state)?.cards).toEqual([]);
  }
  // A move is refused, from the page's own connection as from any other.
  const moment = { gameId: game()?.gameId, turn: game()?.turn };
  expect(await tab.send('keywords:clue', { ...moment, word: 'Hint', count: 1 })).toEqual({
    ok: false,
    error: 'paused',
  });
  expect(await tab.send('keywords:reveal', { ...moment, card: 0 })).toEqual({ ok: false, error: 'paused' });
  // The clock stands still at what it had left, on the big screen as on the phones.
  const left = game()?.clock?.left ?? 0;
  expect(left).toBeGreaterThan(0);
  const shown = await guesser.locator('[role="timer"] .seconds').innerText();
  const onScreen = await table.screen.locator('[role="timer"] .seconds').innerText();
  await guesser.waitForTimeout(2_000);
  await expect(guesser.locator('[role="timer"] .seconds')).toHaveText(shown);
  await expect(table.screen.locator('[role="timer"] .seconds')).toHaveText(onScreen);
  // Only the chair has the way to resume: in the notice, and where the button to pause was.
  await expect(guesser.locator('.paused button')).toHaveCount(0);
  await expect(ann.locator('.paused').getByRole('button', { name: text.game.resume })).toBeVisible();

  await bar.getByRole('button', { name: text.game.resume }).click();
  for (const page of [ann, guesser, table.screen]) {
    await expect(page.locator('.paused-title')).toHaveCount(0);
    await expect(page.locator('.board .card')).toHaveCount(25);
  }
  // The clock goes on from where it stopped, and the game too.
  expect(game()?.clock?.left).toBeLessThanOrEqual(left);
  expect(game()?.clock?.left).toBeGreaterThan(left - 10_000);
  await expect(guesser.locator('[role="timer"]')).toBeVisible();
  await giveClue(table.captains[team], 'Hint', 1, 'en');
  await revealByKey(table, team);
  // Paused again after the reveal, the log notes every pause and its end under the turn, and shows
  // the revealed card by its color alone, since there is no board to name it.
  await ann.getByRole('button', { name: text.game.pause }).click();
  await expect(ann.locator('.paused-title')).toHaveText(text.game.paused);
  const log = await openLog(ann);
  await expect(log.locator('.event')).toHaveText([
    text.game.events.paused,
    text.game.events.resumed,
    text.game.events.paused,
  ]);
  await expect(log.locator('.guess')).toHaveText(text.game.card[team]);
});

// Without a time limit there is no clock: the chair's button to pause stands at the top of the
// screen after the reaction button, and the others have the reaction button alone there.
test('the chair pauses a game without a clock from the top of the screen', async ({ browser }) => {
  const text = TEXT.en;
  const table = await seatTable(browser, 'en', undefined, async (page) => {
    await setSetting(page, text.settings.firstClueTime, 0);
    await setSetting(page, text.settings.clueTime, 0);
    await setSetting(page, text.settings.guessTime, 0);
  });
  const ann = table.captains.red;
  const bob = table.guessers.red;
  await expect(ann.locator('[role="timer"]')).toHaveCount(0);
  await expect(bob.locator('.sticky-clock button')).toHaveText([text.emotes.open]);
  const bar = ann.locator('.sticky-clock');
  await expect(bar.locator('button')).toHaveText([text.game.pause, text.emotes.open]);
  await ann.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(bar.getByRole('button', { name: text.game.pause })).toBeInViewport();
  await bar.getByRole('button', { name: text.game.pause }).click();
  await expect(bob.locator('.paused-title')).toHaveText(text.game.paused);
  await bar.getByRole('button', { name: text.game.resume }).click();
  await expect(bob.locator('.board .card')).toHaveCount(25);
});

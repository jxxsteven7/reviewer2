import {
  chooseCard,
  clueFor,
  closeSheet,
  gameOf,
  interpolate,
  openLog,
  revealByKey,
  seatTable,
  snapshotsOf,
  teamOnTurn,
  TEXT,
  expect,
  test,
} from './helpers';

// The cards a PI means with a clue (docs/games/keywords.md#the-clue): the PI marks them on the
// board, the number follows, nobody's snapshot holds them while the game is on, and once it is
// over the clue log and the replay show them to everyone. In both languages.

for (const language of ['en', 'zh'] as const) {
  test(`a PI marks the cards a clue is for, which everyone sees after the game, in ${language}`, async ({
    browser,
  }) => {
    const table = await seatTable(browser, language);
    const text = TEXT[language];
    const team = await teamOnTurn(table.captains.red);
    const captain = table.captains[team];
    const guesser = table.guessers[team];

    // The clue panel says that the PI may mark cards.
    await expect(captain.locator('.clue-panel .targets.none')).toHaveText(text.game.targetsHint);
    // Two of the group's own hidden cards, marked in this order; the other group's can't be.
    const cards = captain.locator('.board .card');
    const own = await cards.evaluateAll(
      (found, wanted) =>
        found.flatMap((card, index) =>
          card.classList.contains(wanted) && !card.classList.contains('revealed') ? [index] : [],
        ),
      team,
    );
    const targets = [own[2] as number, own[0] as number];
    const other = await cards.evaluateAll(
      (found, wanted) => found.findIndex((card) => card.classList.contains(wanted)),
      team === 'red' ? 'blue' : 'red',
    );
    await expect(cards.nth(other)).toHaveAttribute('aria-disabled', 'true');
    for (const index of targets) await cards.nth(index).click();
    await expect(cards.nth(targets[0] as number).locator('.target')).toHaveText('1');
    await expect(cards.nth(targets[1] as number).locator('.target')).toHaveText('2');
    await expect(captain.locator('.clue-panel .targets')).not.toHaveClass(/none/);
    // The number follows: two cards marked.
    await expect(captain.getByRole('radio', { name: '2' })).toHaveAttribute('aria-checked', 'true');

    await captain.getByLabel(text.game.clueInput).fill(clueFor(captain, 'Nudge'));
    await captain.getByRole('button', { name: text.game.sendClue }).click();
    await expect(guesser.locator('.guess-bar')).toBeVisible();
    // No mark stays on the PI's board once the clue is given.
    await expect(captain.locator('.board .target')).toHaveCount(0);

    // The group finds one of the cards, then reveals Reviewer 2, which ends the game.
    await chooseCard(guesser, targets[0] as number);
    await guesser.locator('.guess-bar button.primary').click();
    await expect(guesser.locator('.board .card').nth(targets[0] as number)).toHaveClass(/revealed/);
    await revealByKey(table, team, 'reviewer2');
    for (const page of [table.captains.red, table.captains.blue, table.spectator]) {
      await expect(page.locator('.letter').first()).toBeVisible();
    }

    // Nobody's snapshot held the marks before the game was over, the PI's own included.
    for (const states of table.everyone) {
      for (const state of states) {
        if (gameOf(state)?.phase !== 'over') expect(JSON.stringify(state)).not.toContain('targets');
      }
    }
    expect(gameOf(snapshotsOf(table.spectator).at(-1))?.history[0]?.targets).toEqual(targets);

    // Everyone sees them in the clue log, with how many the group found.
    const words = await Promise.all(targets.map((index) => cards.nth(index).locator('.word').textContent()));
    const log = await openLog(table.spectator);
    const meant = log.locator('.meant');
    await expect(meant).toContainText(interpolate(text.game.meantFound, { found: '1', total: '2' }));
    for (const word of words) await expect(meant).toContainText((word ?? '').replace(/\u00ad/g, ''));
    await closeSheet(table.spectator);

    // And in the replay, at the clue's step.
    const page = table.spectator;
    await page.getByRole('button', { name: text.game.review }).click();
    const replay = page.locator('.replay');
    await replay.getByRole('button', { name: text.replay.next }).click();
    await expect(replay.locator('.step')).toContainText(text.game.meant.split('{words}')[0] as string);
    const replayed = replay.locator('.board .card');
    await expect(replayed.nth(targets[0] as number).locator('.target')).toHaveText('1');
    await expect(replayed.nth(targets[1] as number).locator('.target')).toHaveText('2');
    await expect(replay.locator('.board .target')).toHaveCount(2);
  });
}

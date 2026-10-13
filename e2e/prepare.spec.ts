import { otherTeam } from '@reviewer2/shared';
import {
  chooseCard,
  clueFor,
  endTurn,
  gameOf,
  giveClue,
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

// A PI prepares the next clue while the other group is on (docs/games/keywords.md#the-clue): the
// word and the marks wait in their browser, through a reload, no snapshot anyone receives holds a
// trace of them, and when the PI's turn comes one tap gives the clue. In both languages.

for (const language of ['en', 'zh'] as const) {
  test(`a PI prepares the next clue ahead of their turn, and one tap gives it when it comes, in ${language}`, async ({
    browser,
  }) => {
    const table = await seatTable(browser, language);
    const text = TEXT[language];
    const first = await teamOnTurn(table.captains.red);
    const team = otherTeam(first);
    const captain = table.captains[team];
    const guesser = table.guessers[team];

    // While the other group's PI thinks, the button is there and the panel is folded away.
    const prepare = captain.locator('.prepare');
    const toggle = captain.locator('.prepare > button');
    await expect(toggle).toHaveText(text.game.prepare);
    await expect(captain.locator('.clue-panel')).toHaveCount(0);
    await toggle.click();
    await expect(captain.locator('.clue-panel.draft .ahead')).toHaveText(text.game.prepareNote);
    // The clue can't go yet.
    await expect(captain.getByRole('button', { name: text.game.sendClue })).toBeDisabled();

    const word = clueFor(captain, 'Lantern');
    await captain.getByLabel(text.game.clueInput).fill(word);
    // Two of the group's own hidden cards, which only the PI's board offers.
    const cards = captain.locator('.board .card');
    const own = await cards.evaluateAll(
      (found, wanted) =>
        found.flatMap((card, index) =>
          card.classList.contains(wanted) && !card.classList.contains('revealed') ? [index] : [],
        ),
      team,
    );
    const targets = [own[1] as number, own[3] as number];
    for (const index of targets) await cards.nth(index).click();
    await expect(cards.nth(targets[0] as number).locator('.target')).toHaveText('1');
    await expect(cards.nth(targets[1] as number).locator('.target')).toHaveText('2');
    await expect(captain.getByRole('radio', { name: '2' })).toHaveAttribute('aria-checked', 'true');

    // Folded away, the button says what is ready, and the marks stay on the board.
    await toggle.click();
    await expect(captain.locator('.clue-panel')).toHaveCount(0);
    const marked = interpolate(text.game.draftMarked.split(' | ')[1] as string, { count: '2' });
    const summary = interpolate(text.game.prepareDraft, {
      summary: `${interpolate(text.game.quoted, { word })}${text.game.draftJoin}${marked}`,
    });
    await expect(toggle).toHaveText(summary);
    await expect(captain.locator('.board .target')).toHaveCount(2);

    // After a reload the draft is back.
    await captain.reload();
    await expect(captain.locator('.keywords-game')).toBeVisible();
    await expect(toggle).toHaveText(summary);
    await expect(captain.locator('.board .target')).toHaveCount(2);

    // The other group plays its turn.
    await giveClue(table.captains[first], 'Hint', 1, language);
    await revealByKey(table, first);
    await endTurn(table.guessers[first], language);

    // The PI's turn comes with the panel open and the draft in it, and one tap gives the clue.
    const panel = captain.locator('form.clue-panel:not(.draft)');
    await expect(panel).toBeVisible();
    await expect(prepare).toHaveCount(0);
    await expect(panel.getByLabel(text.game.clueInput)).toHaveValue(word);
    await expect(captain.getByRole('radio', { name: '2' })).toHaveAttribute('aria-checked', 'true');
    const received = table.everyone.map((states) => states.length);
    await captain.getByRole('button', { name: text.game.sendClue }).click();
    await expect(guesser.locator('.guess-bar')).toBeVisible();
    await expect(captain.locator('.board .target')).toHaveCount(0);
    // Until then, no snapshot that anyone received held the word, the PI's own included.
    for (const [page, states] of table.everyone.entries()) {
      for (const state of states.slice(0, received[page])) expect(JSON.stringify(state)).not.toContain(word);
    }

    // The group finds one of the two cards, then reveals Reviewer 2, which ends the game.
    await chooseCard(guesser, targets[0] as number);
    await guesser.locator('.guess-bar button.primary').click();
    await expect(guesser.locator('.board .card').nth(targets[0] as number)).toHaveClass(/revealed/);
    await revealByKey(table, team, 'reviewer2');
    await expect(table.spectator.locator('.letter').first()).toBeVisible();

    // Nobody's snapshot held the marks before the game was over; the record has the clue as the
    // PI prepared it, and the clue log shows it to everyone.
    for (const states of table.everyone) {
      for (const state of states) {
        if (gameOf(state)?.phase !== 'over') expect(JSON.stringify(state)).not.toContain('targets');
      }
    }
    const record = gameOf(snapshotsOf(table.spectator).at(-1))?.history.find((clue) => clue.team === team);
    expect(record).toMatchObject({ word, count: 2, targets });
    const log = await openLog(table.spectator);
    await expect(log).toContainText(word);
    await expect(log.locator('.meant')).toContainText(interpolate(text.game.meantFound, { found: '1', total: '2' }));
  });
}

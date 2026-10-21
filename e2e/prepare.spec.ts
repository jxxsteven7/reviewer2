import { otherTeam } from '@reviewer2/shared/keywords';
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

// A PI prepares the next clue while the other group is on (docs/games/keywords.md#the-clue), in
// the panel that is always open for them: the word and the marks wait in their browser, through a
// reload, no snapshot anyone receives holds a trace of them, and when the PI's turn comes one tap
// gives the clue. In both languages.

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

    // While the other group's PI thinks, the panel is open under the board, with nothing to open
    // or fold, and the board in sight above it; until a card is marked, its first line asks for one.
    const draft = captain.locator('.clue-panel.draft');
    await expect(draft.locator('.ahead')).toHaveText(text.game.prepareNote);
    await expect(draft.locator('.targets.none')).toHaveText(`${text.game.tips} ${text.game.targetsHint}`);
    await expect(draft.locator('.targets.none')).toHaveClass(new RegExp(`\\b${team}\\b`));
    await expect(captain.locator('.prepare, [aria-expanded]')).toHaveCount(0);
    await expect(captain.locator('.board')).toBeInViewport();
    // The clue can't go yet.
    await expect(captain.getByRole('button', { name: text.game.sendClue })).toBeDisabled();
    // The numbers on offer are the PI's own group's, which has one card fewer than the group
    // that goes first, not the other group's.
    await expect(captain.locator('.clue-panel .counts button')).toHaveCount(8);

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

    // Once marked, the line counts the cards.
    const counted = (text.game.targetsMarked.split(' | ')[1] as string).split('{words}')[0] as string;
    await expect(draft.locator('.targets')).not.toHaveClass(/none/);
    await expect(draft.locator('.targets')).toContainText(interpolate(counted, { count: '2' }));

    // After a reload the draft is back, in the open panel.
    await captain.reload();
    await expect(captain.locator('.keywords-game')).toBeVisible();
    await expect(draft.getByLabel(text.game.clueInput)).toHaveValue(word);
    await expect(captain.locator('.board .target')).toHaveCount(2);

    // The other group plays its turn.
    await giveClue(table.captains[first], 'Hint', 1, language);
    await revealByKey(table, first);
    await endTurn(table.guessers[first], language);

    // The PI's turn comes with the panel open and the draft in it, and one tap gives the clue.
    const panel = captain.locator('form.clue-panel:not(.draft)');
    await expect(panel).toBeVisible();
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

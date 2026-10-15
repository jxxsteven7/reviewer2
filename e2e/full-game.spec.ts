import { otherTeam } from '@reviewer2/shared';
import {
  avatarOf,
  closeSheet,
  expectNoKey,
  gameOf,
  giveClue,
  interpolate,
  joinByLink,
  keyCard,
  newPlayer,
  playToTheEnd,
  playTurn,
  reveal,
  seatTable,
  snapshotsOf,
  teamOnTurn,
  TEXT,
  expect,
  test,
} from './helpers';

// The brief's acceptance test: four players, one per browser, play a whole game, and the
// guessers' network data never holds the colors of unrevealed cards. In both languages.

for (const language of ['en', 'zh'] as const) {
  test(`a whole game in ${language}, with the key only for the PIs`, async ({ browser, browserName }) => {
    // A whole game is 16 turns, and WebKit on a CI runner takes about 4 seconds a turn.
    test.slow(browserName === 'webkit', 'a whole game on WebKit takes about a minute');
    const table = await seatTable(browser, language);
    const text = TEXT[language];

    // Everything in the room is in its language.
    await expect(table.spectator.locator('html')).toHaveAttribute('lang', language === 'zh' ? 'zh-CN' : 'en');
    // PIs see the key, everyone else doesn't.
    await expect(table.captains.red.locator('.board .card.known')).toHaveCount(25);
    await expect(table.guessers.red.locator('.board .card.known')).toHaveCount(0);
    await expect(table.screen.locator('.board .card.known')).toHaveCount(0);

    const turns = await playToTheEnd(table);
    expect(turns).toBe(16);

    // The group that went second found its last card first, while the other group had one left: a
    // poster for the winner, and a rejection for the other group. Each group reads its own letter,
    // and the spectator and the screen read both, the winner's first.
    const winner = gameOf(snapshotsOf(table.spectator).at(-1))?.result?.winner ?? 'red';
    const loser = otherTeam(winner);
    const { verdicts } = text.game.letter;
    for (const page of [table.captains[winner], table.guessers[winner]]) {
      await expect(page.locator('.letter .verdict')).toHaveText(verdicts.poster);
    }
    for (const page of [table.captains[loser], table.guessers[loser]]) {
      await expect(page.locator('.letter .verdict')).toHaveText(verdicts.reject);
    }
    for (const page of [table.spectator, table.screen]) {
      await expect(page.locator(`.letter.${winner} .verdict`)).toHaveText(verdicts.poster);
      await expect(page.locator('.letter .verdict')).toHaveText([verdicts.poster, verdicts.reject]);
    }
    // After the end, everyone sees every color.
    await expect(table.spectator.locator('.board .card.known, .board .card.revealed')).toHaveCount(25);

    // The review of the game keeps its step through the snapshots that others cause, such as a
    // newcomer's arrival.
    const ann = table.captains.red;
    await ann.getByRole('button', { name: text.game.review }).click();
    const replay = ann.locator('.replay');
    await replay.getByRole('button', { name: text.replay.next }).click();
    const history = gameOf(snapshotsOf(ann).at(-1))?.history ?? [];
    const steps = 1 + history.reduce((count, record) => count + 1 + record.guesses.length, 0);
    const second = interpolate(text.replay.step, { step: '2', steps: String(steps) });
    await expect(replay.locator('.position')).toHaveText(second);
    const before = snapshotsOf(ann).length;
    await joinByLink(await newPlayer(browser, language), table.url, language, { watch: true });
    await expect.poll(() => snapshotsOf(ann).length).toBeGreaterThan(before);
    await expect(replay.locator('.position')).toHaveText(second);

    for (const states of table.public) {
      // Recorded to the end: the last snapshot is the letter, with every turn's clue on record,
      // and every turn brought at least one snapshot.
      const last = gameOf(states.at(-1));
      expect(last?.phase).toBe('over');
      expect(last?.history).toHaveLength(turns);
      expect(states.filter((state) => gameOf(state) !== null).length).toBeGreaterThanOrEqual(turns);
      expect(expectNoKey(states)).toBeGreaterThan(0);
    }
  });
}

// The review of a game that has ended (ReplayViewer.vue) shows the two groups' bars above the board,
// with the cards each group had still to find at the step. Every avatar in them opens the player's
// panel, whose list of the player's moves takes the review to the step of any of them.
test("the review's group bars open each player's moves, which take the review to their step", async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const text = TEXT.en;
  // The group on turn finds one of its cards; then the other group reveals Reviewer 2, which ends
  // the game in five steps: the start, two clues and two cards.
  const first = await teamOnTurn(table.captains.red);
  await playTurn(table, 1);
  const second = first === 'red' ? 'blue' : 'red';
  await giveClue(table.captains[second], 'Hint', 1, 'en');
  await reveal(table.guessers[second], await keyCard(table.captains[second], 'reviewer2'));
  const eve = table.spectator;
  await expect(eve.locator('.letter').first()).toBeVisible();

  await eve.getByRole('button', { name: text.game.review }).click();
  const replay = eve.locator('[role=dialog] .replay');
  const step = (at: number) => interpolate(text.replay.step, { step: String(at), steps: '5' });
  const left = (team: 'red' | 'blue') => replay.locator(`.scores .score.${team} > span:last-child`);
  await expect(replay.locator('.position')).toHaveText(step(1));
  // The group that went first had nine cards to find, the other eight.
  await expect(left(first)).toHaveText('9');
  await expect(left(second)).toHaveText('8');

  // The first group's student, a guest, has the avatar alone in the panel, and the one move.
  const name = table.names.guessers[first];
  await replay.locator('.scores').getByRole('button', avatarOf(name)).click();
  const panel = eve.getByRole('dialog', { name, exact: true });
  await expect(panel.locator('.avatar .initial')).toHaveAttribute('data-initial', 'G');
  await panel.getByRole('button', { name: text.replay.actions.open }).click();
  const moves = eve.getByRole('dialog', { name: interpolate(text.replay.actions.title, { name }), exact: true });
  await expect(moves.locator('.move')).toHaveCount(1);
  await expect(moves.locator('.move')).toContainText(text.replay.right);
  await moves.locator('.move').click();
  // The panel and the list close, and the review is at the card that the student revealed.
  await expect(panel).toHaveCount(0);
  await expect(moves).toHaveCount(0);
  await expect(replay.locator('.position')).toHaveText(step(3));
  await expect(left(first)).toHaveText('8');
  await expect(left(second)).toHaveText('8');

  // The other group's PI gave the clue of the fourth step.
  const pi = table.names.captains[second];
  await replay.locator('.scores').getByRole('button', avatarOf(pi)).click();
  await eve
    .getByRole('dialog', { name: pi, exact: true })
    .getByRole('button', { name: text.replay.actions.open })
    .click();
  const clues = eve.getByRole('dialog', { name: interpolate(text.replay.actions.title, { name: pi }), exact: true });
  await expect(clues.locator('.move')).toHaveCount(1);
  await clues.locator('.move').click();
  await expect(replay.locator('.position')).toHaveText(step(4));
  await closeSheet(eve);
  await expect(eve.getByRole('dialog')).toHaveCount(0);
});

import { otherTeam } from '@reviewer2/shared';
import { expectNoKey, gameOf, playToTheEnd, seatTable, snapshotsOf, TEXT, expect, test } from './helpers';

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

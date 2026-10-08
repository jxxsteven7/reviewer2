import { expectNoKey, gameOf, playToTheEnd, seatTable, TEXT, expect, test } from './helpers';

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

    for (const page of [table.captains.red, table.guessers.blue, table.spectator, table.screen]) {
      await expect(page.locator('.letter')).toBeVisible();
    }
    await expect(table.captains.red.locator('.letter .verdict')).toHaveText(text.game.letter.accepted);
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

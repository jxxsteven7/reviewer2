import { EMOTES } from '@reviewer2/shared';
import { giveClue, interpolate, keyCard, reveal, seatTable, teamOnTurn, TEXT, expect, test } from './helpers';

// Quick reactions: anyone in the room, spectators included, sends one of the phrases, and every
// page, the big screen included, shows who sent which (docs/architecture.md); but no PI while the
// students guess (docs/games/keywords.md#quick-reactions).

const text = TEXT.en;
const bubble = (name: string, phrase: string) => interpolate(text.emotes.bubble, { name, phrase });

test('a reaction reaches every page, and the sender waits before the next', async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const eve = table.spectator;
  const everyone = [
    table.captains.red,
    table.guessers.red,
    table.captains.blue,
    table.guessers.blue,
    eve,
    table.screen,
  ];

  await eve.locator('.sticky-clock').getByRole('button', { name: text.emotes.open }).click();
  // The panel offers every phrase, each on a row that a thumb can hit: 44 pixels, give or take the
  // fraction of a pixel that a desktop layout rounds away.
  const dialog = eve.locator('[role=dialog]');
  const phrases = dialog.locator('.phrase');
  await expect(phrases).toHaveText(EMOTES.map((emote) => text.emotes.phrases[emote]));
  for (const phrase of await phrases.all()) {
    const box = await phrase.boundingBox();
    expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(44);
  }
  await dialog.getByRole('button', { name: text.emotes.phrases.coauthor }).click();
  await expect(dialog).toHaveCount(0);
  for (const page of everyone) {
    await expect(page.locator('.bubble')).toHaveText(bubble(table.names.spectator, text.emotes.phrases.coauthor));
  }

  // Eve's button counts down; Bob has a wait of his own, and sends one of the newer phrases.
  await expect(eve.locator('.sticky-clock .emote-button button')).toBeDisabled();
  await expect(eve.locator('.sticky-clock .emote-button button')).toHaveText(/\(\d+\)/);
  const bob = table.guessers.red;
  await bob.locator('.sticky-clock').getByRole('button', { name: text.emotes.open }).click();
  await bob.locator('[role=dialog]').getByRole('button', { name: text.emotes.phrases.p_hacking }).click();
  await expect(table.screen.locator('.bubble').last()).toHaveText(
    bubble(table.names.guessers.red, text.emotes.phrases.p_hacking),
  );

  // After ten seconds, Eve can send another.
  await expect(eve.locator('.sticky-clock .emote-button button')).toHaveText(text.emotes.open, { timeout: 15_000 });
  await expect(eve.locator('.sticky-clock .emote-button button')).toBeEnabled();

  // The screen, which nobody has clicked, asks for a click to turn its sounds on, until someone does.
  await expect(table.screen.locator('.sound-hint')).toHaveText(text.emotes.locked);
  await table.screen.locator('.screen-game').click();
  await expect(table.screen.locator('.sound-hint')).toHaveCount(0);
});

test("a PI's reactions are held while the students guess, and come back when the turn ends", async ({ browser }) => {
  const table = await seatTable(browser, 'en');
  const team = await teamOnTurn(table.captains.red);
  const pis = [table.captains.red, table.captains.blue];
  const button = (page: (typeof pis)[number]) => page.locator('.sticky-clock .emote-button .button');
  await giveClue(table.captains[team], 'Hint', 1, 'en');
  for (const pi of pis) {
    await expect(button(pi)).toHaveAttribute('aria-disabled', 'true');
    // A tap says why, and opens nothing. Playwright waits for a button that says it is disabled to
    // be enabled; a finger doesn't, and the tap goes through.
    await button(pi).click({ force: true });
    await expect(pi.getByText(text.errors.emote_not_now)).toBeVisible();
    await expect(pi.locator('[role=dialog] .phrase')).toHaveCount(0);
  }
  for (const page of [table.guessers.red, table.guessers.blue, table.spectator]) {
    await expect(button(page)).not.toHaveAttribute('aria-disabled', 'true');
  }

  // The group finds a card of its own and ends its turn: the PIs may react again.
  const guesser = table.guessers[team];
  await reveal(guesser, await keyCard(table.captains[team], team));
  await guesser.locator('.guess-bar').getByRole('button', { name: text.game.endTurn }).click();
  await guesser.locator('[role=dialog]').getByRole('button', { name: text.game.endTurn }).click();
  for (const pi of pis) {
    await expect(button(pi)).not.toHaveAttribute('aria-disabled', 'true');
    await button(pi).click();
    await expect(pi.locator('[role=dialog] .phrase').first()).toBeVisible();
    await pi.keyboard.press('Escape');
  }
});

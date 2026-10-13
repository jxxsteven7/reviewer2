import { EMOTES } from '@reviewer2/shared';
import { interpolate, seatTable, TEXT, expect, test } from './helpers';

// Quick reactions: anyone in the room, spectators included, sends one of the phrases, and every
// page, the big screen included, shows who sent which (docs/architecture.md).

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

  await eve.locator('.role-banner').getByRole('button', { name: text.emotes.open }).click();
  // The panel offers every phrase, each on a row that a thumb can hit: 44 pixels, give or take the
  // fraction of a pixel that a desktop layout rounds away.
  const dialog = eve.locator('[role=dialog]');
  const phrases = dialog.locator('.phrase');
  await expect(phrases).toHaveText(EMOTES.map((emote) => text.emotes.phrases[emote]));
  for (const phrase of await phrases.all()) {
    const box = await phrase.boundingBox();
    expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(44);
  }
  await dialog.getByRole('button', { name: text.emotes.phrases.reviewer2 }).click();
  await expect(dialog).toHaveCount(0);
  for (const page of everyone) {
    await expect(page.locator('.bubble')).toHaveText(bubble('Eve', text.emotes.phrases.reviewer2));
  }

  // Eve's button counts down; Bob has a wait of his own, and sends one of the newer phrases.
  await expect(eve.locator('.role-banner button')).toBeDisabled();
  await expect(eve.locator('.role-banner button')).toHaveText(/\(\d+\)/);
  const bob = table.guessers.red;
  await bob.locator('.role-banner').getByRole('button', { name: text.emotes.open }).click();
  await bob.locator('[role=dialog]').getByRole('button', { name: text.emotes.phrases.p_hacking }).click();
  await expect(table.screen.locator('.bubble').last()).toHaveText(bubble('Bob', text.emotes.phrases.p_hacking));

  // After ten seconds, Eve can send another.
  await expect(eve.locator('.role-banner button')).toHaveText(text.emotes.open, { timeout: 15_000 });
  await expect(eve.locator('.role-banner button')).toBeEnabled();

  // The screen, which nobody has clicked, asks for a click to turn its sounds on, until someone does.
  await expect(table.screen.locator('.sound-hint')).toHaveText(text.emotes.locked);
  await table.screen.locator('.screen-game').click();
  await expect(table.screen.locator('.sound-hint')).toHaveCount(0);
});

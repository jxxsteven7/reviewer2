import { createRoom, expect, newPlayer, test } from './helpers';

// A sheet takes the focus as it opens, so that the keyboard and screen readers start inside it, but
// draws no focus ring around itself: the controls inside it keep theirs (UiSheet.vue).

test('a sheet opened from the keyboard takes the focus without a ring of its own', async ({ browser }) => {
  const ann = await newPlayer(browser);
  await createRoom(ann, 'en', 'Ann');

  await ann.locator('.masthead .room-button').focus();
  await ann.keyboard.press('Enter');
  const sheet = ann.locator('[role=dialog]:has(.room-menu)');
  await expect(sheet).toBeFocused();
  // The panel counts as focused from the keyboard, so the page's rule would ring it without the
  // sheet's own, which is what the check of the outline is about.
  expect(await sheet.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
  expect(await sheet.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('none');

  // The controls inside the sheet keep their ring: Tab moves the focus to its close button.
  await ann.keyboard.press('Tab');
  const close = sheet.locator('.close');
  await expect(close).toBeFocused();
  expect(await close.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
});

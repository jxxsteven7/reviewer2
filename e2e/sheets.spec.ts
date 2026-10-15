import { avatarOf, createRoom, expect, isPhone, newPlayer, openGroups, seatTable, test } from './helpers';

// A sheet takes the focus as it opens, so that the keyboard and screen readers start inside it, but
// draws no focus ring around itself: the controls inside it keep theirs. Sheets lie in the order
// they were opened, whatever their order on the page (UiSheet.vue).

test('a sheet opened from the keyboard takes the focus without a ring of its own', async ({ browser }) => {
  const ann = await newPlayer(browser);
  await createRoom(ann, 'en');

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

// The player's panel is on the page from the moment the room is entered, and the groups' sheet only
// from the start of the game, after it: by their order on the page, the groups would cover the panel
// that they open.
test("on a phone, a player's panel opened from the groups lies over them", async ({ browser }, testInfo) => {
  test.skip(!isPhone(testInfo), 'on a wide screen the groups stand beside the board');
  const table = await seatTable(browser, 'en');
  const bob = table.guessers.red;
  const name = table.names.captains.red;
  await (await openGroups(bob)).getByRole('button', avatarOf(name)).click();
  const panel = bob.getByRole('dialog', { name, exact: true });
  await expect(panel).toBeVisible();
  // A tap in the middle of the panel lands on the panel, not on the groups' sheet.
  const onTop = await panel.evaluate((dialog) => {
    const box = dialog.getBoundingClientRect();
    return dialog.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
  });
  expect(onTop, 'the panel is on top').toBe(true);
});

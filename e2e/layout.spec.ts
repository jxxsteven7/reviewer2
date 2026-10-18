import { expect, isPhone, newPlayer, register, test, TEXT } from './helpers';

// What stays in its place as the pages change (docs/design.md): the wordmark at the top of every
// page, the short home page and the long account page alike, where a browser draws its scrollbar
// in the page; and the six blocks of the record, in a line of six where it fits and in four and two
// where it doesn't, each with its number whole.
const own = (name: string) => `${name}${Math.random().toString(36).slice(2, 7)}`;

// Headless Chromium draws no scrollbars unless told, and a scrollbar is what moves a page.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test('the wordmark is in the same place on the home page, which does not scroll, and the account page, which does', async ({
  browser,
}, testInfo) => {
  test.skip(isPhone(testInfo), 'a phone draws its scrollbar over the page, which moves nothing');
  const page = await newPlayer(browser, 'en');
  await register(page, own('Ann'));
  // A window as tall as the home page and a little more, so that the home page needs no scrollbar
  // and the account page, with everything of an account on it, does.
  await page.goto('/');
  // The language gate stands on the browser's first visit to the home page.
  await expect(page.locator('.gate, .home').first()).toBeVisible();
  const gate = page.getByRole('link', { name: new RegExp(`^${TEXT.en.language.en}`) });
  if (await gate.count()) await gate.click();
  const wordmark = page.getByRole('link', { name: TEXT.en.app.name, exact: true });
  await expect(wordmark).toBeVisible();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1280, height: height + 100 });
  const scrolls = () =>
    page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight);
  expect(await scrolls()).toBe(false);
  const atHome = (await wordmark.boundingBox())?.x;
  await page.goto('/account');
  await expect(page.locator('.records')).toBeVisible();
  expect(await scrolls()).toBe(true);
  expect((await wordmark.boundingBox())?.x).toBe(atHome);
});

test('the six blocks of the record are in one line where they fit, and in four and two where they do not', async ({
  browser,
}, testInfo) => {
  const page = await newPlayer(browser, 'en');
  await register(page, own('Ann'));
  await page.goto('/account');
  const blocks = page.locator('.records .record-stats .block');
  await expect(blocks).toHaveCount(6);
  const boxes = await blocks.evaluateAll((all) =>
    all.map((block) => ({
      top: block.getBoundingClientRect().top,
      whole: block.scrollWidth <= block.clientWidth,
    })),
  );
  const tops = boxes.map(({ top }) => top);
  if (isPhone(testInfo)) {
    // The games, the rate, the matches and the matches won on the first line; the rates as a PI and
    // as a student under them.
    expect(new Set([tops[0], tops[1], tops[4], tops[5]]).size).toBe(1);
    expect(tops[2]).toBe(tops[3]);
    expect(tops[2]).toBeGreaterThan(tops[0] as number);
  } else {
    expect(new Set(tops).size).toBe(1);
  }
  expect(boxes.every(({ whole }) => whole)).toBe(true);
});

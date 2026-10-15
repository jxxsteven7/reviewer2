import type { Locator, Page } from '@playwright/test';
import {
  chooseMatch,
  expect,
  interpolate,
  isPhone,
  playToTheEnd,
  playTurn,
  register,
  seatTable,
  teamOnTurn,
  test,
  TEXT,
} from './helpers';

// The three columns of the game on a wide screen: the group chat and the groups on the left, the
// board, and the clue log with the tools on the right, a match's progress among them. Each column
// stacks from the top, with no empty space of its own, however long the clue log grows. In a
// match, every line of the table stays one line, and between the games the chair's desk and the
// rules stack in the waiting room.

const text = TEXT.en;
// One spacing between the panels of a column, and a pixel to spare.
const SPACING = 25;

// A username as long as a name may be, with a part that is the test's own, since all tests share
// one server, on which a registered name is nobody else's.
const longName = () => `Bartholomew L${Math.random().toString(36).slice(2, 5).padEnd(3, '0')}`;

// Dan takes the longest name there is: he registers it, before he joins the room.
const withLongName = (name: string) => async (page: Page, seat: string) => {
  if (seat === 'Dan') await register(page, name);
};
const asMatch = (page: Page) => chooseMatch(page, 'en', { games: 3, teams: 'fixed', grouping: 'choose' });

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error(`${String(locator)} has no box`);
  return { top: found.y, bottom: found.y + found.height, height: found.height, width: found.width };
}

// A sheet rises into place as it opens (UiSheet.vue): it is measured once it stands still.
async function settled(sheet: Locator): Promise<void> {
  await sheet.evaluate((found) =>
    Promise.all(found.getAnimations({ subtree: true }).map((animation) => animation.finished)).then(() => undefined),
  );
}

// The first panel of each column starts level with the board, and each panel follows the one
// above it, at most one spacing below.
async function expectColumnsFromTheTop(page: Page, left: string[], right: string[]): Promise<void> {
  const board = await box(page.locator('.board'));
  for (const column of [left, right]) {
    let above: number | null = null;
    for (const selector of column) {
      const panel = await box(page.locator(selector));
      if (above === null) {
        expect(Math.abs(panel.top - board.top), `${selector} starts level with the board`).toBeLessThanOrEqual(1);
      } else {
        expect(panel.top, `${selector} is below the panel above it`).toBeGreaterThanOrEqual(above);
        expect(panel.top - above, `${selector} follows the panel above it`).toBeLessThanOrEqual(SPACING);
      }
      above = panel.bottom;
    }
  }
}

// The bar under the board has no empty row where a phone has its buttons, and no row out of
// place: the first of the given parts stands at the top of the bar, and each of the others follows
// the one before it within one gap of the bar's grid.
async function expectBarStacked(page: Page, parts: string[]): Promise<void> {
  const { gap, top } = await page.locator('.actions').evaluate((bar) => {
    const style = getComputedStyle(bar);
    return { gap: parseFloat(style.rowGap), top: bar.getBoundingClientRect().top + parseFloat(style.paddingTop) };
  });
  let above = top - gap;
  for (const selector of parts) {
    const part = await box(page.locator(`.actions ${selector}`).first());
    expect(part.top, `${selector} is below the part above it`).toBeGreaterThanOrEqual(above);
    expect(part.top - above, `${selector} follows the part above it`).toBeLessThanOrEqual(gap + 1);
    above = part.bottom;
  }
}

test('the chat, the groups, the clue log and the tools stand at the top of their columns, however long the log', async ({
  browser,
}, testInfo) => {
  test.skip(isPhone(testInfo), 'on a phone the groups and the log are sheets');
  const table = await seatTable(browser, 'en');
  const student = table.guessers.red;
  const spectator = table.spectator;
  for (let turn = 1; turn <= 4; turn += 1) await playTurn(table, turn);
  await expect(student.locator('.clue-log li')).toHaveCount(4);
  await expectColumnsFromTheTop(student, ['.chat-panel', '.rosters'], ['.clue-log', '.tools']);
  await expectBarStacked(student, ['.status', '.gestures']);
  // A spectator has no chat: the groups stand at the top.
  await expectColumnsFromTheTop(spectator, ['.rosters'], ['.clue-log', '.tools']);
  await expectBarStacked(spectator, ['.status']);
  // The PI whose turn it isn't prepares the next clue in the panel that is always open: it has its
  // row under the status line, as on a phone.
  const pi = table.captains[(await teamOnTurn(student)) === 'red' ? 'blue' : 'red'];
  await expect(pi.locator('.clue-panel.draft')).toBeVisible();
  await expect(pi.locator('.prepare')).toHaveCount(0);
  await expectBarStacked(pi, ['.status', '.clue-panel.draft']);

  // At the end, the log is longer than the groups by far, and nothing moves down.
  await playToTheEnd(table, 4);
  await expect(student.locator('.clue-log li')).toHaveCount(16);
  await expect(student.locator('.letter').first()).toBeVisible();
  await expectColumnsFromTheTop(student, ['.chat-panel', '.rosters'], ['.clue-log', '.tools']);
  await expectColumnsFromTheTop(spectator, ['.rosters'], ['.clue-log', '.tools']);
});

test("in a match, the tools open the table with each line on one line, and the chair's desk and the rules stack between the games", async ({
  browser,
}, testInfo) => {
  test.skip(isPhone(testInfo), 'on a wide screen only');
  const name = longName();
  const table = await seatTable(browser, 'en', withLongName(name), asMatch);
  for (let turn = 1; turn <= 4; turn += 1) await playTurn(table, turn);

  // The match's progress is a button among the tools, and the columns stand at the top beside the
  // board.
  const student = table.guessers.red;
  await expect(student.locator('.match-table')).toHaveCount(0);
  await expectColumnsFromTheTop(student, ['.chat-panel', '.rosters'], ['.clue-log', '.tools']);
  // The chair's button to end the match stays in sight among the tools, not in the sheet.
  const chair = table.captains.red;
  await expect(chair.locator('.tools').getByRole('button', { name: text.match.end })).toBeVisible();
  await chair.locator('.tools').getByRole('button', { name: text.match.progressTitle }).click();
  const chairs = chair.getByRole('dialog', { name: text.match.progressTitle });
  await expect(chairs.locator('.match-table')).toBeVisible();
  await expect(chairs.locator('.end-match')).toHaveCount(0);

  // The button opens the table in a sheet, where every line keeps its avatar, name and marks on one
  // line, with the numbers beside them.
  await student.locator('.tools').getByRole('button', { name: text.match.progressTitle }).click();
  const sheet = student.getByRole('dialog', { name: text.match.progressTitle });
  await expect(sheet.locator('.match-table')).toContainText(
    interpolate(text.match.progress, { game: '1', games: '3' }),
  );
  await expect(sheet.locator('tbody .name', { hasText: name })).toHaveAttribute('title', name);
  await settled(sheet);
  const rows = await sheet.locator('tbody tr').all();
  expect(rows).toHaveLength(4);
  for (const row of rows) {
    const line = await box(row.locator('.name-line'));
    const name = await box(row.locator('.name'));
    const avatar = await box(row.locator('.avatar'));
    expect(line.height).toBeLessThanOrEqual(40);
    expect(name.height).toBeLessThanOrEqual(26);
    expect(Math.abs(avatar.top + avatar.height / 2 - (name.top + name.height / 2))).toBeLessThanOrEqual(4);
    for (const cell of ['.total', '.delta']) expect((await box(row.locator(cell))).width).toBeGreaterThanOrEqual(32);
  }

  // Between the games, the chair's desk stands above the rules, and the start button above both,
  // in the start bar.
  await student.keyboard.press('Escape');
  await chair.keyboard.press('Escape');
  await playToTheEnd(table, 4);
  await chair.getByRole('button', { name: text.match.next }).click();
  await expect(chair.locator('.lobby .desk')).toBeVisible();
  await expect(chair.locator('.lobby .rules')).toBeVisible();
  const desk = await box(chair.locator('.desk'));
  const rules = await box(chair.locator('.rules'));
  expect(rules.top).toBeGreaterThanOrEqual(desk.bottom);
  expect(rules.top - desk.bottom).toBeLessThanOrEqual(SPACING);
  await expect(chair.locator('.start-bar').getByRole('button', { name: text.lobby.start })).toBeVisible();
  expect((await box(chair.locator('.start-bar'))).bottom).toBeLessThanOrEqual(desk.top);
  await expect(chair.locator('.desk').getByRole('button', { name: text.lobby.start })).toHaveCount(0);
});

// On a phone as narrow as 320 px the table in its sheet keeps the headings that show apart, and
// each line stays one line, the long name cut short.
test.describe('on a 320 px phone', () => {
  test.use({ viewport: { width: 320, height: 700 } });

  test("the match's table keeps its headings apart and its lines on one line", async ({ browser }, testInfo) => {
    test.skip(!isPhone(testInfo), 'the sheet is the same at every width, but a phone is where it gets narrow');
    const name = longName();
    const table = await seatTable(browser, 'en', withLongName(name), asMatch);
    await playTurn(table, 1);

    const student = table.guessers.red;
    await student.locator('.panels').getByRole('button', { name: text.game.buttons.match }).click();
    const sheet = student.getByRole('dialog', { name: text.match.progressTitle });
    await expect(sheet.locator('.match-table')).toBeVisible();
    await settled(sheet);
    // The rank and the player are headings for a screen reader alone; the text of each heading that
    // shows, where it is, ends before the next one begins.
    await expect(sheet.locator('th .sr-only')).toHaveText([text.match.rank, text.match.player]);
    const headings = await sheet.locator('th:not(:has(.sr-only))').evaluateAll((cells) =>
      cells.map((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        const rect = range.getBoundingClientRect();
        return { text: cell.textContent?.trim() ?? '', left: rect.left, right: rect.right };
      }),
    );
    expect(headings.map((heading) => heading.text)).toEqual([text.match.total, text.match.deltaShort]);
    for (let index = 1; index < headings.length; index += 1) {
      const before = headings[index - 1] as { text: string; right: number };
      const heading = headings[index] as { text: string; left: number };
      expect(
        heading.left - before.right,
        `"${heading.text}" stands apart from "${before.text}"`,
      ).toBeGreaterThanOrEqual(4);
    }
    for (const row of await sheet.locator('tbody tr').all()) {
      expect((await box(row.locator('.name-line'))).height).toBeLessThanOrEqual(40);
      expect((await box(row.locator('.name'))).height).toBeLessThanOrEqual(26);
    }
    await expect(sheet.locator('tbody .name', { hasText: name })).toHaveAttribute('title', name);
  });
});

import type { Locator, Page } from '@playwright/test';
import {
  chooseMatch,
  expect,
  interpolate,
  isPhone,
  playToTheEnd,
  playTurn,
  seatTable,
  sideChannel,
  test,
  TEXT,
} from './helpers';

// The three columns of the game on a wide screen: the group chat and the groups on the left, the
// board with a match's folded table under it, and the clue log with the tools on the right. Each
// column stacks from the top, with no empty space of its own, however long the clue log grows. In
// a match, every line of the table stays one line, and between the games the chair's desk and the
// rules stack in the waiting room.

const text = TEXT.en;
// One spacing between the panels of a column, and a pixel to spare.
const SPACING = 25;

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error(`${String(locator)} has no box`);
  return { top: found.y, bottom: found.y + found.height, height: found.height, width: found.width };
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
  // A spectator has no chat: the groups stand at the top.
  await expectColumnsFromTheTop(spectator, ['.rosters'], ['.clue-log', '.tools']);

  // At the end, the log is longer than the groups by far, and nothing moves down.
  await playToTheEnd(table, 4);
  await expect(student.locator('.clue-log li')).toHaveCount(16);
  await expect(student.locator('.letter').first()).toBeVisible();
  await expectColumnsFromTheTop(student, ['.chat-panel', '.rosters'], ['.clue-log', '.tools']);
  await expectColumnsFromTheTop(spectator, ['.rosters'], ['.clue-log', '.tools']);
});

test("in a match, the table folds under the board with each line on one line, and the chair's desk and the rules stack between the games", async ({
  browser,
}, testInfo) => {
  test.skip(isPhone(testInfo), 'on a wide screen only');
  const table = await seatTable(browser, 'en', undefined, (page) =>
    chooseMatch(page, 'en', { games: 3, teams: 'fixed', grouping: 'choose' }),
  );
  // Dan takes the longest name there is.
  const tab = await sideChannel(table.guessers.blue, table.url);
  expect(await tab.send('room:rename', { name: 'Bartholomew Long' })).toMatchObject({ ok: true });
  for (let turn = 1; turn <= 4; turn += 1) await playTurn(table, turn);

  // The table is folded under the bar below the board, to a line with the match's progress, and
  // the columns stand at the top beside it.
  const student = table.guessers.red;
  const fold = student.locator('.match-fold');
  await expect(fold.locator('summary')).toContainText(text.match.progressTitle);
  await expect(fold.locator('summary')).toContainText(interpolate(text.match.progress, { game: '1', games: '3' }));
  await expect(fold.locator('.match-table')).toBeHidden();
  expect((await box(fold)).top).toBeGreaterThanOrEqual((await box(student.locator('.actions'))).bottom);
  await expectColumnsFromTheTop(student, ['.chat-panel', '.rosters'], ['.clue-log', '.tools']);

  // Opened, every line keeps its avatar, name and marks on one line, with the numbers beside them.
  await fold.locator('summary').click();
  await expect(fold.locator('.match-table')).toBeVisible();
  await expect(fold.locator('tbody .name', { hasText: 'Bartholomew Long' })).toHaveAttribute(
    'title',
    'Bartholomew Long',
  );
  const rows = await fold.locator('tbody tr').all();
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

  // Between the games, the chair's desk, with the start button, stands above the rules.
  await playToTheEnd(table, 4);
  const chair = table.captains.red;
  await chair.getByRole('button', { name: text.match.next }).click();
  await expect(chair.locator('.lobby .desk')).toBeVisible();
  await expect(chair.locator('.lobby .rules')).toBeVisible();
  const desk = await box(chair.locator('.desk'));
  const rules = await box(chair.locator('.rules'));
  expect(rules.top).toBeGreaterThanOrEqual(desk.bottom);
  expect(rules.top - desk.bottom).toBeLessThanOrEqual(SPACING);
  await expect(chair.locator('.desk').getByRole('button', { name: text.lobby.start })).toBeVisible();
});

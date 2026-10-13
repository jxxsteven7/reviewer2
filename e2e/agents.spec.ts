import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
  closeSheet,
  createRoom,
  expect,
  gameOf,
  interpolate,
  joinByLink,
  keyCard,
  newPlayer,
  openGroups,
  register,
  reveal,
  sit,
  snapshotsOf,
  teamOnTurn,
  TEXT,
  test,
} from './helpers';

// AI players end to end, through the real agent with a model that answers by rule (e2e/model.mjs):
// the operator lets an account have them, its chair invites Reviewer 1 as the red group's PI and
// student, who play their turn against two people, and when the chair goes offline in her turn as
// the blue PI, an AI gives the clue for her, which everyone sees, until she is back. The operator's
// command runs on the server's data directory, as in public-rooms.spec.ts.
const own = (name: string) => `${name}${Math.random().toString(36).slice(2, 7)}`;
const dataDir = process.env.E2E_DATA_DIR as string;
const modelUrl = `http://127.0.0.1:${Number(process.env.E2E_PORT) + 1}`;

const admin = (...args: string[]): string =>
  spawnSync(process.execPath, [join(import.meta.dirname, '..', 'server', 'dist', 'admin.cjs'), ...args], {
    env: { ...process.env, DATA_DIR: dataDir },
    encoding: 'utf8',
  }).stdout.trim();

const records = (page: Page) => gameOf(snapshotsOf(page).at(-1))?.history ?? [];

test('Reviewer 1 plays a group, and gives the clue of a PI who is offline until she is back', async ({ browser }) => {
  test.setTimeout(120_000);
  const text = TEXT.en;
  const reviewer = text.agents.personas.reviewer1;
  const invite = interpolate(text.lobby.inviteAgent, { name: reviewer });
  const annName = own('Ann');
  let ann = await newPlayer(browser, 'en');
  snapshotsOf(ann);
  await register(ann, annName);
  expect(admin('agents', 'allow', annName)).toBe(`${annName} may invite AI players to the private rooms they chair.`);
  const url = await createRoom(ann, 'en', '');

  // Ann invites Reviewer 1 as the red PI and a red student, and reads what AI players mean.
  const red = ann.locator('.group.red');
  await expect(ann.locator('.lobby')).toContainText(text.lobby.agentNote);
  await red.locator('.seat-line').getByRole('button', { name: invite }).click();
  await expect(red.locator('.seat-line').getByText(text.room.agent, { exact: true })).toBeVisible();
  await expect(red.locator('.seat-line .name')).toHaveText(reviewer);
  await red.getByRole('button', { name: invite }).click();
  await expect(red.getByText(text.room.agent, { exact: true })).toHaveCount(2);
  await expect(red.getByRole('button', { name: invite })).toHaveCount(0);

  const bob = await newPlayer(browser, 'en');
  snapshotsOf(bob);
  await joinByLink(bob, url, 'Bob', 'en');
  await Promise.all([sit(ann, 'blue', 'captain', 'en'), sit(bob, 'blue', 'guesser', 'en')]);
  await expect(ann.locator('.start-bar .ready')).toBeVisible();
  await ann.getByRole('button', { name: text.lobby.start }).click();
  await expect(bob.locator('.keywords-game')).toBeVisible();

  // The red turn: the AI PI gives its clue, and the AI student reveals the red card that the test
  // tells the model of, read off Ann's key, then ends the turn.
  async function redTurn() {
    const card = await keyCard(ann, 'red');
    const word = gameOf(snapshotsOf(ann).at(-1))?.cards[card]?.word;
    await fetch(`${modelUrl}/e2e/picks`, { method: 'POST', body: JSON.stringify({ word }) });
    await expect.poll(() => records(bob).some(({ team, word }) => team === 'red' && word !== null)).toBe(true);
    await expect(bob.locator('.board .card').nth(card)).toHaveClass(/revealed/);
    await expect.poll(() => teamOnTurn(bob)).toBe('blue');
  }

  // Ann goes offline in her turn as the blue PI. After 20 seconds an AI gives the clue for her, and
  // Bob's list of the groups says that it plays for her; when she is back, it no longer does.
  async function blueTurnWithoutAnn() {
    const context = ann.context();
    await ann.close();
    await expect
      .poll(
        () =>
          snapshotsOf(bob)
            .at(-1)
            ?.players.find(({ name }) => name === annName)?.takenOver,
        { timeout: 30_000 },
      )
      .toBe(true);
    const groups = await openGroups(bob);
    await expect(groups.locator('.player', { hasText: annName })).toContainText(text.room.takenOver);
    await closeSheet(bob);
    await expect.poll(() => records(bob).some(({ team, word }) => team === 'blue' && word !== null)).toBe(true);
    ann = await context.newPage();
    snapshotsOf(ann);
    await ann.goto(url);
    await expect(ann.locator('.keywords-game')).toBeVisible();
    await expect
      .poll(
        () =>
          snapshotsOf(bob)
            .at(-1)
            ?.players.find(({ name }) => name === annName)?.takenOver,
      )
      .toBeUndefined();
    // Bob ends the turn on a paper of nobody's.
    await reveal(bob, await keyCard(ann, 'neutral'));
  }

  if ((await teamOnTurn(bob)) === 'blue') {
    await blueTurnWithoutAnn();
    await redTurn();
  } else {
    await redTurn();
    await blueTurnWithoutAnn();
  }
  // A student, Bob never had the key.
  for (const state of snapshotsOf(bob)) {
    const game = gameOf(state);
    if (!game || game.phase === 'over') continue;
    for (const card of game.cards) if (!card.revealed) expect(card).not.toHaveProperty('color');
  }
});

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import {
  closeSheet,
  createRoom,
  expect,
  gameOf,
  giveClue,
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
// the blue PI, an AI gives the clue for her, which everyone sees, until she is back. Beside a
// person of its group, the AI student only advises. The operator's command runs on the server's
// data directory, as in public-rooms.spec.ts.
const own = (name: string) => `${name}${Math.random().toString(36).slice(2, 7)}`;
const dataDir = process.env.E2E_DATA_DIR as string;
const modelUrl = `http://127.0.0.1:${Number(process.env.E2E_PORT) + 1}`;
const text = TEXT.en;
const reviewer = text.agents.personas.reviewer1;
const invite = interpolate(text.lobby.inviteAgent, { name: reviewer });

const admin = (...args: string[]): string =>
  spawnSync(process.execPath, [join(import.meta.dirname, '..', 'server', 'dist', 'admin.cjs'), ...args], {
    env: { ...process.env, DATA_DIR: dataDir },
    encoding: 'utf8',
  }).stdout.trim();

const records = (page: Page) => gameOf(snapshotsOf(page).at(-1))?.history ?? [];
const card = (page: Page, index: number) => page.locator('.board .card').nth(index);

// The group's chat: on a wide screen the panel beside the board, which is open all the time; on a
// phone the sheet, opened from the button under the board.
async function chatOf(page: Page): Promise<Locator> {
  const button = page.locator('.open-chat');
  if (await button.count()) await button.click();
  const chat = page.locator('.chat');
  await expect(chat).toBeVisible();
  return chat;
}

// Tells the model of the tests which card a student is to name next, by its word, as the PI's key
// shows it, and by the words of the board it is on.
async function tellModel(captain: Page, color: 'red' | 'blue' | 'neutral'): Promise<number> {
  const index = await keyCard(captain, color);
  const cards = gameOf(snapshotsOf(captain).at(-1))?.cards ?? [];
  const body = JSON.stringify({ word: cards[index]?.word, board: cards.map((card) => card.word) });
  await fetch(`${modelUrl}/e2e/picks`, { method: 'POST', body });
  return index;
}

// A chair with an account that the operator lets have AI players, in a new room.
async function chairWithAgents(browser: Parameters<typeof newPlayer>[0]) {
  const name = own('Ann');
  const ann = await newPlayer(browser, 'en');
  snapshotsOf(ann);
  await register(ann, name);
  expect(admin('agents', 'allow', name)).toBe(`${name} may invite AI players to the private rooms they chair.`);
  const url = await createRoom(ann, 'en', '');
  return { ann, name, url };
}

test('Reviewer 1 plays a group, and gives the clue of a PI who is offline until she is back', async ({ browser }) => {
  test.setTimeout(120_000);
  const chaired = await chairWithAgents(browser);
  const { name: annName, url } = chaired;
  let { ann } = chaired;

  // Ann, the blue PI, invites Reviewer 1 as the red PI and a red student, and reads what AI players
  // mean.
  const red = ann.locator('.group.red');
  await sit(ann, 'blue', 'captain', 'en');
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
  await sit(bob, 'blue', 'guesser', 'en');
  await expect(ann.locator('.start-bar .ready')).toBeVisible();
  await ann.getByRole('button', { name: text.lobby.start }).click();
  await expect(bob.locator('.keywords-game')).toBeVisible();

  // The red turn: the AI PI gives its clue, and the AI student reveals the red card that the test
  // tells the model of, read off Ann's key, then ends the turn.
  async function redTurn() {
    const index = await tellModel(ann, 'red');
    await expect.poll(() => records(bob).some(({ team, word }) => team === 'red' && word !== null)).toBe(true);
    await expect(card(bob, index)).toHaveClass(/revealed/);
    await expect.poll(() => teamOnTurn(bob)).toBe('blue');
  }

  // Ann goes offline in her turn as the blue PI. After 20 seconds an AI gives the clue for her, and
  // Bob's list of the groups says that it plays for her, until she is back; when she is back, it no
  // longer does.
  async function blueTurnWithoutAnn() {
    const context = ann.context();
    await ann.close();
    await expect
      .poll(() => records(bob).some(({ team, word }) => team === 'blue' && word !== null), { timeout: 40_000 })
      .toBe(true);
    expect(
      snapshotsOf(bob)
        .at(-1)
        ?.players.find(({ name }) => name === annName)?.takenOver,
    ).toBe(true);
    const groups = await openGroups(bob);
    await expect(groups.locator('.player', { hasText: annName })).toContainText(text.room.takenOver);
    await closeSheet(bob);
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

test('Reviewer 1 advises a student of its group, who reveals the cards', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ann, url } = await chairWithAgents(browser);
  await sit(ann, 'blue', 'captain', 'en');
  const red = ann.locator('.group.red');
  await red.locator('.seat-line').getByRole('button', { name: invite }).click();
  await expect(red.locator('.seat-line').getByText(text.room.agent, { exact: true })).toBeVisible();
  await red.getByRole('button', { name: invite }).click();
  await expect(red.getByText(text.room.agent, { exact: true })).toHaveCount(2);

  // Bob is a red student beside the AI student; Cat is the blue student.
  const bob = await newPlayer(browser, 'en');
  snapshotsOf(bob);
  await joinByLink(bob, url, 'Bob', 'en');
  await sit(bob, 'red', 'guesser', 'en');
  const cat = await newPlayer(browser, 'en');
  snapshotsOf(cat);
  await joinByLink(cat, url, 'Cat', 'en');
  await sit(cat, 'blue', 'guesser', 'en');
  await expect(ann.locator('.start-bar .ready')).toBeVisible();
  await ann.getByRole('button', { name: text.lobby.start }).click();
  await expect(bob.locator('.keywords-game')).toBeVisible();

  if ((await teamOnTurn(bob)) === 'blue') {
    await giveClue(ann, 'Hint', 1, 'en');
    await reveal(cat, await keyCard(ann, 'neutral'));
    await expect.poll(() => teamOnTurn(bob)).toBe('red');
  }
  // The AI PI gives the clue; the AI student chooses the card that the test tells the model of, for
  // Bob to see, says why in the group's chat, and reveals nothing.
  const index = await tellModel(ann, 'red');
  await expect.poll(() => records(bob).some(({ team, word }) => team === 'red' && word !== null)).toBe(true);
  await expect(card(bob, index)).toHaveAttribute('aria-label', new RegExp(`, chosen by ${reviewer}$`));
  const chat = await chatOf(bob);
  await expect(chat.locator('.message .name')).toHaveText(reviewer);
  await expect(chat.locator('.message .text')).toHaveText('It fits the clue.');
  await closeSheet(bob);
  await expect(card(bob, index)).not.toHaveClass(/revealed/);
  expect(records(bob).find(({ team }) => team === 'red')?.guesses).toEqual([]);
  // Bob reveals it himself.
  await reveal(bob, index);
  await expect.poll(() => records(bob).find(({ team }) => team === 'red')?.guesses.length).toBe(1);
  for (const state of snapshotsOf(bob)) {
    const game = gameOf(state);
    if (!game || game.phase === 'over') continue;
    for (const card of game.cards) if (!card.revealed) expect(card).not.toHaveProperty('color');
  }
});

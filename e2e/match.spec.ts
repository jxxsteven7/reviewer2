import type { Page } from '@playwright/test';
import type { KeywordsRoomData, MatchRules, Seat, Team } from '@reviewer2/shared';
import {
  chooseCard,
  createRoom,
  endTurn,
  expect,
  giveClue,
  interpolate,
  joinByLink,
  keyCard,
  newPlayer,
  register,
  reveal,
  seatTable,
  snapshotsOf,
  teamOnTurn,
  TEXT,
  test,
  type Language,
} from './helpers';

// Matches end to end: players with accounts and guests play a whole match whose groups are drawn
// for every game, see the ranking with its titles, and find the match on their accounts; a match
// whose groups stay the same keeps them from one game to the next; and an ordinary room plays as it
// always did.
//
// All tests share one server, on which a registered name is nobody else's, so every account here
// has a part that is the test's own.
const own = (name: string) => `${name}${Math.random().toString(36).slice(2, 7)}`;

// Makes the room a match on the room setup.
async function chooseMatch(page: Page, language: Language, rules: MatchRules): Promise<void> {
  const text = TEXT[language];
  await page.getByRole('radio', { name: new RegExp(`^${text.match.match}`) }).check();
  const form = page.locator('.match-form');
  await form.getByLabel(text.match.games).fill(String(rules.games));
  await form.getByLabel(text.match.teamsChoice[rules.teams], { exact: true }).check();
  await form.getByLabel(text.match.groupingChoice[rules.grouping], { exact: true }).check();
}

// Where a page's player sits, as its latest snapshot says.
function seatOf(page: Page): Seat {
  const state = snapshotsOf(page).at(-1);
  const seat = state?.me ? (state.data as KeywordsRoomData).seats[state.me] : undefined;
  return seat ?? { team: null, role: 'spectator' };
}

const seated = (pages: Page[], team: Team, role: 'captain' | 'guesser') => {
  const page = pages.find((candidate) => {
    const seat = seatOf(candidate);
    return seat.team === team && seat.role === role;
  });
  if (!page) throw new Error(`nobody is the ${team} ${role}`);
  return page;
};

// Ends a game in one or two turns, so that `favoured`'s group wins: if it is on turn, its student
// reveals one of the group's own cards and ends the turn, since an irrelevant paper would cost the
// student a point and leave the group unequal; then the other group's student reveals Reviewer 2.
// So everyone in the favoured group scores 3, or 4 when it was on turn, and the other group's
// student loses 3.
async function playQuickly(pages: Page[], language: Language, favoured: Page): Promise<void> {
  const [first] = pages as [Page];
  const ours = seatOf(favoured).team;
  let team = await teamOnTurn(first);
  if (team === ours) {
    const captain = seated(pages, team, 'captain');
    await giveClue(captain, 'Hint', 1, language);
    const guesser = seated(pages, team, 'guesser');
    await reveal(guesser, await keyCard(captain, team));
    await endTurn(guesser, language);
    await expect(first.locator(`.strip:not(.${team})`)).toBeVisible();
    team = await teamOnTurn(first);
  }
  const captain = seated(pages, team, 'captain');
  await giveClue(captain, 'Hint', 1, language);
  const guesser = seated(pages, team, 'guesser');
  await chooseCard(guesser, await keyCard(captain, 'reviewer2'));
  await guesser.locator('.guess-bar button.primary').click();
  for (const page of pages) await expect(page.locator('.letter').first()).toBeVisible();
}

test('players with accounts and guests play a whole match, and find its title on their accounts', async ({
  browser,
}) => {
  const text = TEXT.en;
  const names = { Ann: own('Ann'), Bob: own('Bob') };
  const ann = await newPlayer(browser, 'en');
  snapshotsOf(ann);
  await register(ann, names.Ann);
  const url = await createRoom(ann, 'en', '', (page) =>
    chooseMatch(page, 'en', { games: 2, teams: 'switch', grouping: 'random' }),
  );
  const join = async (name: string, account?: string) => {
    const page = await newPlayer(browser, 'en');
    snapshotsOf(page);
    if (account) await register(page, account);
    await joinByLink(page, url, name, 'en');
    return page;
  };
  const [bob, cat, dan] = await Promise.all([join('Bob', names.Bob), join('Cat'), join('Dan')]);
  const pages = [ann, bob, cat, dan];

  // The groups are drawn when the game starts: the waiting room lists everyone who plays.
  await expect(ann.locator('.pool')).toContainText('Dan');
  await expect(ann.locator('.match-table')).toContainText(interpolate(text.match.progress, { game: '1', games: '2' }));
  await ann.getByRole('button', { name: text.lobby.start }).click();
  for (const page of pages) await expect(page.locator('.keywords-game')).toBeVisible();
  await expect(ann.locator('.side .match-table')).toBeVisible();

  await playQuickly(pages, 'en', ann);
  // Between the games: everyone's points in this game, under the letters.
  const between = cat.locator('.match-table.between');
  await expect(between).toContainText(text.match.delta);
  await expect(between.locator('tbody tr')).toHaveCount(4);
  await expect(between.locator('tbody tr').first()).toContainText(/\+[34]/);
  await expect(cat.getByText(text.match.waitNext)).toBeVisible();
  await ann.getByRole('button', { name: text.match.next }).click();
  await expect(ann.locator('.lobby .match-table')).toContainText(
    interpolate(text.match.progress, { game: '2', games: '2' }),
  );
  await ann.getByRole('button', { name: text.lobby.start }).click();
  for (const page of pages) await expect(page.locator('.keywords-game')).toBeVisible();

  await playQuickly(pages, 'en', ann);
  // The ranking: Ann's group won both games, so she has the Best Paper Award, and whoever lost the
  // most is the game's black hole.
  for (const page of pages) await expect(page.locator('.match-results h2')).toHaveText(text.match.over);
  const results = dan.locator('.match-results');
  await expect(results.locator('li').first()).toContainText(text.match.titleNames.best_paper);
  await expect(results.locator('li.best_paper', { hasText: names.Ann })).toHaveCount(1);
  await expect(results.locator('li.black_hole').first()).toContainText(text.match.blackHoleLine);
  await expect(dan.getByText(text.match.waitAgain)).toBeVisible();
  await expect(ann.getByRole('button', { name: text.match.again })).toBeVisible();

  // The accounts keep the match, and Ann's title.
  await ann.goto('/account');
  await expect(ann.locator('.titles')).toHaveText(text.account.profile.titleNames.best_paper);
  await expect(ann.locator('.records')).toContainText(interpolate(text.account.profile.matchSummary, { played: '1' }));
  const match = ann.locator('.records .match');
  await expect(match).toHaveCount(1);
  await expect(match).toContainText(text.match.titleNames.best_paper);
  await expect(match).toContainText(interpolate(text.account.profile.matchGames, { games: '2' }));
  await expect(match).toContainText(/Place 1 of 4/);
  await bob.goto('/account');
  await expect(bob.locator('.records .match')).toHaveCount(1);
});

test('a match whose groups stay the same keeps them, and passes the PI on', async ({ browser }) => {
  const text = TEXT.zh;
  const table = await seatTable(browser, 'zh', undefined, (page) =>
    chooseMatch(page, 'zh', { games: 2, teams: 'fixed', grouping: 'choose' }),
  );
  const ann = table.captains.red;
  const players = [ann, table.guessers.red, table.captains.blue, table.guessers.blue];
  const pages = [...players, table.spectator];
  const teams = () => players.map((page) => seatOf(page).team);
  const before = teams();
  expect(before).toEqual(['red', 'red', 'blue', 'blue']);

  await playQuickly(pages, 'zh', ann);
  await ann.getByRole('button', { name: text.match.next }).click();
  for (const page of players) await expect(page.locator('.lobby')).toBeVisible();
  // Everyone is in the same group, and each group's PI is the one who hasn't been one yet.
  await expect
    .poll(() => players.map((page) => seatOf(page).role))
    .toEqual(['guesser', 'captain', 'guesser', 'captain']);
  expect(teams()).toEqual(before);
  await expect(ann.locator('.footnote')).toHaveText(text.match.fixedNote);
  // Nobody is offered a seat in the other group.
  for (const label of [text.lobby.joinAsGuesser, text.lobby.takeCaptain]) {
    await expect(ann.locator('.group.blue').getByRole('button', { name: label })).toHaveCount(0);
  }
  await expect(ann.locator('.desk')).toContainText(text.match.locked);

  await expect(ann.locator('.desk .ready')).toBeVisible();
  await ann.getByRole('button', { name: text.lobby.start }).click();
  for (const page of pages) await expect(page.locator('.keywords-game')).toBeVisible();
  expect(teams()).toEqual(before);
  await playQuickly(pages, 'zh', ann);
  for (const page of pages) await expect(page.locator('.match-results h2')).toHaveText(text.match.over);
  // Red won both games.
  await expect(table.spectator.locator('.match-results li.best_paper')).toHaveCount(2);

  // Back to an ordinary room.
  await ann.getByRole('button', { name: text.match.ordinaryRoom }).click();
  await expect(ann.locator('.lobby')).toBeVisible();
  await expect(ann.locator('.match-table, .match-results')).toHaveCount(0);
  await expect(ann.getByRole('button', { name: text.lobby.shuffle })).toBeVisible();
});

test('an ordinary room plays as it always did', async ({ browser }) => {
  const text = TEXT.en;
  const table = await seatTable(browser, 'en');
  const ann = table.captains.red;
  const pages = [ann, table.guessers.red, table.captains.blue, table.guessers.blue, table.spectator];
  await expect(ann.locator('.match-table')).toHaveCount(0);
  await playQuickly(pages, 'en', ann);
  await expect(ann.locator('.match-table, .match-results')).toHaveCount(0);
  expect(snapshotsOf(ann).every((state) => state.match === null)).toBe(true);
  await ann.getByRole('button', { name: text.game.letter.again }).click();
  await expect(ann.locator('.lobby')).toBeVisible();
});

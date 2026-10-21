import type { MatchView, RecordsView } from '@reviewer2/shared';
import type {
  KeywordsMatchOptions,
  KeywordsMatchRules,
  KeywordsRoomData,
  KeywordsView,
  Team,
} from '@reviewer2/shared/keywords';
import { afterEach, describe, expect, test } from 'vitest';
import type { GameLogData } from '../src/core/gameLog';
import { keywordsGame } from '../src/games/keywords';
import { checkData } from '../src/store/check';
import { countGames, countMatches } from '../src/store/recount';
import {
  Browser,
  createRoom,
  joinRoom,
  loggedIn as registered,
  startServer,
  TestClient,
  until,
  type Reply,
  type TestServer,
} from './helpers';
import { keepGame } from './keptGame';

// Matches over real sockets: whole matches of the team word guessing game, the chair's controls,
// players who come and go, and what accounts keep of a match. The scoring itself is tested in
// src/games/keywords/match.test.ts, and the ranking in src/core/match.test.ts.

let server: TestServer;
const clients: TestClient[] = [];
// Who the players are in a test, by the names that the room gives them: a guest is "Guest" and
// their number there, and a player with an account goes by the username.
const people = new Map<string, string>();

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  people.clear();
  await server.close();
});

const track = (client: TestClient) => {
  clients.push(client);
  return client;
};

const data = (client: TestClient) => client.state?.data as KeywordsRoomData;
const board = (client: TestClient) => data(client).game as KeywordsView;
const matchOf = (client: TestClient) => client.state?.match as MatchView;
const logOf = (gameId: string) =>
  JSON.parse(
    (server.db.prepare('SELECT log FROM replays WHERE game_id = ?').get(gameId) as { log: string }).log,
  ) as GameLogData;
const moment = (view: KeywordsView) => ({ gameId: view.gameId, turn: view.turn });

async function expectOk(reply: Promise<Reply>) {
  expect(await reply).toEqual({ ok: true });
}

// Waits until every client has the newest snapshot that any of them has.
async function settle(everyone: TestClient[]) {
  const rev = Math.max(...everyone.map((client) => client.state?.rev ?? 0));
  for (const client of everyone) await client.waitFor((state) => state.rev >= rev, `rev ${rev}`);
}

const loggedIn = (name: string) => registered(server.url, name);

const RULES: KeywordsMatchRules = { games: 2, options: { teams: 'switch', grouping: 'random' } };

// A match room with Ann in the chair and Bob, Cat and Dan playing. Each of them may be a browser
// with an account; the others are guests, numbered in the order they came in.
async function matchRoom(
  rules: { games?: number } & Partial<KeywordsMatchOptions> = {},
  accounts: Record<string, Browser> = {},
) {
  const { games = RULES.games, ...options } = rules;
  const match = { games, options: { ...RULES.options, ...options } };
  const create = { game: 'keywords', language: 'en', fields: ['general'], play: true, match };
  const players: Record<string, TestClient> = {};
  let code = '';
  let guests = 0;
  for (const name of ['Ann', 'Bob', 'Cat', 'Dan']) {
    const browser = accounts[name];
    const client = track(browser ? await browser.connect() : await TestClient.connect(server.url));
    const reply = code
      ? await client.send('room:join', { code, play: true })
      : await client.send('room:create', create);
    if (!reply.ok) throw new Error(`${name}: ${reply.error}`);
    code ||= reply.code as string;
    await client.waitFor((state) => state.code === code);
    if (!browser) guests += 1;
    expect(known(client, name)).toBe(browser ? name : `Guest ${guests}`);
    players[name] = client;
  }
  const everyone = Object.values(players);
  await settle(everyone);
  return { code, players: players as Record<'Ann' | 'Bob' | 'Cat' | 'Dan', TestClient>, everyone };
}

// Whoever sits in a seat, as their own snapshot says.
function seated(everyone: TestClient[], team: Team, role: 'captain' | 'guesser') {
  return everyone.filter((client) => {
    const seat = data(client).seats[client.me];
    return seat?.team === team && seat.role === role;
  });
}

async function start(chair: TestClient, everyone: TestClient[]) {
  await chair.waitFor((state) => (state.data as KeywordsRoomData).startProblems.length === 0, 'ready to start');
  await expectOk(chair.send('room:start', { round: chair.state?.round }));
  for (const client of everyone) await client.waitFor((state) => state.phase === 'playing', 'the game');
}

// The group whose turn it is finds one of its cards and then reveals Reviewer 2, which ends the game:
// everyone in it gets a point for the card, and Reviewer 2 costs its student 3 and its PI 5; the
// other group wins, 3 for its student and 4 for its PI. Returns who did what.
async function playOneTurn(everyone: TestClient[]) {
  const [someone] = everyone as [TestClient];
  const team = board(someone).team;
  const [captain] = seated(everyone, team, 'captain') as [TestClient];
  const [guesser] = seated(everyone, team, 'guesser') as [TestClient];
  await expectOk(captain.send('keywords:clue', { ...moment(board(captain)), word: 'Hint', count: 1 }));
  await settle(everyone);
  const cards = board(captain).cards;
  const own = cards.findIndex((card) => !card.revealed && card.color === team);
  const reviewer2 = cards.findIndex((card) => card.color === 'reviewer2');
  await expectOk(guesser.send('keywords:reveal', { ...moment(board(guesser)), card: own }));
  await settle(everyone);
  await expectOk(guesser.send('keywords:reveal', { ...moment(board(guesser)), card: reviewer2 }));
  for (const client of everyone) await client.waitFor((state) => state.phase === 'ended', 'the end');
  // What the winners got, by name, as their seats in this game say.
  const won = Object.fromEntries(
    everyone
      .filter((client) => data(client).side !== team)
      .map((client) => [nameOf(client), data(client).seats[client.me]?.role === 'captain' ? 4 : 3]),
  );
  return { team, captain, guesser, won };
}

// A player's name in the room, which the test knows them by as `person` from now on.
function known(client: TestClient, person: string): string {
  const name = client.state?.players.find(({ id }) => id === client.me)?.name as string;
  people.set(name, person);
  return name;
}

// Who has a name in the room, as the test knows them.
const personOf = (name: string) => people.get(name) ?? name;
const pointsOf = (client: TestClient) =>
  Object.fromEntries(matchOf(client).standings.map(({ name, delta }) => [personOf(name), delta]));
const totalsOf = (client: TestClient) =>
  Object.fromEntries(matchOf(client).standings.map(({ name, total }) => [personOf(name), total]));
const nameOf = (client: TestClient) =>
  personOf(client.state?.players.find(({ id }) => id === client.me)?.name as string);
const standingOf = (client: TestClient, person: string) =>
  matchOf(client).standings.find(({ name }) => personOf(name) === person);

describe('a match', () => {
  test('is played game by game, scores everyone and ranks them at the end, with titles', async () => {
    server = await startServer({ games: [keywordsGame] });
    const accounts = { Ann: await loggedIn('Ann'), Bob: await loggedIn('Bob') };
    // Ann won a game of another kind before the match, which her record of the first game keeps
    // apart, streaks and all.
    keepGame(server.db, 'earlier', { game: 'test' });
    server.accounts.records.add(1, {
      game: 'test',
      gameId: 'earlier',
      side: 'red',
      role: 'guesser',
      result: 'won',
      place: 1,
      verdict: 'v',
      points: 0,
    });
    const { players, everyone } = await matchRoom({}, accounts);
    const ann = players.Ann;
    expect(matchOf(ann)).toMatchObject({ played: 0, status: 'on', game: 1, rules: RULES, standings: [] });
    // The groups are drawn when the game starts.
    expect(data(ann)).toMatchObject({ lineup: 'draw', startProblems: [] });

    await start(ann, everyone);
    expect(matchOf(ann).standings.map(({ total, delta }) => ({ total, delta }))).toEqual(
      Array.from({ length: 4 }, () => ({ total: 0, delta: 0 })),
    );
    // The lines of Cat and Dan, who are guests, have their numbers, by which the client names
    // them; those of Ann and Bob, who have accounts, have none.
    const numbered = matchOf(ann).standings.filter((standing) => 'guest' in standing);
    expect(Object.fromEntries(numbered.map(({ name, guest }) => [personOf(name), { name, guest }]))).toEqual({
      Cat: { name: 'Guest 1', guest: 1 },
      Dan: { name: 'Guest 2', guest: 2 },
    });
    const first = await playOneTurn(everyone);
    const loser = (client: TestClient) => nameOf(client);
    expect(pointsOf(ann)).toEqual({ [loser(first.captain)]: 1 - 5, [loser(first.guesser)]: 1 - 3, ...first.won });
    expect(Object.values(first.won).sort()).toEqual([3, 4]);
    expect(matchOf(ann)).toMatchObject({ played: 1, game: 1, status: 'on' });
    // The winning PI is on top.
    expect(matchOf(ann).standings[0]?.detail).toEqual({
      role: 'captain',
      found: 0,
      won: true,
      irrelevant: 0,
      wrong: 0,
      reviewer2: 0,
      bigClues: 0,
      openingRecord: false,
      heavenlyHand: false,
      missed: 0,
    });

    // The settings stay as they were for the rest of the match.
    await expectOk(ann.send('room:again', { gameId: ann.state?.gameId }));
    await settle(everyone);
    expect(await ann.send('room:settings', { fields: ['general'] })).toEqual({ ok: false, error: 'match_locked' });
    expect(matchOf(ann)).toMatchObject({ played: 1, game: 2 });
    // The table still shows the last game's points in the waiting room.
    expect(pointsOf(ann)[nameOf(first.guesser)]).toBe(-2);

    await start(ann, everyone);
    const second = await playOneTurn(everyone);
    const view = matchOf(ann);
    expect(view).toMatchObject({ played: 2, game: 2, status: 'over' });
    const totals = totalsOf(ann);
    const expected: Record<string, number> = {};
    for (const game of [first, second]) {
      expected[nameOf(game.captain)] = (expected[nameOf(game.captain)] ?? 0) - 4;
      expected[nameOf(game.guesser)] = (expected[nameOf(game.guesser)] ?? 0) - 2;
      for (const [name, points] of Object.entries(game.won)) expected[name] = (expected[name] ?? 0) + points;
    }
    expect(totals).toEqual(expected);
    const best = Math.max(...Object.values(totals));
    const worst = Math.min(...Object.values(totals));
    for (const standing of view.standings) {
      const title = standing.total === best ? 'best_paper' : standing.total === worst ? 'black_hole' : undefined;
      expect(standing.title, standing.name).toBe(title);
      expect(standing.rank).toBe(1 + view.standings.filter((other) => other.total > standing.total).length);
    }
    // No next game: the chair starts another match or makes the room ordinary again.
    expect(await ann.send('room:again', { gameId: ann.state?.gameId })).toEqual({ ok: false, error: 'match_over' });

    // The accounts keep the match and its title, once; guests keep nothing.
    const records = async (browser: Browser) =>
      ((await browser.request('/api/account/records')).body.records as RecordsView).keywords;
    for (const name of ['Ann', 'Bob'] as const) {
      const standing = view.standings.find((line) => line.name === name);
      expect((await records(accounts[name]))?.matches).toEqual({
        played: 1,
        won: standing?.rank === 1 ? 1 : 0,
        recent: [
          {
            game: 'keywords',
            endedAt: expect.stringMatching(/^\d{4}-/),
            games: 2,
            rank: standing?.rank,
            players: 4,
            score: standing?.total,
            title: standing?.title ?? null,
          },
        ],
      });
      // The games of the match bring their own titles too: a group that reveals Reviewer 2 in the
      // turn of its first clue falls at the first hurdle.
      const summary = await accounts[name].account();
      const titles = (summary?.titles ?? []) as { game: string; title: string; count: number }[];
      expect(titles.filter(({ title }) => title !== 'first_turn_reject')).toEqual(
        standing?.title ? [{ game: 'keywords', title: standing.title, count: 1 }] : [],
      );
    }
    // The match's games go on the players' streaks of the game one by one
    // (docs/architecture.md#streaks): Ann's streaks of the first game are what the two games of the
    // match add up to, whichever way each went, and the game of another kind that she won before
    // the match has streaks of its own.
    const anns = (await records(accounts.Ann)) as RecordsView[string];
    const annsRecord = anns.recent.map(({ result }) => result === 'won').reverse();
    expect(annsRecord).toHaveLength(2);
    // The games of the match are on the record as its games, and the game before it on the record
    // of its own game.
    expect(anns.recent.map(({ match }) => match)).toEqual([
      { game: 2, games: 2 },
      { game: 1, games: 2 },
    ]);
    expect(anns).toMatchObject({
      ordinary: { games: 0, wins: 0 },
      inMatches: { games: 2, wins: annsRecord.filter(Boolean).length },
    });
    expect(((await accounts.Ann.request('/api/account/records')).body.records as RecordsView).test).toMatchObject({
      ordinary: { games: 1, wins: 1 },
      inMatches: { games: 0, wins: 0 },
    });
    const streaks = { wins: 0, losses: 0 };
    let run = { won: true, length: 0 };
    for (const won of annsRecord) {
      run = run.won === won ? { won, length: run.length + 1 } : { won, length: 1 };
      streaks[won ? 'wins' : 'losses'] = Math.max(streaks[won ? 'wins' : 'losses'], run.length);
    }
    expect(server.accounts.records.streaks(1)).toEqual({ keywords: streaks, test: { wins: 1, losses: 0 } });
    const count = (table: string) => (server.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect(count('match_records')).toBe(2);
    const titles = count('titles');
    // Whatever changes in the room after the end records nothing more, such as Bob's new name.
    await accounts.Bob.request('/api/account/username', { username: 'Robert' });
    await ann.waitFor((state) => state.players.some(({ name }) => name === 'Robert'), "Bob's new name");
    await settle(everyone);
    server.accounts.recordMatch(
      1,
      { game: 'keywords', matchId: view.id, games: 2, rank: 1, players: 4, score: 99 },
      'best_paper',
    );
    expect([count('match_records'), count('titles')]).toEqual([2, titles]);
    expect(server.logs.filter(({ event }) => event === 'match_ended')).toHaveLength(1);

    // Another match, by the same rules or others, starts from nothing.
    expect(await ann.send('room:matchNext', { matchId: 'other', match: RULES })).toEqual({
      ok: false,
      error: 'stale',
    });
    // Options of the game that won't do leave the match as it was.
    const mixed = { games: 1, options: { teams: 'mixed', grouping: 'random' } };
    expect(await ann.send('room:matchNext', { matchId: view.id, match: mixed })).toEqual({
      ok: false,
      error: 'bad_match',
    });
    expect(matchOf(ann)).toMatchObject({ id: view.id, status: 'over' });
    await expectOk(ann.send('room:matchNext', { matchId: view.id, match: { ...RULES, games: 1 } }));
    await settle(everyone);
    expect(ann.state?.phase).toBe('lobby');
    expect(matchOf(ann)).toMatchObject({ played: 0, status: 'on', rules: { games: 1 }, standings: [] });
    expect(matchOf(ann).id).not.toBe(view.id);

    // Guessers never saw the key, matches or not.
    for (const client of everyone) {
      for (const state of client.states) {
        const game = (state.data as KeywordsRoomData).game;
        const seat = (state.data as KeywordsRoomData).seats[state.me ?? ''];
        if (!game || game.phase === 'over' || seat?.role === 'captain') continue;
        expect(game.cards.filter((card) => !card.revealed).every((card) => !('color' in card))).toBe(true);
      }
    }
  });

  test('can be ended early by the chair, which withdraws the game on and awards nothing', async () => {
    server = await startServer({ games: [keywordsGame] });
    const accounts = { Ann: await loggedIn('Ann') };
    const { players, everyone } = await matchRoom({ games: 3 }, accounts);
    const ann = players.Ann;
    await start(ann, everyone);
    await playOneTurn(everyone);
    await expectOk(ann.send('room:again', { gameId: ann.state?.gameId }));
    await start(ann, everyone);
    const { id } = matchOf(ann);
    expect(await players.Bob.send('room:matchEnd', { matchId: id })).toEqual({ ok: false, error: 'not_chair' });
    expect(await ann.send('room:matchEnd', { matchId: 'nope' })).toEqual({ ok: false, error: 'stale' });
    await expectOk(ann.send('room:matchEnd', { matchId: id }));
    await settle(everyone);
    expect(ann.state?.phase).toBe('ended');
    expect(board(ann).result).toEqual({ winner: null, reason: 'withdrawn' });
    const view = matchOf(ann);
    expect(view).toMatchObject({ status: 'stopped', played: 1 });
    expect(view.standings.every(({ title, rank }) => title === undefined && rank !== null)).toBe(true);
    expect(await ann.send('room:matchEnd', { matchId: id })).toEqual({ ok: false, error: 'match_over' });
    expect(server.db.prepare('SELECT count(*) AS n FROM match_records').get()).toEqual({ n: 0 });
    expect(server.db.prepare('SELECT count(*) AS n FROM titles').get()).toEqual({ n: 0 });

    // Back to an ordinary room.
    await expectOk(ann.send('room:matchNext', { matchId: id, match: null }));
    await settle(everyone);
    expect(ann.state).toMatchObject({ phase: 'lobby', match: null });
    expect(data(ann).lineup).toBe('free');
  });

  test("doesn't count a game that the chair withdrew", async () => {
    server = await startServer({ games: [keywordsGame] });
    const { players, everyone } = await matchRoom({ games: 1 });
    const ann = players.Ann;
    await start(ann, everyone);
    await expectOk(ann.send('room:end', { gameId: ann.state?.gameId }));
    await settle(everyone);
    expect(matchOf(ann)).toMatchObject({ played: 0, status: 'on', game: 1 });
    expect(pointsOf(ann)).toEqual({ Ann: null, Bob: null, Cat: null, Dan: null });
    await expectOk(ann.send('room:again', { gameId: ann.state?.gameId }));
    await start(ann, everyone);
    await playOneTurn(everyone);
    expect(matchOf(ann)).toMatchObject({ played: 1, status: 'over' });
  });

  test('keeps a player in their group and their total when they come back', async () => {
    server = await startServer({ games: [keywordsGame] });
    const { code, players, everyone } = await matchRoom({ teams: 'fixed' });
    const ann = players.Ann;
    await start(ann, everyone);
    await playOneTurn(everyone);
    await expectOk(ann.send('room:again', { gameId: ann.state?.gameId }));
    await settle(everyone);
    const dan = players.Dan;
    const { roomId } = dan.state ?? {};
    const side = data(dan).side;
    const total = totalsOf(ann).Dan;
    dan.close();
    const danId = dan.me;
    await ann.waitFor((state) => state.players.find(({ id }) => id === danId)?.online === false);
    const back = track(await TestClient.connect(server.url, { token: dan.token, code, roomId }));
    await back.waitFor((state) => state.code === code);
    expect(data(back).side).toBe(side);
    expect(data(back).seats[back.me]?.team).toBe(side);
    expect(totalsOf(back).Dan).toBe(total);
    expect(standingOf(back, 'Dan')).toMatchObject({ left: false, guest: 4 });
  });

  test('numbers in the log of a game whoever comes back after its end to talk it over', async () => {
    server = await startServer({ games: [keywordsGame] });
    const bobs = await loggedIn('Bob');
    const { code, players, everyone } = await matchRoom({ teams: 'fixed' }, { Bob: bobs });
    const ann = players.Ann;
    await start(ann, everyone);
    await playOneTurn(everyone);
    const gameId = ann.state?.gameId as string;
    // Bob leaves and comes back, under a new player ID, and says something; the chair plays on.
    const bob = players.Bob;
    const wasId = bob.me;
    await expectOk(bob.send('room:leave'));
    const back = track(await bobs.connect());
    expect(await back.send('room:join', { code, play: true })).toMatchObject({ ok: true });
    await back.waitFor((state) => state.code === code);
    expect(back.me).not.toBe(wasId);
    await expectOk(back.send('keywords:say', { gameId, text: 'gg' }));
    await expectOk(ann.send('room:again', { gameId }));
    await until(() => logOf(gameId).entries.some(({ said }) => said === 'gg'), 'the talk kept');
    const { numbers } = logOf(gameId).match ?? { numbers: {} };
    expect(numbers[back.me]).toBe(numbers[wasId]);
    expect(
      server.db
        .prepare('SELECT account_id AS account FROM game_players WHERE game_id = ? AND player_id = ?')
        .get(gameId, back.me),
    ).toEqual({ account: server.accounts.byName('Bob')?.id });
  });

  test('keeps its places on the record as they were when a guest logs in after the end to an account that played in it', async () => {
    server = await startServer({ games: [keywordsGame] });
    const browsers = {
      Ann: await loggedIn('Ann'),
      Bob: await loggedIn('Bob'),
      Cat: await loggedIn('Cat'),
      Dan: await loggedIn('Dan'),
    };
    const { code, players, everyone } = await matchRoom({ teams: 'fixed', grouping: 'choose' }, browsers);
    const ann = players.Ann;
    await expectOk(players.Ann.send('keywords:seat', { team: 'red', role: 'captain' }));
    await expectOk(players.Bob.send('keywords:seat', { team: 'red', role: 'guesser' }));
    await expectOk(players.Cat.send('keywords:seat', { team: 'blue', role: 'captain' }));
    await expectOk(players.Dan.send('keywords:seat', { team: 'blue', role: 'guesser' }));
    await start(ann, everyone);
    await playOneTurn(everyone);
    await expectOk(ann.send('room:again', { gameId: ann.state?.gameId }));
    await settle(everyone);
    // Dan leaves, and a guest takes his place for the last game, as blue's PI, whose turn it is.
    await expectOk(players.Dan.send('room:leave'));
    const left = everyone.filter((client) => client !== players.Dan);
    await settle(left);
    const guest = track(await joinRoom(server.url, code, { play: true }));
    known(guest, 'Guest');
    const table = [...left, guest];
    await settle(table);
    await expectOk(guest.send('keywords:seat', { team: 'blue', role: 'captain' }));
    await start(ann, table);
    await playOneTurn(table);
    expect(matchOf(ann).status).toBe('over');
    const gameId = ann.state?.gameId as string;
    const places = () =>
      server.db
        .prepare(
          'SELECT a.username AS name, m.rank, m.score, m.players, t.title FROM match_records AS m ' +
            'JOIN accounts AS a ON a.id = m.account_id LEFT JOIN titles AS t ON t.match_id = m.match_id ' +
            'AND t.account_id = m.account_id ORDER BY m.rank, name',
        )
        .all();
    const kept = places();
    expect(kept).toHaveLength(3);
    expect(kept.map(({ name }) => name)).not.toContain('Dan');
    // The guest was Dan all along, and logs in as him, which joins his two lines; then he talks the
    // game over, and the chair closes the room, which adds what he said to the record.
    const { roomId } = guest.state ?? {};
    guest.close();
    const back = track(await browsers.Dan.connect({ token: guest.token, code, roomId }));
    await back.waitFor((state) => state.code === code && state.players.some(({ name }) => name === 'Dan'));
    await expectOk(back.send('keywords:say', { gameId, text: 'gg' }));
    await expectOk(ann.send('room:close'));
    await until(() => logOf(gameId).entries.some(({ said }) => said === 'gg'), 'the talk kept');
    // The record of the match adds up again to the places as they were, and the check agrees.
    expect(places()).toEqual(kept);
    const counted = countMatches(countGames(server.db, keywordsGame).counted);
    const names = new Map(
      (server.db.prepare('SELECT id, username FROM accounts').all() as { id: number; username: string }[]).map(
        ({ id, username }) => [id, username],
      ),
    );
    const standings = [...(counted.values().next().value?.standings ?? [])]
      .map(([account, { rank, total, title }]) => ({ name: names.get(account), rank, score: total, title }))
      .sort((a, b) => a.rank - b.rank || String(a.name).localeCompare(String(b.name)));
    expect(standings.filter(({ name }) => name !== 'Dan')).toEqual(
      kept.map(({ name, rank, score, title }) => ({ name, rank, score, title })),
    );
    expect(checkData(server.db, { games: [keywordsGame] }).filter(({ rule }) => /match/.test(rule))).toEqual([]);
  });

  test('moves the total of a guest who logs in to their account, which keeps the match', async () => {
    server = await startServer({ games: [keywordsGame] });
    const { code, players, everyone } = await matchRoom({ teams: 'fixed' });
    const ann = players.Ann;
    await start(ann, everyone);
    await playOneTurn(everyone);
    await expectOk(ann.send('room:again', { gameId: ann.state?.gameId }));
    await settle(everyone);
    const dan = players.Dan;
    const { roomId } = dan.state ?? {};
    const side = data(dan).side;
    const total = totalsOf(ann).Dan;

    // Dan registers on the home page, as Dana, and comes back to the room.
    dan.close();
    const browser = await loggedIn('Dana');
    const back = track(await browser.connect({ token: dan.token, code, roomId }));
    await back.waitFor((state) => state.code === code && state.players.some(({ name }) => name === 'Dana'));
    expect(data(back).side).toBe(side);
    expect(totalsOf(back)).toMatchObject({ Dana: total });
    expect(matchOf(back).standings.map(({ name }) => personOf(name))).not.toContain('Dan');
    // Dana has an account now, and her line has no number any more.
    expect(standingOf(back, 'Dana')).not.toHaveProperty('guest');

    const table = [ann, players.Bob, players.Cat, back];
    await settle(table);
    await start(ann, table);
    await playOneTurn(table);
    const standing = standingOf(ann, 'Dana');
    expect(standing?.games).toBe(2);
    const records = (await browser.request('/api/account/records')).body.records as RecordsView;
    expect(records.keywords?.matches.recent[0]).toMatchObject({
      score: standing?.total,
      rank: standing?.rank,
      games: 2,
    });
  });

  test("shows the line of a guest who logged in as the account's, also once it has left the room", async () => {
    server = await startServer({ games: [keywordsGame] });
    const { code, players, everyone } = await matchRoom({ teams: 'fixed' });
    const ann = players.Ann;
    await start(ann, everyone);
    await playOneTurn(everyone);
    await expectOk(ann.send('room:again', { gameId: ann.state?.gameId }));
    await settle(everyone);
    const dan = players.Dan;
    const { roomId } = dan.state ?? {};
    dan.close();
    const browser = await loggedIn('Dana');
    const back = track(await browser.connect({ token: dan.token, code, roomId }));
    await back.waitFor((state) => state.code === code && state.players.some(({ name }) => name === 'Dana'));
    // Dana leaves before the next game: her line stays, as the account's, with no number.
    await expectOk(back.send('room:leave'));
    await ann.waitFor((state) => !state.players.some(({ name }) => name === 'Dana'), 'Dana to have left');
    expect(standingOf(ann, 'Dana')).toMatchObject({ playerId: null, left: true, games: 1 });
    expect(standingOf(ann, 'Dana')).not.toHaveProperty('guest');
    expect(matchOf(ann).standings.map(({ name }) => personOf(name))).not.toContain('Dan');
  });

  test('lets newcomers play from the next game, and lists those who left without ranking them', async () => {
    server = await startServer({ games: [keywordsGame] });
    const { code, players, everyone } = await matchRoom({ teams: 'fixed', grouping: 'choose' });
    const ann = players.Ann;
    // The players choose their groups for the first game.
    await expectOk(players.Ann.send('keywords:seat', { team: 'red', role: 'captain' }));
    await expectOk(players.Bob.send('keywords:seat', { team: 'red', role: 'guesser' }));
    await expectOk(players.Cat.send('keywords:seat', { team: 'blue', role: 'captain' }));
    await expectOk(players.Dan.send('keywords:seat', { team: 'blue', role: 'guesser' }));
    await start(ann, everyone);

    const eve = track(await joinRoom(server.url, code, { play: true }));
    expect(known(eve, 'Eve')).toBe('Guest 5');
    expect(data(eve)).toMatchObject({ joinsNext: true, seats: { [eve.me]: { team: null, role: 'spectator' } } });
    expect(await eve.send('keywords:seat', { team: 'red', role: 'guesser' })).toEqual({
      ok: false,
      error: 'between_games',
    });
    await playOneTurn([...everyone, eve]);
    expect(matchOf(ann).standings.map(({ name }) => personOf(name))).not.toContain('Eve');

    await expectOk(ann.send('room:again', { gameId: ann.state?.gameId }));
    await settle([...everyone, eve]);
    // The groups stay; Eve joins one, and each group has a PI who wasn't one.
    const teams = (client: TestClient) =>
      Object.fromEntries(
        (client.state?.players ?? []).map(({ id, name }) => [personOf(name), (data(client).seats[id] ?? {}).team]),
      );
    expect(teams(ann)).toMatchObject({ Ann: 'red', Bob: 'red', Cat: 'blue', Dan: 'blue' });
    expect(teams(ann).Eve).not.toBeNull();
    const captains = Object.entries(data(ann).seats)
      .filter(([, seat]) => seat.role === 'captain')
      .map(([id]) => personOf(ann.state?.players.find((player) => player.id === id)?.name ?? ''));
    expect(captains).not.toContain('Ann');
    expect(captains).not.toContain('Cat');
    expect(await players.Bob.send('keywords:seat', { team: 'blue', role: 'guesser' })).toEqual({
      ok: false,
      error: 'other_team',
    });

    // Eve hasn't played for a group yet, and both groups have as many players without her, so she
    // may choose either.
    await expectOk(eve.send('keywords:seat', { team: 'blue', role: 'guesser' }));

    // Dan leaves for good: he is listed, but not ranked, and Eve, who plays the last game, is. If
    // he was blue's PI, Cat takes the seat.
    await expectOk(players.Dan.send('room:leave'));
    const left = everyone.filter((client) => client !== players.Dan);
    await settle([...left, eve]);
    if (seated([...left, eve], 'blue', 'captain').length === 0) {
      await expectOk(players.Cat.send('keywords:seat', { team: 'blue', role: 'captain' }));
    }
    await start(ann, [...left, eve]);
    await playOneTurn([...left, eve]);
    const view = matchOf(ann);
    expect(view.status).toBe('over');
    // Dan's line keeps the number he had as a guest.
    expect(standingOf(ann, 'Dan')).toMatchObject({ name: 'Guest 4', guest: 4, left: true, rank: null, playerId: null });
    expect(standingOf(ann, 'Eve')).toMatchObject({ guest: 5, left: false, games: 1 });
    expect(view.standings.filter(({ rank }) => rank !== null)).toHaveLength(4);
  });
});

describe('a room that is not a match', () => {
  test('has no match, and refuses what is about one', async () => {
    server = await startServer({ games: [keywordsGame] });
    const { chair } = await createRoom(server.url, { game: 'keywords', play: true });
    track(chair);
    expect(chair.state?.match).toBeNull();
    expect(data(chair).lineup).toBe('free');
    expect(await chair.send('room:matchEnd', { matchId: 'x' })).toEqual({ ok: false, error: 'stale' });
    expect(await chair.send('room:matchNext', { matchId: 'x', match: null })).toEqual({ ok: false, error: 'stale' });
  });

  test("can't be made a match with rules that won't do, or for a game that has no matches", async () => {
    server = await startServer({ games: [keywordsGame] });
    const client = track(await TestClient.connect(server.url));
    const create = { game: 'keywords', language: 'en', fields: ['general'] };
    for (const match of [
      { ...RULES, games: 0 },
      { ...RULES, games: 11 },
      { ...RULES, games: 2.5 },
    ]) {
      expect(await client.send('room:create', { ...create, match }), JSON.stringify(match)).toEqual({
        ok: false,
        error: 'bad_request',
      });
    }
    // The game's own options are the game's to check (MatchHooks.options).
    for (const match of [
      { games: 2, options: { teams: 'mixed', grouping: 'random' } },
      { games: 2, options: { ...RULES.options, extra: true } },
      { games: 2, teams: 'fixed', grouping: 'random' },
      { games: 2 },
    ]) {
      expect(await client.send('room:create', { ...create, match }), JSON.stringify(match)).toEqual({
        ok: false,
        error: 'bad_match',
      });
    }
    await server.close();
    server = await startServer();
    const other = track(await TestClient.connect(server.url));
    expect(await other.send('room:create', { ...create, game: 'test', match: RULES })).toEqual({
      ok: false,
      error: 'bad_match',
    });
    expect(await other.send('room:create', { ...create, game: 'test', match: { games: 2 } })).toEqual({
      ok: false,
      error: 'bad_match',
    });
  });
});

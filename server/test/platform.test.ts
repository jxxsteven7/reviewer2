import type { AccountSummary, ProfileView, RecordsView } from '@reviewer2/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { checkData } from '../src/store/check';
import { countedUnder, countedUnderKey, recountDue, recountRecords } from '../src/store/recount';
import { Browser, loggedIn, startServer, TestClient, type TestServer } from './helpers';
import { tallyGame, type TallyView } from './tallyGame';

// The shared layer runs a game unlike the first one, which exists only in the tests (tallyGame.ts),
// without a change of its own: each for themselves or all together, with draws, several rounds and
// people who watch, from the room to its end, the records of the accounts that played, their
// streaks and friend duos, the replays, the recount of the records and the check of the data, and
// a match with options of the game's own. The first game isn't on this server, and appears
// nowhere in what the accounts keep.

let server: TestServer;
const clients: TestClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await server.close();
});

interface Person {
  name: string;
  browser: Browser;
  client: TestClient;
  id: number;
  handle: string;
}

async function person(name: string): Promise<Person> {
  const browser = await loggedIn(server.url, name);
  const { id, handle } = (await browser.account()) as { id: number; handle: string };
  const client = await browser.connect();
  clients.push(client);
  return { name, browser, client, id, handle };
}

async function befriend(one: Person, other: Person) {
  expect(await one.client.send('friends:request', { username: other.name })).toEqual({ ok: true, status: 'pending' });
  expect(await other.client.send('friends:accept', { username: one.name })).toEqual({ ok: true });
}

// A room of the game that the chair makes, to play, with what else `create` says, which the
// players join to play and the watchers to watch: the connections of everyone in it, in that order.
async function table(chair: Person, players: Person[], watchers: Person[], create: Record<string, unknown>) {
  const reply = await chair.client.send('room:create', {
    game: 'tally',
    language: 'en',
    fields: [],
    play: true,
    ...create,
  });
  if (!reply.ok) throw new Error(`could not create a room: ${reply.error}`);
  const code = reply.code as string;
  await chair.client.waitFor((state) => state.code === code);
  for (const { client } of players)
    expect(await client.send('room:join', { code, play: true })).toMatchObject({ ok: true });
  for (const { client } of watchers)
    expect(await client.send('room:join', { code, play: false })).toMatchObject({ ok: true });
  const everyone = [chair, ...players, ...watchers].map(({ client }) => client);
  for (const client of everyone) await client.waitFor((state) => state.players.length === everyone.length);
  return everyone;
}

const view = (client: TestClient) => client.state?.data as TallyView;

async function start(chair: TestClient): Promise<string> {
  expect(await chair.send('room:start', { round: chair.state?.round })).toEqual({ ok: true });
  const { gameId } = await chair.waitFor((state) => state.phase === 'playing', 'the game');
  return gameId as string;
}

// Each round, the players pick these numbers, in their order.
async function pick(players: TestClient[], rounds: number[][]) {
  for (const numbers of rounds) {
    for (const [i, client] of players.entries()) {
      expect(await client.send('tally:play', { number: numbers[i] })).toEqual({ ok: true });
    }
  }
}

const ended = async (everyone: TestClient[]) => {
  for (const client of everyone) await client.waitFor((state) => state.phase === 'ended', 'the end');
};

// A game that the chair starts, played through, round by round: its ID.
async function play(chair: TestClient, players: TestClient[], rounds: number[][], everyone: TestClient[]) {
  const gameId = await start(chair);
  await pick(players, rounds);
  await ended(everyone);
  return gameId;
}

async function again(chair: TestClient, everyone: TestClient[]) {
  expect(await chair.send('room:again', { gameId: chair.state?.gameId })).toEqual({ ok: true });
  for (const client of everyone) await client.waitFor((state) => state.phase === 'lobby', 'the waiting room');
}

type Row = Record<string, unknown>;

interface KeptRecord {
  account: number;
  side: string;
  role: string;
  result: string;
  place: number;
  verdict: string;
  detail: unknown;
  points: number;
}

// The records of a game, as the database keeps them, by account, with the game's own detail read.
const recordsOf = (gameId: string): KeptRecord[] =>
  (
    server.db
      .prepare(
        'SELECT account_id AS account, side, role, result, place, verdict, detail, points FROM game_records ' +
          'WHERE game_id = ? ORDER BY account_id',
      )
      .all(gameId) as unknown as (KeptRecord & { detail: string | null })[]
  ).map(({ detail, ...row }) => ({ ...row, detail: detail === null ? null : (JSON.parse(detail) as unknown) }));

const allRecords = () =>
  (server.db.prepare('SELECT * FROM game_records ORDER BY id').all() as Row[]).map((row) => ({ ...row }));

const outcomeOf = (gameId: string) => ({
  ...(server.db.prepare('SELECT winner, reason FROM replays WHERE game_id = ?').get(gameId) as Row),
});

const recordId = (account: number, gameId: string) =>
  (
    server.db.prepare('SELECT id FROM game_records WHERE account_id = ? AND game_id = ?').get(account, gameId) as {
      id: number;
    }
  ).id;

const recordsView = async ({ browser }: Person) =>
  (await browser.request('/api/account/records')).body.records as RecordsView;
const summaryOf = async ({ browser }: Person) => (await browser.account()) as unknown as AccountSummary;
const profileOf = async (viewer: Browser, { handle }: Person) =>
  (await viewer.request(`/api/profile/${handle}`)).body.profile as ProfileView;

const check = () => checkData(server.db, { games: [tallyGame] });
const NOTHING_CHANGED = { records: 0, titles: 0, plays: 0, matches: 0 };

describe('a game that is not the first one', () => {
  test('each for themselves goes on the record, draws included, and is counted again from its log', async () => {
    server = await startServer({ games: [tallyGame] });
    const ann = await person('Ann');
    const bob = await person('Bob');
    const cat = await person('Cat');
    const dan = await person('Dan');
    await befriend(ann, bob);
    const everyone = await table(ann, [bob, cat], [dan], { settings: { together: false, rounds: 2 } });
    const players = everyone.slice(0, 3);
    const [annId, bobId, catId] = players.map((client) => client.me) as [string, string, string];
    expect(view(ann.client)).toMatchObject({ together: false, rounds: 2, seats: [annId, bobId, catId] });

    // The first game: a number picked stays its player's until the round closes, and only players
    // pick, once a round, from 0 to 9.
    const first = await start(ann.client);
    expect(await ann.client.send('tally:play', { number: 5 })).toEqual({ ok: true });
    await bob.client.waitFor((state) => (state.data as TallyView).picked.length === 1);
    expect(view(ann.client)).toMatchObject({ picked: [annId], mine: 5, picks: {} });
    expect(view(bob.client)).toMatchObject({ picked: [annId], mine: null, picks: {} });
    expect(view(dan.client)).toMatchObject({ picked: [annId], mine: null });
    expect(await ann.client.send('tally:play', { number: 6 })).toEqual({ ok: false, error: 'picked_already' });
    expect(await dan.client.send('tally:play', { number: 1 })).toEqual({ ok: false, error: 'not_playing' });
    expect(await bob.client.send('tally:play', { number: 10 })).toEqual({ ok: false, error: 'bad_number' });
    expect(await bob.client.send('tally:play', { number: 3 })).toEqual({ ok: true });
    expect(await cat.client.send('tally:play', { number: 5 })).toEqual({ ok: true });
    await dan.client.waitFor((state) => (state.data as TallyView).closed === 1, 'the first round');
    expect(view(dan.client)).toMatchObject({ picked: [], picks: { [annId]: [5], [bobId]: [3], [catId]: [5] } });
    await pick(players, [[4, 2, 1]]);
    await ended(everyone);
    // Ann alone at the top wins; Cat, ahead of Bob, has the second place.
    expect(recordsOf(first)).toEqual([
      {
        account: ann.id,
        side: annId,
        role: 'player',
        result: 'won',
        place: 1,
        verdict: 'first',
        detail: { score: 9, rounds: [5, 4] },
        points: 9,
      },
      {
        account: bob.id,
        side: bobId,
        role: 'player',
        result: 'lost',
        place: 3,
        verdict: 'behind',
        detail: { score: 5, rounds: [3, 2] },
        points: 5,
      },
      {
        account: cat.id,
        side: catId,
        role: 'player',
        result: 'lost',
        place: 2,
        verdict: 'behind',
        detail: { score: 6, rounds: [5, 1] },
        points: 6,
      },
    ]);
    expect(outcomeOf(first)).toEqual({ winner: annId, reason: 'highest' });
    await again(ann.client, everyone);

    // Ann and Bob level at the top draw, and the game has no winner.
    const second = await play(
      ann.client,
      players,
      [
        [4, 4, 2],
        [3, 3, 2],
      ],
      everyone,
    );
    expect(recordsOf(second)).toEqual([
      expect.objectContaining({ account: ann.id, result: 'drawn', place: 1, verdict: 'level', points: 7 }),
      expect.objectContaining({ account: bob.id, result: 'drawn', place: 1, verdict: 'level', points: 7 }),
      expect.objectContaining({ account: cat.id, result: 'lost', place: 3, verdict: 'behind', points: 4 }),
    ]);
    expect(outcomeOf(second)).toEqual({ winner: null, reason: 'level' });
    await again(ann.client, everyone);

    // Cat loses a third game in a row, which only she is told of; Ann's win after the draw starts a
    // streak anew; Ann and Bob have played against each other three times, which makes each the
    // other's rival among their friends.
    const third = await play(
      ann.client,
      players,
      [
        [5, 1, 9],
        [5, 1, 0],
      ],
      everyone,
    );
    expect(outcomeOf(third)).toEqual({ winner: annId, reason: 'highest' });
    expect(cat.client.state?.streaks).toEqual([{ playerId: catId, kind: 'losses', length: 3, record: true }]);
    expect(ann.client.state?.streaks).toEqual([]);
    expect(ann.client.state?.duos).toEqual([{ playerId: bobId, title: 'rival', count: 3 }]);
    expect(bob.client.state?.duos).toEqual([{ playerId: annId, title: 'rival', count: 3 }]);
    expect(cat.client.state?.duos).toEqual([]);

    // The records are of this game alone, the first game's absent.
    const annRecords = await recordsView(ann);
    expect(Object.keys(annRecords)).toEqual(['tally']);
    expect(annRecords.tally).toEqual({
      ordinary: { games: 3, wins: 2 },
      inMatches: { games: 0, wins: 0 },
      roles: { player: { games: 3, wins: 2 } },
      matches: { played: 0, won: 0, recent: [] },
      recent: [
        expect.objectContaining({
          game: 'tally',
          gameId: third,
          side: annId,
          winner: annId,
          result: 'won',
          place: 1,
          match: null,
          agents: false,
        }),
        expect.objectContaining({ gameId: second, winner: null, result: 'drawn', place: 1, verdict: 'level' }),
        expect.objectContaining({ gameId: first, winner: annId, result: 'won', place: 1, verdict: 'first' }),
      ],
    });
    expect((await recordsView(cat)).tally?.recent.map(({ result, place }) => [result, place])).toEqual([
      ['lost', 2],
      ['lost', 3],
      ['lost', 2],
    ]);
    // Whoever only watched has no record, and no replay to watch.
    expect(await recordsView(dan)).toEqual({});
    expect(await dan.browser.request('/api/account/replay', { gameId: first })).toMatchObject({
      status: 404,
      body: { ok: false, error: 'no_replay' },
    });
    // A draw ends a streak of either kind.
    const annSummary = await summaryOf(ann);
    expect(annSummary).toMatchObject({
      points: 26,
      titles: [],
      played: ['tally'],
      streaks: { tally: { wins: 1, losses: 0 } },
    });
    expect((await summaryOf(bob)).streaks).toEqual({ tally: { wins: 0, losses: 1 } });
    expect((await summaryOf(cat)).streaks).toEqual({ tally: { wins: 0, losses: 3 } });
    expect(await profileOf(new Browser(server.url), ann)).toMatchObject({
      titles: [],
      streaks: { tally: { wins: 1, losses: 0 } },
      record: {
        tally: {
          ordinary: { games: 3, wins: 2 },
          inMatches: { games: 0, wins: 0 },
          roles: { player: { games: 3, wins: 2 } },
          matches: { played: 0, won: 0 },
        },
      },
    });
    expect(Object.keys((await profileOf(new Browser(server.url), ann)).record ?? {})).toEqual(['tally']);
    // Friends beat each other by their places, and a draw beats neither.
    expect((await profileOf(ann.browser, bob)).duo).toEqual({
      tally: { wonTogether: 0, lostTogether: 0, against: 3, beat: 2, beaten: 0, titles: ['rival'] },
    });
    expect((await profileOf(bob.browser, ann)).duo).toEqual({
      tally: { wonTogether: 0, lostTogether: 0, against: 3, beat: 0, beaten: 2, titles: ['rival'] },
    });

    // A player watches a game again, with everyone's numbers.
    expect((await ann.browser.request('/api/account/replay', { gameId: first })).body).toEqual({
      ok: true,
      replay: {
        together: false,
        rounds: 2,
        players: [
          { playerId: annId, username: 'Ann', rounds: [5, 4] },
          { playerId: bobId, username: 'Bob', rounds: [3, 2] },
          { playerId: catId, username: 'Cat', rounds: [5, 1] },
        ],
        outcome: { winner: annId, reason: 'highest' },
        viewer: [annId],
      },
    });

    // Counted again from the logs, the records stay as they are, whenever the rules are counted
    // again: the first time, once the note of the rules is lost, and under new rules.
    const kept = allRecords();
    expect(recountRecords(server.db, [tallyGame])).toEqual({ games: 3, ...NOTHING_CHANGED });
    expect(countedUnder(server.db, 'tally')).toBe(1);
    expect(check()).toEqual([]);
    server.db.prepare('DELETE FROM settings WHERE key = ?').run(countedUnderKey('tally'));
    expect(recountDue(server.db, [tallyGame])).toEqual([tallyGame]);
    expect(recountRecords(server.db, [tallyGame])).toEqual({ games: 3, ...NOTHING_CHANGED });
    const newRules = { ...tallyGame, rulesVersion: 2 };
    expect(recountDue(server.db, [newRules])).toEqual([newRules]);
    expect(recountRecords(server.db, [newRules])).toEqual({ games: 3, ...NOTHING_CHANGED });
    expect(check()).toEqual([
      { rule: "games whose records are counted under other rules than today's", count: 1, ids: ['tally'] },
    ]);
    expect(recountRecords(server.db, [tallyGame])).toEqual({ games: 3, ...NOTHING_CHANGED });
    expect(allRecords()).toEqual(kept);
    expect(check()).toEqual([]);

    // A record that says otherwise than its log, won or drawn, is set right by the count.
    const annFirst = recordId(ann.id, first);
    const bobSecond = recordId(bob.id, second);
    server.db
      .prepare(
        "UPDATE game_records SET result = 'lost', place = 2, verdict = 'behind', detail = '{\"score\":1,\"rounds\":[1]}', " +
          'points = 1 WHERE id = ?',
      )
      .run(annFirst);
    server.db.prepare("UPDATE game_records SET result = 'won' WHERE id = ?").run(bobSecond);
    expect(check()).toEqual([
      { rule: 'records of games that disagree with the record of the game', count: 1, ids: [String(annFirst)] },
      {
        rule: 'records of games that are not what their record counts',
        count: 2,
        ids: [annFirst, bobSecond].sort((a, b) => a - b).map(String),
      },
    ]);
    expect(recountRecords(server.db, [tallyGame])).toEqual({ games: 3, ...NOTHING_CHANGED, records: 2 });
    expect(allRecords()).toEqual(kept);
    expect(check()).toEqual([]);
    expect(await recordsView(ann)).toEqual(annRecords);
    expect(await summaryOf(ann)).toEqual(annSummary);
  });

  test('all together, everyone wins or loses together, also with a player who left', async () => {
    server = await startServer({ games: [tallyGame] });
    const ann = await person('Ann');
    const bob = await person('Bob');
    const cat = await person('Cat');
    await befriend(ann, bob);
    const everyone = await table(ann, [bob, cat], [], { settings: { together: true, rounds: 2 } });
    const [annId, bobId, catId] = everyone.map((client) => client.me) as [string, string, string];

    // Everyone picks the same number in every round, and wins.
    const agreed = await play(
      ann.client,
      everyone,
      [
        [3, 3, 3],
        [7, 7, 7],
      ],
      everyone,
    );
    const won = { side: 'together', role: 'player', result: 'won', place: 1, verdict: 'agreed', points: 10 };
    const together = { score: 10, rounds: [3, 7] };
    expect(recordsOf(agreed)).toEqual([
      { account: ann.id, ...won, detail: together },
      { account: bob.id, ...won, detail: together },
      { account: cat.id, ...won, detail: together },
    ]);
    expect(outcomeOf(agreed)).toEqual({ winner: 'together', reason: 'agreed' });
    await again(ann.client, everyone);

    // Ann picks another number once, and everyone loses, in the first place still: no side won.
    const apart = await play(
      ann.client,
      everyone,
      [
        [2, 2, 2],
        [1, 2, 2],
      ],
      everyone,
    );
    expect(recordsOf(apart).map(({ result, place, verdict }) => [result, place, verdict])).toEqual([
      ['lost', 1, 'apart'],
      ['lost', 1, 'apart'],
      ['lost', 1, 'apart'],
    ]);
    expect(outcomeOf(apart)).toEqual({ winner: null, reason: 'apart' });
    await again(ann.client, everyone);

    // Cat leaves after the first round: the second closes once Ann and Bob have picked, and her
    // number still counts. She keeps no record of a game she wasn't there at the end of.
    const left = await start(ann.client);
    await pick(everyone, [[4, 4, 4]]);
    expect(await cat.client.send('room:leave')).toEqual({ ok: true });
    await ann.client.waitFor((state) => state.players.length === 2);
    expect(view(ann.client)).toMatchObject({ out: [catId], closed: 1 });
    await pick(everyone.slice(0, 2), [[6, 6]]);
    await ended(everyone.slice(0, 2));
    expect(recordsOf(left).map(({ account, result }) => [account, result])).toEqual([
      [ann.id, 'won'],
      [bob.id, 'won'],
    ]);
    expect(outcomeOf(left)).toEqual({ winner: 'together', reason: 'agreed' });
    expect((await ann.browser.request('/api/account/replay', { gameId: left })).body).toMatchObject({
      ok: true,
      replay: {
        together: true,
        players: [
          { playerId: annId, rounds: [4, 6] },
          { playerId: bobId, rounds: [4, 6] },
          { playerId: catId, username: 'Cat', rounds: [4] },
        ],
        outcome: { winner: 'together', reason: 'agreed' },
      },
    });

    expect((await summaryOf(ann)).streaks).toEqual({ tally: { wins: 1, losses: 1 } });
    expect((await summaryOf(cat)).streaks).toEqual({ tally: { wins: 1, losses: 1 } });
    expect((await recordsView(ann)).tally).toMatchObject({
      ordinary: { games: 3, wins: 2 },
      roles: { player: { games: 3, wins: 2 } },
    });
    expect((await recordsView(cat)).tally?.ordinary).toEqual({ games: 2, wins: 1 });
    expect((await profileOf(ann.browser, bob)).duo).toEqual({
      tally: { wonTogether: 2, lostTogether: 1, against: 0, beat: 0, beaten: 0, titles: [] },
    });

    expect(recountRecords(server.db, [tallyGame])).toEqual({ games: 3, ...NOTHING_CHANGED });
    expect(check()).toEqual([]);
    server.db.prepare("UPDATE game_records SET result = 'won', verdict = 'agreed' WHERE game_id = ?").run(apart);
    expect(check().map(({ rule, count }) => [rule, count])).toEqual([
      ['records of games that are not what their record counts', 3],
    ]);
    expect(recountRecords(server.db, [tallyGame])).toEqual({ games: 3, ...NOTHING_CHANGED, records: 3 });
    expect(recordsOf(apart).map(({ result }) => result)).toEqual(['lost', 'lost', 'lost']);
    expect(check()).toEqual([]);
  });

  test('a match takes the options that the game takes, and awards its titles in the game', async () => {
    server = await startServer({ games: [tallyGame] });
    const ann = await person('Ann');
    const bob = await person('Bob');
    const cat = await person('Cat');
    const settings = { together: false, rounds: 3 };
    // The game checks its own options, whole.
    for (const match of [
      { games: 2 },
      { games: 2, options: { rounds: 9 } },
      { games: 2, options: { rounds: 1, more: true } },
      { games: 2, options: 'one round' },
    ]) {
      expect(
        await ann.client.send('room:create', {
          game: 'tally',
          language: 'en',
          fields: [],
          play: true,
          settings,
          match,
        }),
      ).toEqual({ ok: false, error: 'bad_match' });
    }
    const rules = { games: 2, options: { rounds: 1 } };
    const everyone = await table(ann, [bob, cat], [], { settings, match: rules });
    const [annId, bobId, catId] = everyone.map((client) => client.me) as [string, string, string];
    expect(ann.client.state?.match).toMatchObject({ rules, status: 'on', played: 0 });
    expect(view(ann.client)).toMatchObject({ rounds: 3, matchRounds: 1 });

    // Each game has the one round that the options name, not the three of the settings.
    const first = await play(ann.client, everyone, [[9, 5, 1]], everyone);
    expect(ann.client.state?.points).toEqual([
      { playerId: annId, points: 9, detail: { score: 9, rounds: [9] } },
      { playerId: bobId, points: 5, detail: { score: 5, rounds: [5] } },
      { playerId: catId, points: 1, detail: { score: 1, rounds: [1] } },
    ]);
    await again(ann.client, everyone);
    const second = await play(ann.client, everyone, [[0, 5, 2]], everyone);
    expect(ann.client.state?.match).toMatchObject({ played: 2, status: 'over' });
    expect(
      ann.client.state?.match?.standings.map(({ playerId, total, rank, title }) => [playerId, total, rank, title]),
    ).toEqual([
      [bobId, 10, 1, 'best_paper'],
      [annId, 9, 2, undefined],
      [catId, 3, 3, 'black_hole'],
    ]);
    expect(recordsOf(first).map(({ result, place }) => [result, place])).toEqual([
      ['won', 1],
      ['lost', 2],
      ['lost', 3],
    ]);
    expect(recordsOf(second).map(({ result, place }) => [result, place])).toEqual([
      ['lost', 3],
      ['won', 1],
      ['lost', 2],
    ]);

    // The match's titles are titles of the game.
    expect((await summaryOf(bob)).titles).toEqual([{ game: 'tally', title: 'best_paper', count: 1 }]);
    expect((await summaryOf(cat)).titles).toEqual([{ game: 'tally', title: 'black_hole', count: 1 }]);
    expect((await summaryOf(ann)).titles).toEqual([]);
    expect((await recordsView(bob)).tally).toMatchObject({
      ordinary: { games: 0, wins: 0 },
      inMatches: { games: 2, wins: 1 },
      matches: {
        played: 1,
        won: 1,
        recent: [{ game: 'tally', games: 2, rank: 1, players: 3, score: 10, title: 'best_paper' }],
      },
      recent: [
        expect.objectContaining({ gameId: second, match: { game: 2, games: 2 } }),
        expect.objectContaining({ gameId: first, match: { game: 1, games: 2 } }),
      ],
    });
    // The chair's next room starts from the match's rules and the game's settings.
    expect((await summaryOf(ann)).roomSetup).toEqual({
      tally: {
        room: { language: 'en', fields: [], randomFields: false, settings, match: rules, public: false, play: true },
      },
    });

    // A next match takes the options that the game takes, or none for an ordinary room again.
    const matchId = ann.client.state?.match?.id;
    expect(await ann.client.send('room:matchNext', { matchId, match: { games: 2, options: { rounds: 0 } } })).toEqual({
      ok: false,
      error: 'bad_match',
    });
    expect(await ann.client.send('room:matchNext', { matchId, match: null })).toEqual({ ok: true });
    await ann.client.waitFor((state) => state.phase === 'lobby' && state.match === null);
    expect(view(ann.client)).toMatchObject({ rounds: 3, matchRounds: null });

    expect(recountRecords(server.db, [tallyGame])).toEqual({ games: 2, ...NOTHING_CHANGED });
    expect(check()).toEqual([]);
    server.db.prepare('UPDATE match_records SET rank = 3, score = 0 WHERE account_id = ?').run(bob.id);
    expect(check().map(({ rule, count }) => [rule, count])).toEqual([
      ['records of matches that are not what their games add up to', 1],
    ]);
    expect(recountRecords(server.db, [tallyGame])).toEqual({ games: 2, ...NOTHING_CHANGED, matches: 1 });
    expect(check()).toEqual([]);
    expect((await recordsView(bob)).tally?.matches.recent).toEqual([
      expect.objectContaining({ rank: 1, score: 10, title: 'best_paper' }),
    ]);
  });
});

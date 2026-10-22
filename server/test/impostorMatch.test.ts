import type { MatchView } from '@reviewer2/shared';
import { defaultSettings, type ImpostorRoomData, type ImpostorScoreDetail } from '@reviewer2/shared/impostor';
import { afterEach, describe, expect, test } from 'vitest';
import { seededRng } from '../src/core/random';
import { WordLibrary } from '../src/core/words';
import { impostorGame } from '../src/games/impostor';
import type { ImpostorData, ImpostorGame } from '../src/games/impostor/state';
import { LINES } from '../src/games/impostor/testing';
import { checkData } from '../src/store/check';
import { recountRecords } from '../src/store/recount';
import { loggedIn, startServer, TestClient, until, type TestServer } from './helpers';

// Matches of the hidden word game over real sockets (docs/games/impostor.md#matches): whole
// matches, the pairs that a match never plays twice, games that don't count, the setter, and what
// the records keep. How a match adds up its games is tested in src/core/match.test.ts.

// Three pairs of related terms, the only ones of their field.
const library = () =>
  new WordLibrary([
    {
      id: 'music',
      name: { zh: 'M', en: 'M' },
      terms: [
        { id: 'violin', en: 'violin', zh: '小提琴', related: ['cello'] },
        { id: 'cello', en: 'cello', zh: '大提琴' },
        { id: 'piano', en: 'piano', zh: '钢琴', related: ['organ'] },
        { id: 'organ', en: 'organ', zh: '风琴' },
        { id: 'trumpet', en: 'trumpet', zh: '小号', related: ['trombone'] },
        { id: 'trombone', en: 'trombone', zh: '长号' },
      ],
    },
  ]);

// No time limits and no PI, so that the tests set the pace, and four players are three students
// and a Reviewer 2.
const SETTINGS = { ...defaultSettings('en'), describeTime: 0, voteTime: 0, pi: false };

let server: TestServer;
const clients: TestClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await server.close();
});

const start = async () => {
  server = await startServer({
    games: [impostorGame],
    words: library(),
    rng: seededRng(7),
    accountLimits: { registrationsPerHour: 100 },
  });
};

// A room of the game with Ann in the chair and Bob, Cat and Dan, all with accounts, and Eve too
// with `setter`, where Ann sets the words and the four others play.
async function matchRoom(options: { games?: number; setter?: boolean } = {}) {
  const names = options.setter ? ['Ann', 'Bob', 'Cat', 'Dan', 'Eve'] : ['Ann', 'Bob', 'Cat', 'Dan'];
  const players: TestClient[] = [];
  let code = '';
  for (const name of names) {
    const client = await (await loggedIn(server.url, name)).connect();
    clients.push(client);
    const reply = code
      ? await client.send('room:join', { code, play: true })
      : await client.send('room:create', {
          game: 'impostor',
          language: 'en',
          fields: ['music'],
          play: true,
          settings: { ...SETTINGS, setter: options.setter ?? false },
          match: { games: options.games ?? 3 },
        });
    if (!reply.ok) throw new Error(`${name}: ${reply.error}`);
    code ||= reply.code as string;
    await client.waitFor((state) => state.code === code);
    players.push(client);
  }
  const room = () => {
    const found = server.app.rooms.find(code);
    if (!found) throw new Error('no room');
    return found;
  };
  const data = () => room().data as ImpostorData;
  const game = () => data().game as ImpostorGame;
  const match = () => players[0]?.state?.match as MatchView;
  const ann = players[0] as TestClient;
  const byId = (id: string) => players.find((client) => client.me === id) as TestClient;
  // Waits until everyone has the newest snapshot.
  const settle = async () => {
    const rev = room().rev;
    for (const client of players) {
      if (room().members.has(client.me)) await client.waitFor((state) => state.rev >= rev, `rev ${rev}`);
    }
  };

  // The chair starts the next game.
  async function begin() {
    expect(await ann.send('room:start', { round: room().round })).toEqual({ ok: true });
    await settle();
  }

  // Everyone describes in turn, and then everyone votes for the Reviewer 2, who votes for someone
  // else, until the students have voted the Reviewer 2 out.
  async function playOut() {
    let line = 0;
    for (let step = 0; step < 40 && game().phase !== 'over'; step += 1) {
      const now = game();
      if (now.phase === 'describe') {
        const speaker = byId(now.speaker as string);
        const reply = await speaker.send('impostor:describe', {
          gameId: now.gameId,
          round: now.round,
          text: LINES[line++ % LINES.length],
        });
        expect(reply).toEqual({ ok: true });
      } else if (now.phase === 'vote') {
        const reviewer2 = now.players.find((player) => player.role === 'reviewer2');
        for (const player of now.players.filter((one) => one.fate === 'alive')) {
          const target =
            player === reviewer2
              ? (now.players.find((other) => other !== reviewer2)?.number ?? 0)
              : (reviewer2?.number ?? 0);
          expect(
            await byId(player.id).send('impostor:vote', { gameId: now.gameId, round: now.round, number: target }),
          ).toEqual({ ok: true });
        }
      } else throw new Error(`unexpected phase ${now.phase}`);
    }
    expect(game().phase).toBe('over');
    await settle();
  }

  // Back to the waiting room for the next game of the match.
  async function next() {
    expect(await ann.send('room:again', { gameId: game().gameId })).toEqual({ ok: true });
    await settle();
  }

  return { code, players, ann, room, data, game, match, begin, playOut, next, settle };
}

const pairOf = (game: ImpostorGame) => [game.words.student.word, game.words.reviewer2.word].sort().join('+');

describe('a match of the second game', () => {
  test('deals every game anew, plays no pair twice, adds the games up and ranks everyone, with no title', async () => {
    await start();
    const table = await matchRoom();
    expect(table.match()).toMatchObject({ rules: { games: 3 }, status: 'on', played: 0, game: 1 });
    const deals: string[] = [];
    const pairs: string[] = [];
    const totals = new Map<string, number>();
    for (let played = 1; played <= 3; played += 1) {
      await table.begin();
      const game = table.game();
      deals.push(game.players.map((player) => `${player.id}:${player.number}:${player.role}`).join(' '));
      pairs.push(pairOf(game));
      if (played === 1) {
        // The table lists the players in the order they came to the table, which everyone knows
        // from the waiting room, and not by their numbers, which would give them away.
        expect(table.match().standings.map((line) => line.name)).toEqual(['Ann', 'Bob', 'Cat', 'Dan']);
        const byNumber = game.players.map((player) => table.room().members.get(player.id)?.name);
        expect(byNumber).not.toEqual(['Ann', 'Bob', 'Cat', 'Dan']);
        expect(table.match().chairBound).toBe(false);
      }
      // While the game is on, the table shows nobody's points in it: they would tell who voted for
      // the Reviewer 2.
      expect(table.match().standings.map(({ delta, detail }) => ({ delta, detail }))).toEqual(
        game.players.map(() => ({ delta: null, detail: undefined })),
      );
      await table.playOut();
      const match = table.match();
      expect(match).toMatchObject({ played, game: played });
      for (const line of match.standings) {
        expect(line.delta).not.toBeNull();
        const detail = line.detail as ImpostorScoreDetail;
        const player = table.game().players.find((one) => one.id === line.playerId);
        expect(detail).toMatchObject({ role: player?.role, won: player?.role === 'student', fate: player?.fate });
        totals.set(line.name, (totals.get(line.name) ?? 0) + (line.delta ?? 0));
      }
      if (played < 3) await table.next();
    }
    // Every game dealt the numbers and the roles anew, which with the seed of the test came out
    // differently, and had a pair of its own.
    expect(new Set(deals).size).toBeGreaterThan(1);
    expect(new Set(pairs).size).toBe(3);

    const match = table.match();
    expect(match.status).toBe('over');
    expect(match.standings.map(({ name, total }) => [name, total])).toEqual(
      [...totals].sort((a, b) => b[1] - a[1]).map(([name, total]) => [name, total]),
    );
    expect(match.standings.every((line) => line.rank !== null && line.title === undefined)).toBe(true);
    // A match that is over has no next game.
    expect(await table.ann.send('room:again', { gameId: table.game().gameId })).toEqual({
      ok: false,
      error: 'match_over',
    });

    // Every account keeps the match, ranked, with no title, and the records count again as kept.
    const kept = server.db
      .prepare('SELECT game, games, rank, players, score FROM match_records ORDER BY rank, score')
      .all() as { game: string; games: number; rank: number; players: number; score: number }[];
    expect(kept).toHaveLength(4);
    expect(kept.every((row) => row.game === 'impostor' && row.games === 3 && row.players === 4)).toBe(true);
    expect(server.db.prepare('SELECT COUNT(*) AS count FROM titles WHERE match_id IS NOT NULL').get()).toEqual({
      count: 0,
    });
    expect(recountRecords(server.db, [impostorGame])).toMatchObject({ games: 3, matches: 0, titles: 0 });
    expect(checkData(server.db, { games: [impostorGame] })).toEqual([]);
  });

  test('takes 3, 5 or 7 games and no AI players', async () => {
    await start();
    const client = await (await loggedIn(server.url, 'Ann')).connect();
    clients.push(client);
    const create = (games: number) =>
      client.send('room:create', { game: 'impostor', language: 'en', fields: ['music'], play: true, match: { games } });
    for (const games of [1, 2, 4, 10]) expect(await create(games)).toEqual({ ok: false, error: 'bad_match' });
    const made = await create(5);
    expect(made).toMatchObject({ ok: true });
    await client.waitFor((state) => state.match?.rules.games === 5);
    expect(await client.send('room:addAgent', { persona: 'reviewer1', seat: null })).toMatchObject({ ok: false });
    expect(client.state?.players).toHaveLength(1);
  });

  test('draws no pair that it has had, and runs out of pairs before it runs out of games', async () => {
    await start();
    const table = await matchRoom({ games: 5 });
    for (let played = 1; played <= 3; played += 1) {
      await table.begin();
      await table.playOut();
      await table.next();
    }
    expect(table.match()).toMatchObject({ status: 'on', played: 3 });
    expect(await table.ann.send('room:start', { round: table.room().round })).toEqual({
      ok: false,
      error: 'no_words',
    });
  });

  test('plays a game that brought nobody points again, and says which game is next', async () => {
    await start();
    const table = await matchRoom();
    // The chair removes a student during the first game, which the students go on to win: it
    // counts for nothing.
    await table.begin();
    const first = table.game();
    const student = first.players.find((player) => player.role === 'student' && player.id !== table.ann.me);
    expect(
      await table.ann.send('room:remove', { seat: { gameId: first.gameId, number: student?.number } }),
    ).toMatchObject({ ok: true });
    await table.settle();
    await table.playOut();
    expect(table.match()).toMatchObject({ played: 0, game: 1 });
    expect(table.match().standings.every((line) => line.delta === null)).toBe(true);
    // A Reviewer 2 who leaves ends the game with no winner, which counts for nothing either.
    await table.next();
    // Three are left to play, one too few, until a fourth comes.
    const fifth = await (await loggedIn(server.url, 'Fay')).connect();
    clients.push(fifth);
    expect(await fifth.send('room:join', { code: table.code, play: true })).toMatchObject({ ok: true });
    table.players.push(fifth);
    await table.settle();
    await table.begin();
    const second = table.game();
    expect(pairOf(second)).not.toBe(pairOf(first));
    const reviewer2 = second.players.find((player) => player.role === 'reviewer2');
    const leaving = table.players.find((client) => client.me === reviewer2?.id) as TestClient;
    if (leaving === table.ann) throw new Error('the seed made the chair the Reviewer 2');
    expect(await leaving.send('room:leave', {})).toEqual({ ok: true });
    await table.ann.waitFor((state) => state.phase === 'ended', 'the end of the game');
    expect(table.game().result).toEqual({ winner: null, reason: 'reviewer2_left' });
    expect(table.match()).toMatchObject({ played: 0, game: 1, status: 'on' });
    // Neither is kept as a game of the match.
    expect(server.db.prepare('SELECT count(*) AS n FROM replays WHERE match_id IS NOT NULL').get()).toEqual({ n: 0 });
    expect(recountRecords(server.db, [impostorGame])).toMatchObject({ matches: 0, titles: 0 });
    expect(checkData(server.db, { games: [impostorGame] })).toEqual([]);
  });

  test('stopped early ranks everyone by the games that counted, with no title', async () => {
    await start();
    const table = await matchRoom();
    await table.begin();
    await table.playOut();
    await table.next();
    await table.begin();
    const scored = new Map(table.match().standings.map((line) => [line.name, line.total]));
    expect(await table.ann.send('room:matchEnd', { matchId: table.match().id })).toEqual({ ok: true });
    await table.settle();
    const match = table.match();
    expect(match).toMatchObject({ status: 'stopped', played: 1 });
    expect(table.game().result).toBeNull();
    expect(new Map(match.standings.map((line) => [line.name, line.total]))).toEqual(scored);
    expect(match.standings.every((line) => line.rank !== null && line.title === undefined)).toBe(true);
    expect(await table.ann.send('room:again', { gameId: table.game().gameId })).toEqual({
      ok: false,
      error: 'match_over',
    });
  });
});

describe("a match of a setter's words", () => {
  // The setter gives the words of the next game.
  const setWords = (client: TestClient, a: string, b: string) =>
    client.send('impostor:words', { a, b, field: 'music', named: true });

  test('has the chair set new words every game, never a pair twice, and leaves the setter out of the ranking', async () => {
    await start();
    const table = await matchRoom({ setter: true });
    expect(await setWords(table.ann, 'oboe', 'flute')).toEqual({ ok: true });
    // The match is bound to its setter from its first game on, which the view says, so that the
    // setter is asked before handing the chair on or leaving.
    expect(table.match().chairBound).toBe(false);
    await table.begin();
    expect(table.match().chairBound).toBe(true);
    expect(table.game().players.map((player) => player.id)).not.toContain(table.ann.me);
    await table.playOut();
    await table.next();
    expect(table.match().chairBound).toBe(true);
    // The same pair, in either order, in another case or as plurals, has been had.
    for (const [a, b] of [
      ['oboe', 'flute'],
      ['Flute', 'OBOE'],
      ['oboes', 'flutes'],
    ] as const) {
      expect(await setWords(table.ann, a, b)).toEqual({ ok: false, error: 'words_played' });
    }
    expect((table.ann.state?.data as ImpostorRoomData).setterWords).toBeNull();
    expect(await setWords(table.ann, 'oboe', 'clarinet')).toEqual({ ok: true });
    await table.begin();
    await table.playOut();
    const match = table.match();
    expect(match.played).toBe(2);
    expect(match.standings.map((line) => line.playerId)).not.toContain(table.ann.me);
    expect(match.standings).toHaveLength(4);
  });

  test('ends early once the setter has been away for three minutes, after the game in progress', async () => {
    await start();
    const table = await matchRoom({ setter: true });
    const [ann, bob] = table.players as [TestClient, TestClient];
    expect(await setWords(ann, 'oboe', 'flute')).toEqual({ ok: true });
    await table.begin();
    // The setter's phone locks during the game; the chair passes, and the game goes on, and counts.
    ann.close();
    await until(() => !table.room().isOnline(ann.me), 'the setter to be offline');
    server.advance(3 * 60_000);
    server.app.sockets.sweep();
    await bob.waitFor((state) => state.chairId === bob.me, 'the chair to pass');
    expect(table.match()).toMatchObject({ status: 'on', played: 0 });
    table.players.splice(0, 1);
    await table.playOut();
    const match = table.match();
    expect(match).toMatchObject({ status: 'stopped', played: 1 });
    expect(match.standings).toHaveLength(4);
    expect(match.standings.every((line) => line.rank !== null && line.delta !== null)).toBe(true);
  });

  test('ends at once when the setter leaves between two games', async () => {
    await start();
    const table = await matchRoom({ setter: true });
    const [ann, bob] = table.players as [TestClient, TestClient];
    expect(await setWords(ann, 'oboe', 'flute')).toEqual({ ok: true });
    await table.begin();
    table.players.splice(0, 1);
    await table.playOut();
    expect(table.match()).toMatchObject({ status: 'on', played: 1 });
    expect(await ann.send('room:leave', {})).toEqual({ ok: true });
    await bob.waitFor((state) => state.match?.status === 'stopped', 'the match to end');
    expect(bob.state?.chairId).toBe(bob.me);
    expect(table.match()).toMatchObject({ status: 'stopped', played: 1, chairBound: false });
  });

  test('stays on when the chair passes before its first game', async () => {
    await start();
    const table = await matchRoom({ setter: true });
    const [ann, bob] = table.players as [TestClient, TestClient];
    expect(await ann.send('room:chair', { playerId: bob.me })).toEqual({ ok: true });
    await bob.waitFor((state) => state.chairId === bob.me, 'the chair to pass');
    expect(bob.state?.match).toMatchObject({ status: 'on', played: 0 });
  });
});

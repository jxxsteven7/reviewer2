import { RANK_POINTS, type KeywordsRoomData, type KeywordsView, type Team } from '@reviewer2/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { keywordsGame } from '../src/games/keywords';
import { Browser, startServer, TestClient, until, type TestServer } from './helpers';
import { keepGame } from './keptGame';

// Academic ranks over real sockets (docs/architecture.md#academic-ranks): every finished game of
// the team word guessing game puts its points on the records of the players with accounts, and the
// rank that the points hold shows beside their names in the room, as soon as the game has ended.

let server: TestServer;
const clients: TestClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await server.close();
});

const track = (client: TestClient) => {
  clients.push(client);
  return client;
};

const data = (client: TestClient) => client.state?.data as KeywordsRoomData;
const board = (client: TestClient) => data(client).game as KeywordsView;
const moment = (view: KeywordsView) => ({ gameId: view.gameId, turn: view.turn });
const rankOf = (client: TestClient, name: string) => client.state?.players.find((player) => player.name === name)?.rank;

async function settle(everyone: TestClient[]) {
  const rev = Math.max(...everyone.map((client) => client.state?.rev ?? 0));
  for (const client of everyone) await client.waitFor((state) => state.rev >= rev, `rev ${rev}`);
}

describe('academic ranks', () => {
  test('come from the points of every finished game, and show beside the name in the room', async () => {
    server = await startServer({ games: [keywordsGame] });
    // Ann and Bob have accounts: Ann is one game short of a master's degree, Bob has never played.
    const anns = new Browser(server.url);
    const bobs = new Browser(server.url);
    expect((await anns.register('Ann')).body).toEqual({ ok: true });
    expect((await bobs.register('Bob')).body).toEqual({ ok: true });
    keepGame(server.db, 'earlier');
    server.accounts.records.add(1, {
      game: 'keywords',
      gameId: 'earlier',
      side: 'red',
      role: 'captain',
      result: 'won',
      place: 1,
      verdict: 'oral',
      points: RANK_POINTS.master - 1,
    });
    const ann = track(await anns.connect());
    const reply = await ann.send('room:create', { game: 'keywords', language: 'en', fields: ['general'] });
    if (!reply.ok) throw new Error(reply.error);
    const code = reply.code as string;
    await ann.waitFor((state) => state.code === code);
    const bob = track(await bobs.connect());
    expect(await bob.send('room:join', { code, play: false })).toMatchObject({ ok: true });
    const join = async () => {
      const client = track(await TestClient.connect(server.url));
      expect(await client.send('room:join', { code, play: false })).toMatchObject({ ok: true });
      return client;
    };
    // Cat and Dan are guests.
    const [cat, dan] = [await join(), await join()];
    const everyone = [ann, bob, cat, dan];
    await ann.waitFor((state) => state.players.length === 4);
    // The ranks that the players bring, and none for the guests.
    expect(ann.state?.players.map(({ name, rank }) => [name, rank])).toEqual([
      ['Ann', 'undergraduate'],
      ['Bob', 'kindergarten'],
      ['Guest 1', undefined],
      ['Guest 2', undefined],
    ]);

    // Ann and Bob are red, Cat and Dan blue.
    const seat = (client: TestClient, team: Team, role: 'captain' | 'guesser') =>
      client.send('keywords:seat', { team, role });
    expect(await seat(ann, 'red', 'captain')).toEqual({ ok: true });
    expect(await seat(bob, 'red', 'guesser')).toEqual({ ok: true });
    expect(await seat(cat, 'blue', 'captain')).toEqual({ ok: true });
    expect(await seat(dan, 'blue', 'guesser')).toEqual({ ok: true });
    await ann.waitFor((state) => (state.data as KeywordsRoomData).startProblems.length === 0, 'ready');
    expect(await ann.send('room:start', { round: ann.state?.round })).toEqual({ ok: true });
    for (const client of everyone) await client.waitFor((state) => state.phase === 'playing', 'the game');

    // The red group wins either way. If it is on turn, it finds one of its cards and ends the turn,
    // and the blue group reveals Reviewer 2; if the blue group is, it finds one of its cards and then
    // reveals Reviewer 2. The red PI gets a point for each card that red found and 4 for the win,
    // and the red student 3 for the win.
    const team = board(ann).team;
    const play = async (captain: TestClient, guesser: TestClient, find: boolean) => {
      expect(await captain.send('keywords:clue', { ...moment(board(captain)), word: 'Hint', count: 1 })).toEqual({
        ok: true,
      });
      await settle(everyone);
      const cards = board(captain).cards;
      const own = cards.findIndex((card) => !card.revealed && card.color === board(captain).team);
      const reviewer2 = cards.findIndex((card) => card.color === 'reviewer2');
      expect(await guesser.send('keywords:reveal', { ...moment(board(guesser)), card: own })).toEqual({ ok: true });
      await settle(everyone);
      if (find) expect(await guesser.send('keywords:pass', moment(board(guesser)))).toEqual({ ok: true });
      else
        expect(await guesser.send('keywords:reveal', { ...moment(board(guesser)), card: reviewer2 })).toEqual({
          ok: true,
        });
      await settle(everyone);
    };
    if (team === 'red') await play(ann, bob, true);
    await play(cat, dan, false);
    for (const client of everyone) await client.waitFor((state) => state.phase === 'ended', 'the end');

    const points = { Ann: team === 'red' ? 1 + 4 : 4, Bob: team === 'red' ? 1 + 3 : 3 };
    const { records } = server.accounts;
    await until(() => records.points(1) === RANK_POINTS.master - 1 + points.Ann, "Ann's points");
    expect(records.points(2)).toBe(points.Bob);
    // The game went on the records with its points, and once to the replays, to watch again.
    expect(records.view(1).keywords?.recent[0]).toMatchObject({ game: 'keywords', result: 'won', place: 1 });
    expect(server.db.prepare("SELECT count(*) AS count FROM replays WHERE game_id <> 'earlier'").get()).toEqual({
      count: 1,
    });
    // The snapshot that ends the game shows the ranks as they are now: Ann is a master's student
    // either way, with 503 or 504 points, and Bob still a kindergartner, with 3 or 4.
    expect(rankOf(dan, 'Ann')).toBe('master');
    expect(rankOf(dan, 'Bob')).toBe('kindergarten');
    expect((await anns.account())?.points).toBe(records.points(1));
    // A withdrawn game would have counted for nothing, and a game is counted once however often its
    // end is told: the record holds one game from today.
    expect(records.view(1).keywords?.ordinary.games).toBe(2);
  });
});

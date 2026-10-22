import { STREAK_MIN } from '@reviewer2/shared';
import { type KeywordsRoomData, type KeywordsView, type Team } from '@reviewer2/shared/keywords';
import { afterEach, describe, expect, test } from 'vitest';
import { keywordsGame } from '../src/games/keywords';
import { Browser, startServer, TestClient, until, type TestServer } from './helpers';
import { keepGame } from './keptGame';

// Streaks over real sockets (docs/architecture.md#streaks): the end of a game puts the streak it
// brought each player with an account to into the snapshot that ends the game. A winning streak
// of STREAK_MIN games goes to everyone in the room, the screens included; a losing streak goes to
// its player alone; a shorter one goes to nobody; and the waiting room has none.

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

async function settle(everyone: TestClient[]) {
  const rev = Math.max(...everyone.map((client) => client.state?.rev ?? 0));
  for (const client of everyone) await client.waitFor((state) => state.rev >= rev, `rev ${rev}`);
}

// Earlier games on an account's record, in order: a game of the first game lost for each L, won
// for each W, and a game of the fake game lost for each l, which is counted apart, and so breaks
// no streak of the first game.
function history(accountId: number, pattern: string) {
  [...pattern].forEach((result, i) => {
    const game = result === 'l' ? 'test' : 'keywords';
    keepGame(server.db, `earlier-${accountId}-${i}`, { game });
    server.accounts.records.add(accountId, {
      game,
      gameId: `earlier-${accountId}-${i}`,
      side: result === 'W' ? 'red' : 'blue',
      role: 'guesser',
      result: result === 'W' ? 'won' : 'lost',
      place: result === 'W' ? 1 : 2,
      verdict: 'v',
      points: 0,
    });
  });
}

describe('streaks', () => {
  test('go to the whole room when won, to the player alone when lost, and not at all when short', async () => {
    server = await startServer({ games: [keywordsGame] });
    // Everyone but Dan has an account: Ann (1) and Bob (2) are red, Cat (3) is blue with Dan, and
    // Eve (4) watches, with a screen beside her.
    const browsers = Object.fromEntries(['Ann', 'Bob', 'Cat', 'Eve'].map((name) => [name, new Browser(server.url)]));
    for (const [name, browser] of Object.entries(browsers))
      expect((await browser.register(name)).body).toEqual({ ok: true });
    const ann = track(await (browsers.Ann as Browser).connect());
    const reply = await ann.send('room:create', { game: 'keywords', language: 'en', fields: ['general'] });
    if (!reply.ok) throw new Error(reply.error);
    const code = reply.code as string;
    const roomId = reply.roomId as string;
    await ann.waitFor((state) => state.code === code);
    const join = async (client: TestClient, play = true) => {
      expect(await client.send('room:join', { code, play })).toMatchObject({ ok: true });
      return client;
    };
    const bob = await join(track(await (browsers.Bob as Browser).connect()));
    const cat = await join(track(await (browsers.Cat as Browser).connect()));
    const dan = track(await TestClient.connect(server.url));
    expect(await dan.send('room:join', { code, play: false })).toMatchObject({ ok: true });
    const eve = await join(track(await (browsers.Eve as Browser).connect()), false);
    const screen = track(await TestClient.connect(server.url));
    expect(await screen.send('room:watch', { code, roomId })).toMatchObject({ ok: true });
    const everyone = [ann, bob, cat, dan, eve, screen];
    await ann.waitFor((state) => state.players.length === 5 && state.screens === 1);

    const seat = (client: TestClient, team: Team, role: 'captain' | 'guesser') =>
      client.send('keywords:seat', { team, role });
    expect(await seat(ann, 'red', 'captain')).toEqual({ ok: true });
    expect(await seat(bob, 'red', 'guesser')).toEqual({ ok: true });
    expect(await seat(cat, 'blue', 'captain')).toEqual({ ok: true });
    expect(await seat(dan, 'blue', 'guesser')).toEqual({ ok: true });
    await ann.waitFor((state) => (state.data as KeywordsRoomData).startProblems.length === 0, 'ready');
    expect(await ann.send('room:start', { round: ann.state?.round })).toEqual({ ok: true });
    for (const client of everyone) await client.waitFor((state) => state.phase === 'playing', 'the game');
    // Nothing in a game that is on.
    for (const client of everyone) expect(client.state?.streaks).toEqual([]);

    // The group on turn reveals Reviewer 2 and loses. The records are written before the game
    // ends, once it is known who wins: the winning PI has won twice before, and reaches three; their
    // student has won once, and reaches two, which is too short; the losing PI has lost twice, and
    // reaches three, which is one short of their record of four.
    const loser = board(ann).team;
    const winner = loser === 'red' ? 'blue' : 'red';
    const [winningCaptain, winningGuesser, losingCaptain] = winner === 'red' ? [1, 2, 3] : [3, null, 1];
    history(winningCaptain, 'LWlW');
    if (winningGuesser !== null) history(winningGuesser, 'W');
    history(losingCaptain, 'LLLLWLlL');
    const captain = loser === 'red' ? ann : cat;
    const guesser = loser === 'red' ? bob : dan;
    expect(await captain.send('keywords:clue', { ...moment(board(captain)), word: 'Hint', count: 1 })).toEqual({
      ok: true,
    });
    await settle(everyone);
    const reviewer2 = board(captain).cards.findIndex((card) => card.color === 'reviewer2');
    expect(await guesser.send('keywords:reveal', { ...moment(board(guesser)), card: reviewer2 })).toEqual({ ok: true });
    for (const client of everyone) await client.waitFor((state) => state.phase === 'ended', 'the end');

    const idOf = (client: TestClient) => client.me;
    const cheered = { playerId: idOf(winner === 'red' ? ann : cat), kind: 'wins', length: STREAK_MIN, record: true };
    const lost = { playerId: idOf(loser === 'red' ? ann : cat), kind: 'losses', length: STREAK_MIN, record: false };
    const losingClient = loser === 'red' ? ann : cat;
    const byKind = (streaks: { kind: string }[] | undefined) =>
      [...(streaks ?? [])].sort((a, b) => a.kind.localeCompare(b.kind));
    for (const client of everyone) {
      expect(byKind(client.state?.streaks), client === screen ? 'the screen' : client.me).toEqual(
        client === losingClient ? [lost, cheered] : [cheered],
      );
    }
    const { records } = server.accounts;
    await until(() => records.streaks(winningCaptain).keywords?.wins === STREAK_MIN, "the winner's streak");
    expect(records.streaks(losingCaptain)).toEqual({ keywords: { wins: 1, losses: 4 }, test: { wins: 0, losses: 1 } });
    const summary = await (browsers[winner === 'red' ? 'Ann' : 'Cat'] as Browser).account();
    expect(summary?.streaks).toEqual({ keywords: { wins: STREAK_MIN, losses: 1 }, test: { wins: 0, losses: 1 } });

    // The waiting room has no streaks, and neither has the next game.
    expect(await ann.send('room:again', { gameId: ann.state?.gameId })).toEqual({ ok: true });
    for (const client of everyone) await client.waitFor((state) => state.phase === 'lobby', 'the waiting room');
    for (const client of everyone) expect(client.state?.streaks).toEqual([]);
  });

  test('are neither broken nor lengthened by a game that the chair withdrew', async () => {
    server = await startServer();
    const browser = new Browser(server.url);
    expect((await browser.register('Ann')).body).toEqual({ ok: true });
    const ann = track(await browser.connect());
    const reply = await ann.send('room:create', { game: 'test', language: 'en', fields: ['general'], play: true });
    if (!reply.ok) throw new Error(reply.error);
    await ann.waitFor((state) => state.code === reply.code);
    const bob = track(await TestClient.connect(server.url));
    expect(await bob.send('room:join', { code: reply.code, play: true })).toMatchObject({ ok: true });
    await ann.waitFor((state) => state.players.length === 2);
    // A game, finished (which Ann wins, as the test game is won by everyone who plays; Bob is a
    // guest, with no record) or withdrawn, and the streaks that the snapshot ending it tells of.
    const game = async (end: 'test:finish' | 'room:end') => {
      expect(await ann.send('room:start', { round: ann.state?.round })).toEqual({ ok: true });
      const { gameId } = await ann.waitFor((state) => state.phase === 'playing', 'the game');
      expect(await ann.send(end, end === 'room:end' ? { gameId } : {})).toEqual({ ok: true });
      const { streaks } = await ann.waitFor((state) => state.phase === 'ended', 'the end');
      expect(await ann.send('room:again', { gameId })).toEqual({ ok: true });
      await ann.waitFor((state) => state.phase === 'lobby', 'the waiting room');
      return streaks;
    };
    const { records } = server.accounts;
    // Two wins are nobody's business yet.
    expect(await game('test:finish')).toEqual([]);
    expect(await game('test:finish')).toEqual([]);
    expect(records.streaks(1)).toEqual({ test: { wins: 2, losses: 0 } });
    // A withdrawn game counts for nothing: it tells of no streak and leaves the record as it was.
    expect(await game('room:end')).toEqual([]);
    expect(records.streaks(1)).toEqual({ test: { wins: 2, losses: 0 } });
    expect(records.view(1).test?.ordinary.games).toBe(2);
    // The next win makes three, as if the withdrawn game had never been.
    expect(await game('test:finish')).toEqual([{ playerId: ann.me, kind: 'wins', length: STREAK_MIN, record: true }]);
    expect(records.streaks(1)).toEqual({ test: { wins: STREAK_MIN, losses: 0 } });
  });
});

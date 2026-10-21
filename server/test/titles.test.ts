import { defaultSettings, type KeywordsRoomData, type KeywordsView } from '@reviewer2/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { keywordsGame } from '../src/games/keywords';
import { Browser, startServer, TestClient, until, type TestServer } from './helpers';
import { keepGame } from './keptGame';

// The titles that a game brings, over real sockets (docs/games/keywords.md#titles): a PI who gives
// no clue in time is called out to the room at once, with how many times their account has missed
// the deadline, and gets Forgot to Submit when the game goes on the record; a guest is called out
// without a count and keeps nothing, and a withdrawn game brings nothing. A PI and a student who
// beat the deadline are called out and kept the same way, as deadline heroes.

let server: TestServer;
const clients: TestClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await server.close();
});

const data = (client: TestClient) => client.state?.data as KeywordsRoomData;
const board = (client: TestClient) => data(client).game as KeywordsView;
const moment = (view: KeywordsView) => ({ gameId: view.gameId, turn: view.turn });

async function settle(everyone: TestClient[]) {
  const rev = Math.max(...everyone.map((client) => client.state?.rev ?? 0));
  for (const client of everyone) await client.waitFor((state) => state.rev >= rev, `rev ${rev}`);
}

async function expectOk(reply: Promise<unknown>) {
  expect(await reply).toMatchObject({ ok: true });
}

describe('Forgot to Submit', () => {
  test('is called out to the room at once, counted for an account, and kept when the game ends', async () => {
    server = await startServer({ games: [keywordsGame] });
    // Ann, red's PI, and Bob, her student, have accounts; Ann missed a deadline in an earlier game.
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
      points: 0,
    });
    server.accounts.titles.awardForGame(1, 'keywords', 'missed_deadline', 'earlier', 3);
    const ann = await anns.connect();
    clients.push(ann);
    const settings = { ...defaultSettings('en'), firstClueTime: 30, clueTime: 30, guessTime: 30 };
    const created = await ann.send('room:create', { game: 'keywords', language: 'en', fields: ['general'], settings });
    if (!created.ok) throw new Error(created.error);
    const code = created.code as string;
    await ann.waitFor((state) => state.code === code);
    const bob = await bobs.connect();
    clients.push(bob);
    await expectOk(bob.send('room:join', { code, play: false }));
    // Cat and Dan are guests.
    const join = async () => {
      const client = await TestClient.connect(server.url);
      clients.push(client);
      await expectOk(client.send('room:join', { code, play: false }));
      return client;
    };
    const [cat, dan] = [await join(), await join()];
    const screen = await TestClient.connect(server.url);
    clients.push(screen);
    await expectOk(screen.send('room:watch', { code }));
    const everyone = [ann, bob, cat, dan, screen];
    await expectOk(ann.send('keywords:seat', { team: 'red', role: 'captain' }));
    await expectOk(bob.send('keywords:seat', { team: 'red', role: 'guesser' }));
    await expectOk(cat.send('keywords:seat', { team: 'blue', role: 'captain' }));
    await expectOk(dan.send('keywords:seat', { team: 'blue', role: 'guesser' }));
    await ann.waitFor((state) => (state.data as KeywordsRoomData).startProblems.length === 0, 'ready');
    await expectOk(ann.send('room:start', { round: ann.state?.round }));
    for (const client of everyone) await client.waitFor((state) => state.phase === 'playing', 'the game');

    // Every PI lets the time run out, until Ann has missed twice and it is blue's turn again.
    const missedBy = (who: TestClient) => board(screen).events.filter((event) => event.player === who.me);
    while (missedBy(ann).length < 2 || board(screen).team !== 'blue') {
      const turn = board(screen).turn;
      server.advance(30_000);
      await screen.waitFor((state) => ((state.data as KeywordsRoomData).game as KeywordsView).turn > turn, 'next');
      await settle(everyone);
    }
    // Everyone, the screen included, hears of each miss, with the PI by player ID: Ann's counted
    // after the one on her record, Cat's, a guest's, not at all.
    expect(missedBy(ann).map(({ kind, team, count }) => ({ kind, team, count }))).toEqual([
      { kind: 'missed', team: 'red', count: 2 },
      { kind: 'missed', team: 'red', count: 3 },
    ]);
    expect(missedBy(cat).length).toBeGreaterThan(0);
    for (const event of missedBy(cat)) expect(event).not.toHaveProperty('count');
    for (const client of everyone) expect(board(client).events).toEqual(board(screen).events);

    // Blue reveals Reviewer 2: red wins, and the game goes on the record.
    await expectOk(cat.send('keywords:clue', { ...moment(board(cat)), word: 'Hint', count: 1 }));
    await settle(everyone);
    const reviewer2 = board(cat).cards.findIndex((card) => card.color === 'reviewer2');
    await expectOk(dan.send('keywords:reveal', { ...moment(board(dan)), card: reviewer2 }));
    for (const client of everyone) await client.waitFor((state) => state.phase === 'ended', 'the end');
    await until(() => server.accounts.records.view(1).keywords?.ordinary.games === 2, "Ann's record");
    expect((await anns.account())?.titles).toEqual([{ game: 'keywords', title: 'missed_deadline', count: 3 }]);
    expect((await bobs.account())?.titles).toEqual([]);

    // The next game is withdrawn after Ann misses again: the room hears of it, counted, but her
    // record keeps nothing of it.
    await expectOk(ann.send('room:again', { gameId: ann.state?.gameId }));
    await ann.waitFor((state) => state.phase === 'lobby', 'the waiting room');
    await ann.waitFor((state) => (state.data as KeywordsRoomData).startProblems.length === 0, 'ready');
    await expectOk(ann.send('room:start', { round: ann.state?.round }));
    for (const client of everyone) await client.waitFor((state) => state.phase === 'playing', 'the next game');
    while (missedBy(ann).length < 1) {
      const turn = board(screen).turn;
      server.advance(30_000);
      await screen.waitFor((state) => ((state.data as KeywordsRoomData).game as KeywordsView).turn > turn, 'next');
    }
    expect(missedBy(ann)).toMatchObject([{ count: 4 }]);
    await expectOk(ann.send('room:end', { gameId: board(ann).gameId }));
    for (const client of everyone) await client.waitFor((state) => state.phase === 'ended', 'the end');
    expect((await anns.account())?.titles).toEqual([{ game: 'keywords', title: 'missed_deadline', count: 3 }]);
    expect(server.db.prepare("SELECT count(*) AS n FROM titles WHERE title = 'missed_deadline'").get()).toEqual({
      n: 3,
    });
  });
});

describe('Deadline Hero', () => {
  test('is called out to the room when the card comes, counted for an account, and kept when the game ends', async () => {
    server = await startServer({ games: [keywordsGame] });
    // Ann, red's PI, has been a deadline hero once before; Bob, her student, never.
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
      points: 0,
    });
    server.accounts.titles.awardForGame(1, 'keywords', 'deadline_hero', 'earlier', 2);
    const ann = await anns.connect();
    clients.push(ann);
    const settings = { ...defaultSettings('en'), firstClueTime: 30, clueTime: 30, guessTime: 30 };
    const created = await ann.send('room:create', { game: 'keywords', language: 'en', fields: ['general'], settings });
    if (!created.ok) throw new Error(created.error);
    const code = created.code as string;
    await ann.waitFor((state) => state.code === code);
    const bob = await bobs.connect();
    clients.push(bob);
    await expectOk(bob.send('room:join', { code, play: false }));
    // Cat and Dan are guests.
    const join = async () => {
      const client = await TestClient.connect(server.url);
      clients.push(client);
      await expectOk(client.send('room:join', { code, play: false }));
      return client;
    };
    const [cat, dan] = [await join(), await join()];
    const everyone = [ann, bob, cat, dan];
    await expectOk(ann.send('keywords:seat', { team: 'red', role: 'captain' }));
    await expectOk(bob.send('keywords:seat', { team: 'red', role: 'guesser' }));
    await expectOk(cat.send('keywords:seat', { team: 'blue', role: 'captain' }));
    await expectOk(dan.send('keywords:seat', { team: 'blue', role: 'guesser' }));
    await ann.waitFor((state) => (state.data as KeywordsRoomData).startProblems.length === 0, 'ready');
    await expectOk(ann.send('room:start', { round: ann.state?.round }));
    for (const client of everyone) await client.waitFor((state) => state.phase === 'playing', 'the game');
    if (board(ann).team === 'blue') {
      server.advance(30_000);
      await settle(everyone);
      await ann.waitFor(
        (state) => ((state.data as KeywordsRoomData).game as KeywordsView).team === 'red',
        "red's turn",
      );
    }

    // Ann gives her clue of 2 with 2 seconds left, and Bob reveals one of red's cards with 2 seconds
    // left of the guesses: Bob is a hero at once; Ann once the students have followed her clue to
    // the letter, with the second card, for the second time.
    server.advance(28_000);
    await expectOk(ann.send('keywords:clue', { ...moment(board(ann)), word: 'Hint', count: 2 }));
    await settle(everyone);
    server.advance(28_000);
    const own = (team: 'red' | 'blue') => board(ann).cards.findIndex((card) => card.color === team && !card.revealed);
    await expectOk(bob.send('keywords:reveal', { ...moment(board(bob)), card: own('red') }));
    await settle(everyone);
    const hailed = (client: TestClient) =>
      board(client).events.flatMap(({ kind, player, count }) => (kind === 'hero' ? [{ player, count }] : []));
    for (const client of everyone) expect(hailed(client)).toEqual([{ player: bob.me, count: 1 }]);
    await expectOk(bob.send('keywords:reveal', { ...moment(board(bob)), card: own('red') }));
    await settle(everyone);
    for (const client of everyone) {
      expect(hailed(client)).toEqual([
        { player: bob.me, count: 1 },
        { player: ann.me, count: 2 },
      ]);
    }

    // Red's turn ends; blue reveals Reviewer 2, and the game goes on the record.
    await expectOk(bob.send('keywords:reveal', { ...moment(board(bob)), card: own('blue') }));
    await settle(everyone);
    await expectOk(cat.send('keywords:clue', { ...moment(board(cat)), word: 'Hint', count: 1 }));
    await settle(everyone);
    const reviewer2 = board(cat).cards.findIndex((card) => card.color === 'reviewer2');
    await expectOk(dan.send('keywords:reveal', { ...moment(board(dan)), card: reviewer2 }));
    for (const client of everyone) await client.waitFor((state) => state.phase === 'ended', 'the end');
    await until(() => server.accounts.records.view(1).keywords?.ordinary.games === 2, "Ann's record");
    expect((await anns.account())?.titles).toEqual([{ game: 'keywords', title: 'deadline_hero', count: 2 }]);
    expect((await bobs.account())?.titles).toEqual([{ game: 'keywords', title: 'deadline_hero', count: 1 }]);
  });
});

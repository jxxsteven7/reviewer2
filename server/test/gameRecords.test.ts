import { type ClueRecord, type KeywordsRoomData, type KeywordsView, type Team } from '@reviewer2/shared';
import { afterEach, describe, expect, test } from 'vitest';
import type { GameLogData } from '../src/core/gameLog';
import { keywordsGame } from '../src/games/keywords';
import { fakeGame } from './fakeGame';
import { Browser, startServer, TestClient, until, type TestServer } from './helpers';

// The record of a game over real sockets (docs/architecture.md#game-records): how it ended and what
// kind of game it was, the log of everything that happened in it, which player was which account,
// and the cards a PI meant, which nobody sees before the game is over. Every game is kept, however
// it ended and whoever played in it, but one with words of the chair's own.

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

const kept = () =>
  server.db.prepare('SELECT game_id AS gameId, log FROM replays').all() as { gameId: string; log: string | null }[];
// What kind of game each kept game was.
const kinds = () =>
  server.db
    .prepare(
      'SELECT ending, data IS NOT NULL AS replay, accounts, guests, agents, takeover, in_match AS inMatch, ' +
        'language, fields, version, rules, words, setup, started_at <= ended_at AS ordered FROM replays',
    )
    .all();
const players = () =>
  server.db
    .prepare('SELECT player_id AS playerId, account_id AS accountId FROM game_players ORDER BY account_id')
    .all();

describe('the record of a game of the team word guessing game', () => {
  test("keeps everything that happened, the chat apart, who was whom, and the PI's cards, shown only at the end", async () => {
    server = await startServer({ games: [keywordsGame] });
    // Ann, Bob, Fay and Eve have accounts, in that order; Cat and Dan are guests. Eve only watches.
    const browsers = Object.fromEntries(['Ann', 'Bob', 'Fay', 'Eve'].map((name) => [name, new Browser(server.url)]));
    for (const [name, browser] of Object.entries(browsers)) {
      expect((await browser.register(name)).body).toEqual({ ok: true });
    }
    const ann = track(await (browsers.Ann as Browser).connect());
    const reply = await ann.send('room:create', { game: 'keywords', language: 'en', fields: ['general'] });
    if (!reply.ok) throw new Error(reply.error);
    const code = reply.code as string;
    await ann.waitFor((state) => state.code === code);
    const member = async (name: string, play: boolean) => {
      const browser = browsers[name];
      const client = track(await (browser ? browser.connect() : TestClient.connect(server.url)));
      expect(await client.send('room:join', { code, play, ...(browser ? {} : { name }) })).toMatchObject({ ok: true });
      return client;
    };
    const bob = await member('Bob', true);
    const fay = await member('Fay', true);
    const cat = await member('Cat', true);
    const dan = await member('Dan', true);
    const eve = await member('Eve', false);
    const everyone = [ann, bob, fay, cat, dan, eve];
    await ann.waitFor((state) => state.players.length === 6);

    const seat = (client: TestClient, team: Team, role: 'captain' | 'guesser') =>
      client.send('keywords:seat', { team, role });
    expect(await seat(ann, 'red', 'captain')).toEqual({ ok: true });
    expect(await seat(bob, 'red', 'guesser')).toEqual({ ok: true });
    expect(await seat(fay, 'red', 'guesser')).toEqual({ ok: true });
    expect(await seat(cat, 'blue', 'captain')).toEqual({ ok: true });
    expect(await seat(dan, 'blue', 'guesser')).toEqual({ ok: true });
    await ann.waitFor((state) => (state.data as KeywordsRoomData).startProblems.length === 0, 'ready');
    expect(await ann.send('room:start', { round: ann.state?.round })).toEqual({ ok: true });
    for (const client of everyone) await client.waitFor((state) => state.phase === 'playing', 'the game');

    // The group on turn: its PI marks two of its cards with the clue.
    const team = board(ann).team;
    const captain = team === 'red' ? ann : cat;
    const guesser = team === 'red' ? bob : dan;
    const cards = board(captain).cards;
    const own = cards.flatMap((card, index) => (card.color === team ? [index] : []));
    const targets = [own[1] as number, own[0] as number];
    const clue = { ...moment(board(captain)), word: 'Hint', count: 2, targets };
    expect(await captain.send('keywords:clue', clue)).toEqual({ ok: true });
    await settle(everyone);
    // Nobody sees them while the game is on, the PI included.
    for (const client of everyone) {
      expect(JSON.stringify(client.state), client.state?.me ?? '').not.toContain('targets');
      expect(board(client).history[0]).toMatchObject({ word: 'Hint', captain: captain.state?.me });
    }

    // The group talks it over, chooses a card and reveals it; Fay has her say in her group too; Gus
    // comes to play in the middle of the game, and Fay leaves.
    expect(await guesser.send('keywords:say', { gameId: clue.gameId, text: 'The secret plan' })).toEqual({ ok: true });
    expect(await fay.send('keywords:say', { gameId: clue.gameId, text: 'Fay was here' })).toEqual({ ok: true });
    expect(await guesser.send('keywords:select', { ...moment(board(guesser)), card: targets[0] })).toEqual({
      ok: true,
    });
    expect(await guesser.send('keywords:reveal', { ...moment(board(guesser)), card: targets[0] })).toEqual({
      ok: true,
    });
    await settle(everyone);
    const gus = await member('Gus', true);
    await ann.waitFor((state) => state.players.length === 7, 'Gus here');
    const fayId = fay.state?.me as string;
    expect(await fay.send('room:leave')).toMatchObject({ ok: true });
    await ann.waitFor((state) => state.players.length === 6, 'Fay gone');
    const reviewer2 = cards.findIndex((card) => card.color === 'reviewer2');
    expect(await guesser.send('keywords:reveal', { ...moment(board(guesser)), card: reviewer2 })).toEqual({ ok: true });
    const stayed = everyone.filter((client) => client !== fay);
    for (const client of stayed) await client.waitFor((state) => state.phase === 'ended', 'the end');

    // Once the game is over, everyone sees the cards the PI meant, in the order they were marked.
    for (const client of stayed) {
      expect((board(client).history[0] as ClueRecord).targets, client.state?.me ?? '').toEqual(targets);
    }

    // The record: the replay with its log, and the players with accounts who played, Fay included,
    // by the IDs they had. Eve only watched, and the guests have no account.
    await until(() => kept().length === 1, 'the record');
    expect(players()).toEqual([
      { playerId: ann.state?.me, accountId: 1 },
      { playerId: bob.state?.me, accountId: 2 },
      { playerId: fayId, accountId: 3 },
    ]);
    const log = JSON.parse(kept()[0]?.log as string) as GameLogData;
    expect(log).toMatchObject({ v: 2, game: 'keywords', gameId: clue.gameId });
    // What kind of game it was: finished, with a replay; three players with accounts and three
    // guests, Gus included and Eve, who watched, not.
    const [kind] = kinds() as Record<string, unknown>[];
    expect(kind).toMatchObject({
      ending: 'finished',
      replay: 1,
      accounts: 3,
      guests: 3,
      agents: 0,
      takeover: 0,
      inMatch: 0,
      language: 'en',
      fields: '["general"]',
      version: 'test',
      rules: 1,
      words: expect.stringMatching(/^[0-9a-f]{16}$/),
      ordered: 1,
    });
    // How it began: the board with every color, and the settings.
    const setup = JSON.parse(kind?.setup as string) as { cards: { word: string; color: string }[]; settings: unknown };
    expect(setup.cards).toEqual(cards.map(({ word, color }) => ({ word, color })));
    expect(setup).toMatchObject({ language: 'en', startingTeam: expect.any(String), settings: expect.any(Object) });
    // Where everyone was at the start, Eve, who watched, included.
    expect(log.start?.[fayId]).toEqual({ team: 'red', role: 'guesser' });
    expect(log.start?.[eve.state?.me as string]).toEqual({ team: null, role: 'spectator' });
    const types = log.entries.map((entry) => entry.type);
    expect(types).toEqual(
      expect.arrayContaining(['keywords:clue', 'keywords:say', 'keywords:reveal', 'join', 'leave', 'end']),
    );
    // Not the card chosen before it was revealed, nor who went on or offline.
    expect(types).not.toContain('keywords:select');
    expect(types).not.toContain('online');
    expect(types.indexOf('end')).toBe(types.length - 1);
    expect(log.entries.find((entry) => entry.type === 'keywords:clue')).toMatchObject({
      by: captain.state?.me,
      data: { turn: 1, word: 'Hint', count: 2, targets },
    });
    // Gus went to the group with fewer players, which the log says.
    expect(log.entries.find((entry) => entry.type === 'join')).toEqual({
      t: expect.any(Number),
      by: gus.state?.me,
      type: 'join',
      data: { play: true, seat: { team: 'blue', role: 'guesser' } },
    });
    expect(log.entries.find((entry) => entry.type === 'leave')).toMatchObject({ by: fayId });
    // The times count up from the start of the game.
    const times = log.entries.map((entry) => entry.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // The chat, with what each player said apart.
    const said = (id: string | null | undefined) =>
      log.entries.find((entry) => entry.type === 'keywords:say' && entry.by === id);
    expect(said(guesser.state?.me)).toMatchObject({ said: 'The secret plan' });
    expect(said(fayId)).toMatchObject({ said: 'Fay was here' });
    expect(said(fayId)?.data).toBeUndefined();
    // The game's ID is the log's own, not each message's.
    expect(log.entries.some((entry) => JSON.stringify(entry.data ?? {}).includes('gameId'))).toBe(false);

    // Fay deletes her account: the record no longer says who she was, nor what she said, and keeps
    // the rest, that she said something included.
    const deleted = await (browsers.Fay as Browser).request('/api/account/delete', { password: 'correct horse' });
    expect(deleted.body).toEqual({ ok: true });
    expect(players()).toHaveLength(2);
    expect(kept()[0]?.log).toContain(fayId);
    expect(kept()[0]?.log).not.toContain('Fay was here');
    expect(kept()[0]?.log).toContain('The secret plan');
    const after = JSON.parse(kept()[0]?.log as string) as GameLogData;
    expect(after.entries.find((entry) => entry.type === 'keywords:say' && entry.by === fayId)).toEqual({
      t: expect.any(Number),
      by: fayId,
      type: 'keywords:say',
    });
  });
});

describe('the record of a game', () => {
  // Ann, with an account, and Bob, a guest, play a game of the test game: Ann presses, and someone
  // finishes it, or Ann withdraws it. Ann may come only to watch, leave before the end, or delete
  // her account during the game, which takes her out of the room.
  // Ann, with an account, and Bob, a guest, start a game of the test game, and leave it on, in a
  // room with words of Ann's own if she gives any.
  async function playing(options: { words?: string[] } = {}) {
    const anns = new Browser(server.url);
    expect((await anns.register('Ann')).body).toEqual({ ok: true });
    const ann = track(await anns.connect());
    const reply = await ann.send('room:create', { game: 'test', language: 'en', fields: ['general'], play: true });
    if (!reply.ok) throw new Error(reply.error);
    const bob = track(await TestClient.connect(server.url));
    await bob.send('room:join', { code: reply.code, name: 'Bob', play: true });
    await ann.waitFor((state) => state.players.length === 2);
    if (options.words) {
      expect(await ann.send('room:settings', { words: options.words.join('\n') })).toEqual({ ok: true });
    }
    await ann.send('room:start', { round: 0 });
    await ann.waitFor((state) => state.phase === 'playing');
    return { ann, bob };
  }

  async function played(
    options: {
      press?: string;
      times?: number;
      withdraw?: boolean;
      watch?: boolean;
      leave?: boolean;
      forget?: boolean;
      say?: string;
    } = {},
  ) {
    const anns = new Browser(server.url);
    expect((await anns.register('Ann')).body).toEqual({ ok: true });
    const ann = track(await anns.connect());
    const reply = await ann.send('room:create', {
      game: 'test',
      language: 'en',
      fields: ['general'],
      play: !options.watch,
    });
    if (!reply.ok) throw new Error(reply.error);
    const bob = track(await TestClient.connect(server.url));
    await bob.send('room:join', { code: reply.code, name: 'Bob', play: true });
    await ann.waitFor((state) => state.players.length === 2);
    await ann.send('room:start', { round: 0 });
    const { gameId } = (await ann.waitFor((state) => state.phase === 'playing')) as { gameId: string };
    for (let i = 0; i < (options.times ?? 1); i += 1) await ann.send('test:press', options.press);
    if (options.say !== undefined) await ann.send('test:say', options.say);
    const annId = ann.state?.me as string;
    if (options.leave) expect(await ann.send('room:leave')).toMatchObject({ ok: true });
    if (options.forget) {
      expect((await anns.request('/api/account/delete', { password: 'correct horse' })).body).toEqual({ ok: true });
    }
    if (options.leave || options.forget) await bob.waitFor((state) => state.players.length === 1, 'Ann gone');
    const last = options.leave || options.forget ? bob : ann;
    if (options.withdraw) await last.send('room:end', { gameId });
    else await last.send('test:finish');
    await last.waitFor((state) => state.phase === 'ended');
    return { ann, annId, anns, gameId };
  }

  test('is kept with what the game says of each message, for a guest and an account playing', async () => {
    server = await startServer();
    const { ann } = await played({ press: 'hard' });
    await until(() => kept().length === 1, 'the record');
    const log = JSON.parse(kept()[0]?.log as string) as GameLogData;
    expect(log.entries.map(({ type, by, data: said }) => [type, by, said])).toEqual([
      ['test:press', ann.state?.me, 'hard'],
      ['test:finish', ann.state?.me, undefined],
      ['end', null, undefined],
    ]);
    expect(players()).toEqual([{ playerId: ann.state?.me, accountId: 1 }]);
  });

  test("is kept for a game that the chair withdrew, without a replay, and on nobody's record", async () => {
    server = await startServer();
    const { annId, anns, gameId } = await played({ withdraw: true });
    await until(() => kept().length === 1, 'the record');
    expect(kinds()).toMatchObject([{ ending: 'withdrawn', replay: 0, accounts: 1, guests: 1 }]);
    expect(players()).toEqual([{ playerId: annId, accountId: 1 }]);
    expect(server.db.prepare('SELECT count(*) AS count FROM game_records').get()).toEqual({ count: 0 });
    expect(await anns.request('/api/account/replay', { gameId })).toMatchObject({ status: 404 });
  });

  test('is kept when the one player with an account only watched, as a game of guests', async () => {
    server = await startServer();
    await played({ watch: true });
    await until(() => kept().length === 1, 'the record');
    expect(kinds()).toMatchObject([{ ending: 'finished', replay: 1, accounts: 0, guests: 1 }]);
    expect(players()).toEqual([]);
  });

  test('is kept when the one player with an account left before the end, who still has no replay', async () => {
    server = await startServer();
    const { annId, anns, gameId } = await played({ leave: true });
    await until(() => kept().length === 1, 'the record');
    expect(players()).toEqual([{ playerId: annId, accountId: 1 }]);
    // Ann has no part in the end of the game, so it isn't on her record, and the replay needs that.
    expect(server.db.prepare('SELECT count(*) AS count FROM game_records').get()).toEqual({ count: 0 });
    expect(await anns.request('/api/account/replay', { gameId })).toMatchObject({ status: 404 });
  });

  test('is kept when the one player with an account deleted it during the game, without her and what she said', async () => {
    server = await startServer();
    await played({ say: 'mine alone', forget: true });
    await until(() => kept().length === 1, 'the record');
    expect(players()).toEqual([]);
    expect(kept()[0]?.log).not.toContain('mine alone');
    expect(kept()[0]?.log).toContain('test:say');
  });

  test('is kept for a game cut short when its chair closes the room', async () => {
    server = await startServer();
    const { ann } = await playing();
    expect(await ann.send('room:close')).toMatchObject({ ok: true });
    await until(() => kept().length === 1, 'the record');
    expect(kinds()).toMatchObject([{ ending: 'abandoned', replay: 0, accounts: 1, guests: 1 }]);
    const log = JSON.parse(kept()[0]?.log as string) as GameLogData;
    expect(log.entries.at(-1)).toMatchObject({ type: 'end', data: { ending: 'abandoned', why: 'chair' } });
  });

  test('is kept for a game cut short when everyone leaves', async () => {
    server = await startServer();
    const { ann, bob } = await playing();
    expect(await bob.send('room:leave')).toMatchObject({ ok: true });
    expect(await ann.send('room:leave')).toMatchObject({ ok: true });
    await until(() => kept().length === 1, 'the record');
    expect(kinds()).toMatchObject([{ ending: 'abandoned' }]);
    const log = JSON.parse(kept()[0]?.log as string) as GameLogData;
    expect(log.entries.at(-1)).toMatchObject({ type: 'end', data: { ending: 'abandoned', why: 'empty' } });
    expect(players()).toHaveLength(1);
  });

  test('is kept for a game cut short when the server stops', async () => {
    server = await startServer();
    await playing();
    server.app.sockets.closeAll('restart');
    await until(() => kept().length === 1, 'the record');
    expect(kinds()).toMatchObject([{ ending: 'interrupted', replay: 0 }]);
  });

  test("is not kept for a game with words of the chair's own", async () => {
    server = await startServer();
    const { ann } = await playing({ words: ['Alpha', 'Bravo', 'Charlie', 'Delta'] });
    await ann.send('test:finish');
    await ann.waitFor((state) => state.phase === 'ended');
    // The end of the game has been seen to by now: the snapshot that says so goes after it.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(kept()).toEqual([]);
  });

  test('keeps the replay and the players without a log that grew too long, and says so', async () => {
    server = await startServer({ games: [fakeGame] });
    await played({ press: 'x'.repeat(10_000), times: 14 });
    await until(() => server.logs.some(({ event }) => event === 'game_log_too_large'), 'the log line');
    await until(() => kept().length === 1, 'the record');
    expect(kept()[0]?.log).toBeNull();
    expect(players()).toHaveLength(1);
  });
});

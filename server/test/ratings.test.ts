import { afterEach, describe, expect, test } from 'vitest';
import type { GameModule } from '../src/core/game';
import { fakeGame, type FakeData, type FakeView } from './fakeGame';
import { Browser, loggedIn, startServer, TestClient, until, type TestServer } from './helpers';

// What players say of a game at its end, over real sockets (docs/architecture.md#ratings): a
// rating, which they may change but not take back once they dismissed the question, a guess of who
// the AI players were, and feedback sent from the end of the game, which is kept with it.

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

// The test game, rated once it is finished, and taking any list as a guess of its AI players.
const ratedGame: GameModule<FakeData, FakeView> = {
  ...fakeGame,
  ratings: ['good', 'meh'],
  rated: (data) => data.over,
  guessAgents: (data, _ctx, _playerId, guess) =>
    guess === null || Array.isArray(guess) ? { ok: true, data, guess } : { ok: false, error: 'bad_request' },
};

// Ann, with an account, and Bob, a guest, play a game of the test game to its end, or until Ann,
// the chair, withdraws it, and Cat, with an account, watches.
async function played(finish: 'test:finish' | 'room:end' = 'test:finish') {
  const anns = await loggedIn(server.url, 'Ann');
  const ann = track(await anns.connect());
  const reply = await ann.send('room:create', { game: 'test', language: 'en', fields: ['general'], play: true });
  if (!reply.ok) throw new Error(reply.error);
  const bob = track(await TestClient.connect(server.url));
  await bob.send('room:join', { code: reply.code, play: true });
  const cat = track(await (await loggedIn(server.url, 'Cat')).connect());
  await cat.send('room:join', { code: reply.code, play: false });
  await ann.waitFor((state) => state.players.length === 3);
  await ann.send('room:start', { round: 0 });
  const { gameId } = (await ann.waitFor((state) => state.phase === 'playing')) as { gameId: string };
  await ann.send(finish, finish === 'room:end' ? { gameId } : {});
  await ann.waitFor((state) => state.phase === 'ended');
  await until(() => server.db.prepare('SELECT 1 FROM replays').get() !== undefined, 'the record');
  return { ann, bob, cat, gameId, annId: ann.state?.me as string, bobId: bob.state?.me as string };
}

const ratings = () =>
  server.db.prepare('SELECT game, player_id AS player, rating FROM ratings ORDER BY rated_at, player_id').all();

describe('the end of a game', () => {
  test('asks its players how it was, and keeps what each said, by their player ID', async () => {
    server = await startServer({ games: [ratedGame as unknown as GameModule] });
    const { ann, bob, cat, gameId, annId, bobId } = await played();
    expect(ann.state?.rating).toEqual({ options: ['good', 'meh'], rating: null });
    // Someone who only watched has nothing to rate.
    expect(cat.state?.rating).toBeNull();
    expect(await cat.send('room:rate', { gameId, rating: 'good' })).toEqual({ ok: false, error: 'cannot_rate' });
    expect(await ann.send('room:rate', { gameId, rating: 'meh' })).toEqual({ ok: true });
    expect(await ann.send('room:rate', { gameId, rating: 'good' })).toEqual({ ok: true });
    await ann.waitFor((state) => state.rating?.rating === 'good', 'her rating');
    // A rating the game doesn't have, and one of another game, change nothing.
    expect(await ann.send('room:rate', { gameId, rating: 'awful' })).toEqual({ ok: false, error: 'bad_request' });
    expect(await ann.send('room:rate', { gameId: 'other', rating: 'meh' })).toEqual({ ok: false, error: 'stale' });
    // Bob dismisses the question, which then goes away, and can't be taken back.
    expect(await bob.send('room:rate', { gameId, rating: null })).toEqual({ ok: true });
    await bob.waitFor((state) => state.rating === null, 'the question gone');
    expect(await bob.send('room:rate', { gameId, rating: 'good' })).toEqual({ ok: false, error: 'cannot_rate' });
    expect(ratings()).toEqual(
      expect.arrayContaining([
        { game: 'test', player: annId, rating: 'good' },
        { game: 'test', player: bobId, rating: null },
      ]),
    );
    expect(ratings()).toHaveLength(2);
  });

  test('keeps a guess of who the AI players were once, as the game takes it', async () => {
    server = await startServer({ games: [ratedGame as unknown as GameModule] });
    const { ann, gameId, annId } = await played();
    expect(await ann.send('room:guessAgents', { gameId, guess: { number: 2 } })).toEqual({
      ok: false,
      error: 'bad_request',
    });
    expect(await ann.send('room:guessAgents', { gameId, guess: [2] })).toEqual({ ok: true });
    expect(await ann.send('room:guessAgents', { gameId, guess: [3] })).toEqual({ ok: true });
    expect(server.db.prepare('SELECT player_id AS player, guess FROM ai_guesses').all()).toEqual([
      { player: annId, guess: '[2]' },
    ]);
  });

  test('takes no guess of who the AI players were in a game that the chair withdrew', async () => {
    server = await startServer({ games: [ratedGame as unknown as GameModule] });
    const { ann, bob, gameId } = await played('room:end');
    expect(await ann.send('room:guessAgents', { gameId, guess: [2] })).toEqual({ ok: false, error: 'cannot_guess' });
    expect(await bob.send('room:guessAgents', { gameId, guess: null })).toEqual({ ok: false, error: 'cannot_guess' });
    expect(server.db.prepare('SELECT 1 FROM ai_guesses').all()).toEqual([]);
  });

  test('keeps feedback sent from it with the game, from someone who took part in it alone', async () => {
    server = await startServer({
      games: [ratedGame as unknown as GameModule],
      socketLimits: { feedbackPerWindow: 10 },
    });
    const { ann, bob, cat, gameId } = await played();
    const message = (text: string) => ({
      kind: 'idea',
      text,
      version: 'v',
      language: 'en',
      page: 'room',
      gameId,
    });
    expect(await ann.send('meta:feedback', message('From Ann'))).toEqual({ ok: true });
    expect(await bob.send('meta:feedback', message('From Bob'))).toEqual({ ok: true });
    // Cat only watched, and Zed isn't in the room: theirs is kept about no game.
    expect(await cat.send('meta:feedback', message('From Cat'))).toEqual({ ok: true });
    const zed = track(await new Browser(server.url).connect());
    expect(await zed.send('meta:feedback', message('From Zed'))).toEqual({ ok: true });
    expect(
      server.feedback
        .latest(10)
        .map(({ text, game, gameId: about }) => [text, game, about])
        .reverse(),
    ).toEqual([
      ['From Ann', 'test', gameId],
      ['From Bob', 'test', gameId],
      ['From Cat', null, null],
      ['From Zed', null, null],
    ]);
  });
});

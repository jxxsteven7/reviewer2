import { defaultSettings } from '@reviewer2/shared/impostor';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
// The agent itself, which the server reaches over a socket in production: here it answers in the
// same process, with a model that plays by a script.
import { createAgent } from '../../agent/src/agent';
import type { Model, Question } from '../../agent/src/model';
import type { AgentChannel } from '../src/core/agentChannel';
import { WordLibrary } from '../src/core/words';
import { impostorGame } from '../src/games/impostor';
import { DESCRIBE_PACE_MS } from '../src/games/impostor/agents';
import type { ImpostorData, ImpostorGame } from '../src/games/impostor/state';
import { Browser, startServer, TestClient, until, type TestServer } from './helpers';

// AI players of the hidden word game over real sockets (docs/games/impostor.md#ai-players): a
// person and five AI players play a whole game. What the server asks goes to the agent's own code
// (agent/src/agent.ts) as a line of JSON, and its answer comes back the same way, so that both
// sides read each other with the protocol's schemas, as they do in production; only the language
// model is a script. The server's clock moves only when the test moves it.

// A pair of related terms, in both languages, the only one of its field.
const library = () =>
  new WordLibrary([
    {
      id: 'music',
      name: { zh: 'M', en: 'M' },
      terms: [
        { id: 'violin', en: 'violin', zh: '\u5c0f\u63d0\u7434', related: ['cello'] },
        { id: 'cello', en: 'cello', zh: '\u5927\u63d0\u7434' },
      ],
    },
  ]);

// A model that plays by a script: it describes with lines nobody has said yet, votes for whoever
// `target` names, disagrees with every report, and guesses a word that isn't the students'. It
// keeps the names of the questions it was asked.
class TableModel implements Model {
  readonly name = 'script';
  readonly asked: string[] = [];
  target: () => number = () => 0;
  #lines = 0;

  async ask(question: Question): Promise<Record<string, unknown>> {
    this.asked.push(question.name);
    switch (question.name) {
      case 'describe':
        return { candidates: [1, 2, 3].map(() => `AI line ${(this.#lines += 1)}`) };
      case 'vote':
        return { number: this.target(), reason: 'A hunch.' };
      case 'judge':
        return { verdict: 'disagree', reason: 'The line is fine.' };
      default:
        return { word: 'banjo' };
    }
  }

  async ping(): Promise<boolean> {
    return true;
  }
}

let server: TestServer;
let model: TableModel;
const clients: TestClient[] = [];

beforeEach(async () => {
  model = new TableModel();
  const agent = createAgent({ model, log: () => {}, concurrency: 8, queue: 32 });
  const channel: AgentChannel = { ask: (request) => agent.handle(JSON.stringify(request)) };
  server = await startServer({ games: [impostorGame], words: library(), agent: channel });
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await server.close();
});

// A moment for the agent's answers, which come at once, to be sent on.
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

// Ann, whose account the operator lets have AI players, makes a room that allows a guess after a
// vote-out, invites five of them, and starts a game.
async function aiGame() {
  const browser = new Browser(server.url);
  if (!(await browser.register('Ann')).body.ok) throw new Error('could not register');
  const account = server.accounts.byName('Ann');
  if (!account) throw new Error('no account');
  server.accounts.store.setAgents(account.id, true);
  const ann = await browser.connect();
  clients.push(ann);
  await until(() => server.app.stats().agents?.up === true, 'the agent');
  const made = await ann.send('room:create', {
    game: 'impostor',
    language: 'en',
    fields: ['music'],
    settings: { ...defaultSettings('en'), comeback: true },
    play: true,
  });
  if (!made.ok) throw new Error(`could not make a room: ${made.error}`);
  const code = made.code as string;
  await ann.waitFor((state) => state.code === code, 'the room');
  for (let added = 0; added < 5; added += 1) {
    expect(await ann.send('room:addAgent', { persona: 'reviewer1', seat: null })).toMatchObject({ ok: true });
  }
  await ann.waitFor((state) => state.players.length === 6, 'the AI players');
  expect(await ann.send('room:start', { round: ann.state?.round })).toEqual({ ok: true });
  await ann.waitFor((state) => state.phase === 'playing', 'the game');
  const game = (): ImpostorGame => {
    const played = (server.app.rooms.find(code)?.data as ImpostorData | undefined)?.game;
    if (!played) throw new Error('no game');
    return played;
  };
  return { ann, code, game };
}

describe('AI players', () => {
  test('describe, vote, judge a report and guess the word, through a whole game with a person', async () => {
    const { ann, game } = await aiGame();
    const me = ann.me as string;
    // Everyone votes out an AI player who isn't a student while there is one, so that it may guess
    // the word, and then anyone who isn't a student.
    const isAi = (id: string) => game().players.find((player) => player.id === id)?.agent === true;
    model.target = () => {
      const suspects = game().players.filter((player) => player.fate === 'alive' && player.role !== 'student');
      return (suspects.find((player) => isAi(player.id)) ?? suspects[0])?.number ?? 0;
    };

    // Ann plays her part, and reports the first line an AI player says, until the game is over.
    let lines = 0;
    let reported = false;
    for (let step = 0; step < 200 && game().phase !== 'over'; step += 1) {
      const now = game();
      const at = { gameId: now.gameId, round: now.round };
      const mine = now.players.find((player) => player.id === me);
      if (now.report) {
        if (now.report.eligible.includes(me) && !Object.hasOwn(now.report.verdicts, me)) {
          await ann.send('impostor:judge', { gameId: now.gameId, verdict: 'disagree' });
        }
      } else if (now.phase === 'comeback') {
        if (now.comeback === me) await ann.send('impostor:comeback', { gameId: now.gameId, word: null });
      } else if (mine?.fate === 'alive') {
        const said = now.lines.findIndex((line) => line.text !== null && isAi(line.by));
        const target = now.players.find((player) => player.id === now.lines[said]?.by);
        if (!reported && said >= 0 && target?.fate === 'alive' && now.phase === 'describe') {
          reported = true;
          const report = { ...at, number: target.number, line: said, reason: 'It says too much.' };
          expect(await ann.send('impostor:report', report)).toEqual({ ok: true });
        } else if ((now.phase === 'describe' || now.phase === 'tie') && now.speaker === me) {
          await ann.send('impostor:describe', { ...at, text: `my line ${(lines += 1)}` });
        } else if ((now.phase === 'vote' || now.phase === 'revote') && !Object.hasOwn(now.pending, me)) {
          await ann.send('impostor:vote', { ...at, number: model.target() });
        }
      }
      await settle();
      server.advance(DESCRIBE_PACE_MS);
      await settle();
    }

    const over = game();
    expect(over.phase).toBe('over');
    expect(over.result?.winner).not.toBeNull();
    // The AI players said their lines, voted, judged Ann's report, which failed, and the first of
    // them voted out guessed the word, wrongly.
    expect(new Set(model.asked)).toEqual(new Set(['describe', 'vote', 'judge', 'comeback']));
    expect(over.lines.filter((line) => isAi(line.by) && line.text?.startsWith('AI line'))).not.toHaveLength(0);
    expect(over.reports).toMatchObject([{ by: me, passed: false }]);
    expect(over.guesses[0]).toMatchObject({ word: 'banjo', correct: false });
    expect(isAi(over.guesses[0]?.by ?? '')).toBe(true);
    // The game is kept with the AI log, every answer in it noted with the prompts of the game.
    await ann.waitFor((state) => state.phase === 'ended', 'the end');
    await until(() => server.db.prepare('SELECT 1 FROM replays').get() !== undefined, 'the record');
    const row = server.db.prepare('SELECT game, agent_log AS agentLog FROM replays').get() as {
      game: string;
      agentLog: string;
    };
    expect(row.game).toBe('impostor');
    const steps = (JSON.parse(row.agentLog) as { steps: { kind: string; note?: { prompt: string } }[] }).steps;
    expect(new Set(steps.map(({ kind }) => kind))).toEqual(new Set(['describe', 'vote', 'judge', 'comeback']));
    expect(steps.every(({ note }) => note?.prompt === 'impostor-1')).toBe(true);
  });
});

describe('the chair', () => {
  test('removes a player by their number, which is all an anonymous game shows of them', async () => {
    const { ann, game } = await aiGame();
    const { gameId } = game();
    const student = game().players.find((player) => player.agent && player.role === 'student');
    if (!student) throw new Error('no AI student');
    expect(await ann.send('room:remove', { seat: { gameId, number: 13 } })).toEqual({
      ok: false,
      error: 'no_such_player',
    });
    expect(await ann.send('room:remove', { seat: { gameId: 'other', number: student.number } })).toEqual({
      ok: false,
      error: 'no_such_player',
    });
    const me = game().players.find((player) => player.id === ann.me);
    expect(await ann.send('room:remove', { seat: { gameId, number: me?.number } })).toEqual({
      ok: false,
      error: 'bad_request',
    });
    expect(await ann.send('room:remove', { seat: { gameId, number: student.number } })).toEqual({ ok: true });
    // The game goes on without them, and counts for no points.
    expect(game().players.find((player) => player.id === student.id)?.fate).toBe('left');
    expect(game()).toMatchObject({ phase: expect.not.stringMatching('over'), removed: true });
  });
});

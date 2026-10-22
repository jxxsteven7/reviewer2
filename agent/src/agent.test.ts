import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_AGENT_REQUEST } from '@reviewer2/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createAgent } from './agent';
import { ModelError, type Answer, type Model, type Question } from './model';
import { allowed, clueRequest, guessRequest, impostorRequest, ScriptedModel } from './testing';

type Logged = [string, Record<string, unknown> | undefined];

function agent(
  model: Model,
  limits: { concurrency?: number; queue?: number; now?: () => number } = {},
  models: { impostor?: ScriptedModel } = {},
) {
  const logged: Logged[] = [];
  const created = createAgent({
    model,
    models,
    log: (event, fields) => logged.push([event, fields]),
    concurrency: limits.concurrency ?? 2,
    queue: limits.queue ?? 32,
    now: limits.now,
  });
  return { ...created, logged };
}

// A model that thinks for as long as it is let, and answers without thinking in `quickMs`, at once
// unless a test says otherwise: three clean clues, a card, or a number.
class ThinkingModel implements Model {
  readonly name = 'thinker';
  readonly reasoning = 'low' as const;
  // Each question, by its kind and whether it let the model think.
  readonly asked: { name: string; think: boolean }[] = [];

  constructor(private readonly quickMs = 0) {}

  async ask(question: Question, signal: AbortSignal): Promise<Answer> {
    this.asked.push({ name: question.name, think: question.think === true });
    await new Promise<void>((resolve, reject) => {
      const timer = question.think ? null : setTimeout(resolve, this.quickMs);
      signal.addEventListener(
        'abort',
        () => {
          if (timer !== null) clearTimeout(timer);
          reject(new ModelError('aborted', true));
        },
        { once: true },
      );
    });
    if (question.name === 'clue') {
      const clues: [string, number[]][] = [
        ['Biology', [6, 7]],
        ['Algebra', [1, 3]],
        ['Chemistry', [4, 8]],
      ];
      return { value: { candidates: clues.map(([clue, targets]) => ({ clue, targets, count: 2 })) }, thinking: null };
    }
    if (question.name === 'guess') return { value: { picks: [6], reason: 'Odd.' }, thinking: null };
    return { value: { number: 3, reason: 'Odd.' }, thinking: null };
  }

  async ping(): Promise<boolean> {
    return true;
  }
}

const clueAnswer = { candidates: [{ clue: 'Biology', targets: [6, 7], count: 2 }] };

describe('a request', () => {
  test('is played as the kind it is', async () => {
    const { handle } = agent(new ScriptedModel({ clue: [clueAnswer], guess: [{ picks: [6], reason: 'Life.' }] }));
    expect(allowed(await handle(JSON.stringify(clueRequest())))).toMatchObject({
      ok: true,
      kind: 'clue',
      word: 'Biology',
    });
    expect(allowed(await handle(JSON.stringify(guessRequest())))).toMatchObject({
      ok: true,
      kind: 'guess',
      picks: [6],
    });
  });

  test('of a game with a model of its own goes to that model, and every other to the first', async () => {
    const first = new ScriptedModel({ clue: [clueAnswer], describe: [{ candidates: ['from the first model'] }] });
    const own = new ScriptedModel({ describe: [{ candidates: ['round and red'] }] }, 'small');
    const { handle } = agent(first, {}, { impostor: own });
    expect(allowed(await handle(JSON.stringify(impostorRequest('describe'))))).toMatchObject({
      ok: true,
      kind: 'describe',
      text: 'round and red',
      note: { model: 'small', prompt: 'impostor-2' },
    });
    expect(allowed(await handle(JSON.stringify(clueRequest())))).toMatchObject({ ok: true, kind: 'clue' });
    expect([first.asked.map(({ name }) => name), own.asked.map(({ name }) => name)]).toEqual([['clue'], ['describe']]);
  });

  test('that is anything but what the protocol allows is refused unread', async () => {
    const model = new ScriptedModel({ clue: [clueAnswer] });
    const { handle } = agent(model);
    const { cards } = clueRequest();
    const refused = [
      '',
      'not json',
      '[]',
      JSON.stringify({ ...clueRequest(), v: 2 }),
      JSON.stringify({ ...clueRequest(), persona: 'reviewer3' }),
      JSON.stringify({ ...clueRequest(), secret: 'x' }),
      JSON.stringify({ ...clueRequest(), cards: cards.slice(1) }),
      JSON.stringify({ ...clueRequest(), cards: [{ ...cards[0], owner: 'x' }, ...cards.slice(1)] }),
      JSON.stringify({ ...clueRequest(), waitMs: 0 }),
      JSON.stringify({ ...clueRequest(), waitMs: 600_000 }),
      JSON.stringify({ ...guessRequest(), clue: undefined }),
      JSON.stringify({ v: 1, kind: 'ping', persona: 'reviewer1' }),
      JSON.stringify({ ...impostorRequest('describe'), game: 'keywords' }),
      JSON.stringify({ ...impostorRequest('vote'), candidates: [13] }),
      JSON.stringify({ ...impostorRequest('judge'), report: undefined }),
    ];
    for (const line of refused)
      expect(await handle(line), line.slice(0, 80)).toEqual({ ok: false, error: 'bad_request' });
    expect(model.asked).toHaveLength(0);
  });

  test('is told whether the model is there', async () => {
    const model = new ScriptedModel({}, 'qwen');
    const { handle } = agent(model);
    expect(allowed(await handle('{"v":1,"kind":"ping"}'))).toEqual({ ok: true, kind: 'ping', model: 'qwen' });
    model.known = false;
    expect(await handle('{"v":1,"kind":"ping"}')).toEqual({ ok: false, error: 'model_failed' });
  });

  test('is told whether every model is there, when a game has its own', async () => {
    const first = new ScriptedModel({}, 'qwen');
    const own = new ScriptedModel({}, 'small');
    const { handle } = agent(first, {}, { impostor: own });
    expect(allowed(await handle('{"v":1,"kind":"ping"}'))).toEqual({ ok: true, kind: 'ping', model: 'qwen, small' });
    own.known = false;
    expect(await handle('{"v":1,"kind":"ping"}')).toEqual({ ok: false, error: 'model_failed' });
  });

  test("is answered with a failure rather than a line the protocol doesn't allow", async () => {
    const { handle, logged } = agent(new ScriptedModel({ clue: [clueAnswer] }, 'm'.repeat(300)));
    expect(await handle(JSON.stringify(clueRequest()))).toEqual({ ok: false, error: 'no_answer' });
    expect(logged.some(([event]) => event === 'error')).toBe(true);
  });

  test('is logged by its kind, time and outcome, and never by what was on the board', async () => {
    const { handle, logged } = agent(new ScriptedModel({ clue: [clueAnswer] }));
    await handle(JSON.stringify(clueRequest()));
    await handle('not json');
    expect(logged).toEqual([
      ['agent_answered', { kind: 'clue', ms: expect.any(Number), ok: true }],
      ['agent_answered', { kind: null, ms: expect.any(Number), ok: false, error: 'bad_request' }],
    ]);
    expect(JSON.stringify(logged)).not.toMatch(/Biology|Protein/);
  });
});

// A model whose first answer waits until it is let go.
function held() {
  let release: (value: unknown) => void = () => {};
  const answer = new Promise((resolve) => (release = resolve));
  return { model: new ScriptedModel({ clue: [answer, clueAnswer, clueAnswer] }), release: () => release(clueAnswer) };
}

describe('the queue', () => {
  test('answers busy at once when it is full', async () => {
    const { model, release } = held();
    const { handle } = agent(model, { concurrency: 1, queue: 1 });
    const first = handle(JSON.stringify(clueRequest()));
    const second = handle(JSON.stringify(clueRequest()));
    expect(await handle(JSON.stringify(clueRequest()))).toEqual({ ok: false, error: 'busy' });
    release();
    expect(await first).toMatchObject({ ok: true });
    expect(await second).toMatchObject({ ok: true });
  });

  test('answers busy to a request as soon as its wait runs out before its turn came', async () => {
    const { model, release } = held();
    const { handle } = agent(model, { concurrency: 1, queue: 4 });
    const first = handle(JSON.stringify(clueRequest()));
    // The second request hears `busy` while the first still holds the model, not once it lets go.
    const second = handle(JSON.stringify(clueRequest({ waitMs: 20 })));
    expect(await second).toEqual({ ok: false, error: 'busy' });
    expect(model.asked).toHaveLength(1);
    // The turn that it gave up goes to the next one.
    const third = handle(JSON.stringify(clueRequest()));
    release();
    expect(await first).toMatchObject({ ok: true });
    expect(await third).toMatchObject({ ok: true });
    expect(model.asked).toHaveLength(2);
  });

  test("stops waiting for the model when the request's wait runs out, which is no fault of the model's", async () => {
    const model = new ScriptedModel({ clue: [new Promise(() => {})] });
    const { handle } = agent(model);
    expect(await handle(JSON.stringify(clueRequest({ waitMs: 30 })))).toMatchObject({
      ok: false,
      error: 'no_answer',
    });
  });

  test('hurries the requests with the model when those waiting would be late otherwise', async () => {
    vi.useFakeTimers();
    try {
      const model = new ThinkingModel();
      const { handle } = agent(model, { concurrency: 2, now: Date.now });
      // Five AI players vote at once, with 27 seconds each: two think, and three wait.
      const votes = Array.from({ length: 5 }, () =>
        handle(JSON.stringify(impostorRequest('vote', { waitMs: 27_000 }))),
      );
      await vi.advanceTimersByTimeAsync(17_900);
      expect(model.asked.map(({ think }) => think)).toEqual([true, true]);
      // At 18 seconds the third in line would be late for its 3 seconds of the model, after the
      // two with it had theirs without thinking and the two before it had theirs: the two stop
      // thinking and answer without, and the rest, with too little time left to think, go without
      // from the start. Every vote is in.
      await vi.advanceTimersByTimeAsync(200);
      expect(model.asked.map(({ think }) => think)).toEqual([true, true, false, false, false, false, false]);
      const answered = await Promise.all(votes);
      expect(answered.map((reply) => (reply.ok && reply.kind === 'vote' ? reply.note : reply))).toEqual([
        expect.objectContaining({ reasoning: 'low', fellBack: true }),
        expect.objectContaining({ reasoning: 'low', fellBack: true }),
        expect.objectContaining({ reasoning: 'off' }),
        expect.objectContaining({ reasoning: 'off' }),
        expect.objectContaining({ reasoning: 'off' }),
      ]);
      // With nobody waiting, a request thinks for as long as its move lets it.
      const alone = handle(JSON.stringify(impostorRequest('vote', { waitMs: 27_000 })));
      await vi.advanceTimersByTimeAsync(20_900);
      expect(model.asked).toHaveLength(8);
      await vi.advanceTimersByTimeAsync(200);
      expect(allowed(await alone)).toMatchObject({ ok: true, note: { reasoning: 'low', fellBack: true } });
    } finally {
      vi.useRealTimers();
    }
  });

  test('stops the rehearsals of a hurried clue too, so that the waiting ones have their turn', async () => {
    vi.useFakeTimers();
    try {
      // Each question without thinking takes the model 1.2 seconds.
      const model = new ThinkingModel(1_200);
      const { handle } = agent(model, { concurrency: 2, now: Date.now });
      // The AI PIs of two rooms think of their clues, with 87 seconds each; two seconds later, an
      // AI student of a third room asks for its guess, with 17.
      const clues = [1, 2].map(() => handle(JSON.stringify(clueRequest({ waitMs: 87_000 }))));
      await vi.advanceTimersByTimeAsync(2_000);
      const guess = handle(JSON.stringify(guessRequest({ waitMs: 17_000 })));
      // At 13 seconds the PIs are hurried: each is asked once without thinking, and gives its clue
      // without rehearsing the three it has to choose from, which would hold the model for long.
      await vi.advanceTimersByTimeAsync(10_900);
      expect(model.asked.map(({ think }) => think)).toEqual([true, true]);
      await vi.advanceTimersByTimeAsync(200);
      expect(model.asked).toEqual([
        { name: 'clue', think: true },
        { name: 'clue', think: true },
        { name: 'clue', think: false },
        { name: 'clue', think: false },
      ]);
      // The student has its turn as soon as the clues are given, and its guess in time.
      await vi.advanceTimersByTimeAsync(1_300);
      expect(model.asked.at(-1)).toEqual({ name: 'guess', think: false });
      await vi.advanceTimersByTimeAsync(1_300);
      expect(allowed(await guess)).toMatchObject({ ok: true, kind: 'guess', picks: [6] });
      for (const reply of await Promise.all(clues)) {
        expect(allowed(reply)).toMatchObject({ ok: true, kind: 'clue', note: { reasoning: 'low', fellBack: true } });
        if (!reply.ok || reply.kind !== 'clue') throw new Error('no clue');
        expect(reply.note.candidates?.map(({ rehearsals }) => rehearsals)).toEqual([undefined, undefined, undefined]);
      }
      expect(model.asked).toHaveLength(5);
    } finally {
      vi.useRealTimers();
    }
  });

  test("leaves the thinking alone for a request that couldn't be answered in time anyway", async () => {
    vi.useFakeTimers();
    try {
      const model = new ThinkingModel();
      const { handle } = agent(model, { concurrency: 1, now: Date.now });
      const thinking = handle(JSON.stringify(impostorRequest('vote', { waitMs: 27_000 })));
      await vi.advanceTimersByTimeAsync(10_000);
      // A request with two seconds left, as one asked again late in a phase, would be late even if
      // the thinking stopped at once: it is busy when its wait ends, and the thinking goes on.
      const late = handle(JSON.stringify(impostorRequest('vote', { waitMs: 2_000 })));
      await vi.advanceTimersByTimeAsync(2_100);
      expect(await late).toEqual({ ok: false, error: 'busy' });
      expect(model.asked.map(({ think }) => think)).toEqual([true]);
      await vi.advanceTimersByTimeAsync(8_800);
      expect(model.asked).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(200);
      expect(allowed(await thinking)).toMatchObject({ ok: true, note: { reasoning: 'low', fellBack: true } });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the socket', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reviewer2-agent-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // Sends what is given over a new connection and reads everything that comes back.
  function exchange(path: string, sent: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let answer = '';
      const socket = connect(path, () => socket.write(sent));
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => (answer += chunk));
      socket.on('error', reject);
      socket.on('close', () => resolve(answer));
    });
  }

  test('answers one line with one line, and reads no further', async () => {
    const { server } = agent(new ScriptedModel({ clue: [clueAnswer, clueAnswer] }));
    const path = join(dir, 'agent.sock');
    await new Promise<void>((resolve) => server.listen(path, resolve));
    try {
      const twice = `${JSON.stringify(clueRequest())}\n${JSON.stringify(clueRequest())}\n`;
      const answer = await exchange(path, twice);
      expect(answer.endsWith('\n')).toBe(true);
      expect(answer.trim().split('\n')).toHaveLength(1);
      expect(JSON.parse(answer)).toMatchObject({ ok: true, word: 'Biology' });
      const long = await exchange(path, 'x'.repeat(MAX_AGENT_REQUEST + 10));
      expect(JSON.parse(long)).toEqual({ ok: false, error: 'bad_request' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('answers busy within the wait of a request that waits its turn, while the game server still listens', async () => {
    const { model, release } = held();
    const { server } = agent(model, { concurrency: 1, queue: 4 });
    const path = join(dir, 'agent.sock');
    await new Promise<void>((resolve) => server.listen(path, resolve));
    try {
      const first = exchange(path, `${JSON.stringify(clueRequest())}\n`);
      // The model has the first request; the second asks to wait 50 ms, and the game server stops
      // listening a moment after that (server/src/core/agentChannel.ts).
      await new Promise((resolve) => setTimeout(resolve, 20));
      const started = performance.now();
      const second = await exchange(path, `${JSON.stringify(clueRequest({ waitMs: 50 }))}\n`);
      expect(performance.now() - started).toBeLessThan(500);
      expect(JSON.parse(second)).toEqual({ ok: false, error: 'busy' });
      release();
      expect(JSON.parse(await first)).toMatchObject({ ok: true, word: 'Biology' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

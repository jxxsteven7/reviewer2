import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_AGENT_REQUEST } from '@reviewer2/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createAgent } from './agent';
import { allowed, clueRequest, guessRequest, ScriptedModel } from './testing';

type Logged = [string, Record<string, unknown> | undefined];

function agent(model: ScriptedModel, limits: { concurrency?: number; queue?: number } = {}) {
  const logged: Logged[] = [];
  const created = createAgent({
    model,
    log: (event, fields) => logged.push([event, fields]),
    concurrency: limits.concurrency ?? 2,
    queue: limits.queue ?? 32,
  });
  return { ...created, logged };
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

  test("is answered with a failure rather than a line the protocol doesn't allow", async () => {
    const { handle, logged } = agent(new ScriptedModel({ clue: [clueAnswer] }, 'm'.repeat(300)));
    expect(await handle(JSON.stringify(clueRequest()))).toEqual({ ok: false, error: 'model_failed' });
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

describe('the queue', () => {
  // A model whose first answer waits until it is let go.
  function held() {
    let release: (value: unknown) => void = () => {};
    const answer = new Promise((resolve) => (release = resolve));
    return { model: new ScriptedModel({ clue: [answer, clueAnswer, clueAnswer] }), release: () => release(clueAnswer) };
  }

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

  test('answers busy to a request whose wait ran out before its turn came', async () => {
    const { model, release } = held();
    const { handle } = agent(model, { concurrency: 1, queue: 4 });
    const first = handle(JSON.stringify(clueRequest()));
    const second = handle(JSON.stringify(clueRequest({ waitMs: 20 })));
    await new Promise((resolve) => setTimeout(resolve, 60));
    release();
    expect(await first).toMatchObject({ ok: true });
    expect(await second).toEqual({ ok: false, error: 'busy' });
    // The turn that it gave up goes to the next one.
    expect(await handle(JSON.stringify(clueRequest()))).toMatchObject({ ok: true });
  });

  test("stops waiting for the model when the request's wait runs out", async () => {
    const model = new ScriptedModel({ clue: [new Promise(() => {})] });
    const { handle } = agent(model);
    expect(await handle(JSON.stringify(clueRequest({ waitMs: 30 })))).toMatchObject({
      ok: false,
      error: 'model_failed',
    });
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
});

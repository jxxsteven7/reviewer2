import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { socketAgent } from './agentChannel';

// The way to the agent over a real Unix socket, with an agent that answers as each test says.

let dir: string;
let path: string;
let server: Server | null;
let received: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reviewer2-agent-'));
  path = join(dir, 'agent.sock');
  server = null;
  received = [];
});

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  rmSync(dir, { recursive: true, force: true });
});

// An agent that answers every request with `answer`, or never when it is null.
async function agentAnswering(answer: string | null): Promise<void> {
  server = createServer((socket) => {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      received.push(chunk);
      if (answer !== null) socket.end(answer);
    });
  });
  await new Promise<void>((resolve) => server?.listen(path, resolve));
}

const ping = { v: 1, kind: 'ping' } as const;

describe('asking the agent', () => {
  test('sends the request on one line and takes an answer that the protocol allows', async () => {
    await agentAnswering('{"ok":true,"kind":"ping","model":"m"}\n');
    expect(await socketAgent(path).ask(ping, 1_000)).toEqual({ ok: true, kind: 'ping', model: 'm' });
    expect(received.join('')).toBe('{"v":1,"kind":"ping"}\n');
  });

  test('takes nothing that the protocol does not allow', async () => {
    await agentAnswering('{"ok":true,"kind":"ping","model":"m","extra":1}\n');
    expect(await socketAgent(path).ask(ping, 1_000)).toEqual({ ok: false, error: 'bad_reply' });
  });

  test('takes no answer that cannot be read, or that is too long', async () => {
    await agentAnswering('not json\n');
    expect(await socketAgent(path).ask(ping, 1_000)).toEqual({ ok: false, error: 'bad_reply' });
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await agentAnswering(`{"ok":false,"error":"busy","pad":"${'x'.repeat(20_000)}"}\n`);
    expect(await socketAgent(path).ask(ping, 1_000)).toEqual({ ok: false, error: 'bad_reply' });
  });

  test('gives up on an agent that does not answer in time, and on one that is not there', async () => {
    await agentAnswering(null);
    expect(await socketAgent(path).ask(ping, 1)).toEqual({ ok: false, error: 'timeout' });
    expect(await socketAgent(join(dir, 'none.sock')).ask(ping, 1_000)).toEqual({ ok: false, error: 'unreachable' });
  }, 10_000);
});

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { DEFAULT_CONCURRENCY, DEFAULT_QUEUE, loadConfig } from './config';

describe('the settings', () => {
  const base = { AGENT_SOCKET: '/run/agent.sock', AGENT_MODEL_URL: 'http://127.0.0.1:11434/v1/', AGENT_MODEL: 'm' };
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reviewer2-agent-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('name the socket, the model and its address', () => {
    expect(loadConfig(base, 1)).toEqual({
      activated: false,
      socket: '/run/agent.sock',
      modelUrl: 'http://127.0.0.1:11434/v1',
      model: 'm',
      modelKey: null,
      concurrency: DEFAULT_CONCURRENCY,
      queue: DEFAULT_QUEUE,
    });
    const activated = loadConfig({ ...base, AGENT_SOCKET: '', LISTEN_FDS: '1', LISTEN_PID: '7' }, 7);
    expect(activated).toMatchObject({ activated: true, socket: null });
  });

  test('take a key, from the environment or from a file, and the limits of the queue', () => {
    expect(loadConfig({ ...base, AGENT_MODEL_KEY: ' k ' }, 1).modelKey).toBe('k');
    const file = join(dir, 'key');
    writeFileSync(file, 'from-file\n');
    expect(loadConfig({ ...base, AGENT_MODEL_KEY_FILE: file }, 1).modelKey).toBe('from-file');
    expect(loadConfig({ ...base, AGENT_CONCURRENCY: '4', AGENT_QUEUE: '0' }, 1)).toMatchObject({
      concurrency: 4,
      queue: 0,
    });
  });

  test('that are wrong stop the agent', () => {
    const wrong = [
      { AGENT_SOCKET: '' },
      { AGENT_SOCKET: `/${'s'.repeat(120)}` },
      { AGENT_MODEL: ' ' },
      { AGENT_MODEL_URL: '' },
      { AGENT_MODEL_URL: 'not an address' },
      { AGENT_MODEL_URL: 'ftp://model.test/v1' },
      { AGENT_MODEL_URL: 'http://model.test/v1?key=1' },
      { AGENT_MODEL_URL: 'http://user:pass@model.test/v1' },
      { AGENT_MODEL_KEY: 'a', AGENT_MODEL_KEY_FILE: '/key' },
      { AGENT_CONCURRENCY: '0' },
      { AGENT_CONCURRENCY: 'two' },
      { AGENT_QUEUE: '-1' },
      { AGENT_QUEUE: '1001' },
    ];
    for (const changes of wrong)
      expect(() => loadConfig({ ...base, ...changes }, 1), JSON.stringify(changes)).toThrow();
  });
});

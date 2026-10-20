import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadConfig } from './config';

// The repository's root, from server/src.
const root = resolve(import.meta.dirname, '..', '..');

// A path relative to the repository's root that leads to a short one. A socket's path can have 107
// bytes at most, which `data/mailer.sock` would go over in a checkout deep in the file system.
const fromRoot = (path: string) => relative(root, path);

describe('PORT', () => {
  test('defaults to 3000 when it is unset, empty or blank', () => {
    expect(loadConfig({}).port).toBe(3000);
    expect(loadConfig({ PORT: '' }).port).toBe(3000);
    expect(loadConfig({ PORT: ' ' }).port).toBe(3000);
  });

  test('is a whole number from 1 to 65535, whatever whitespace is around it', () => {
    for (const port of [1, 3000, 65535]) {
      expect(loadConfig({ PORT: String(port) }).port).toBe(port);
    }
    expect(loadConfig({ PORT: ' 3000 ' }).port).toBe(3000);
  });

  test('anything else stops the server, rather than start it on a port nobody asked for', () => {
    for (const PORT of ['0', '0x0', '0x1F90', '1e3', '3000.5', '-1', '+80', '65536', '30 00', 'http']) {
      expect(() => loadConfig({ PORT }), JSON.stringify(PORT)).toThrow(/PORT must be a whole number from 1 to 65535/);
    }
  });
});

describe('TRUST_PROXY', () => {
  test('is off unless it is switched on', () => {
    for (const TRUST_PROXY of [undefined, '', '0', 'false', 'no', 'off', 'OFF']) {
      expect(loadConfig({ TRUST_PROXY }).trustProxy, String(TRUST_PROXY)).toBe(false);
    }
  });

  test('is on however "yes" is spelled', () => {
    for (const TRUST_PROXY of ['1', 'true', 'TRUE', 'True', 'yes', 'on', ' 1 ']) {
      expect(loadConfig({ TRUST_PROXY }).trustProxy, TRUST_PROXY).toBe(true);
    }
  });

  test('anything else stops the server, rather than leave the proxy untrusted without a word', () => {
    for (const TRUST_PROXY of ['2', 'y', 'enabled', '127.0.0.1', 'loopback']) {
      expect(() => loadConfig({ TRUST_PROXY }), TRUST_PROXY).toThrow(/TRUST_PROXY/);
    }
  });
});

describe('ROOMS_PER_MINUTE', () => {
  test('defaults to 5 when it is unset, empty or blank', () => {
    for (const ROOMS_PER_MINUTE of [undefined, '', ' ']) {
      expect(loadConfig({ ROOMS_PER_MINUTE }).roomsPerMinute, JSON.stringify(ROOMS_PER_MINUTE)).toBe(5);
    }
  });

  test('is a whole number from 1 up, whatever whitespace is around it', () => {
    for (const limit of [1, 1000, Number.MAX_SAFE_INTEGER]) {
      expect(loadConfig({ ROOMS_PER_MINUTE: String(limit) }).roomsPerMinute).toBe(limit);
    }
    expect(loadConfig({ ROOMS_PER_MINUTE: ' 7 ' }).roomsPerMinute).toBe(7);
  });

  test('anything else stops the server, rather than count rooms by some other number', () => {
    for (const ROOMS_PER_MINUTE of ['0', '-1', '+5', '0x5', '1.5', '1e3', '9007199254740992', '5 5', 'many']) {
      expect(() => loadConfig({ ROOMS_PER_MINUTE }), JSON.stringify(ROOMS_PER_MINUTE)).toThrow(
        /ROOMS_PER_MINUTE must be a whole number from 1 up/,
      );
    }
  });
});

describe('STATUS_PORT', () => {
  test('leaves the status port off when it is unset, empty or blank', () => {
    for (const STATUS_PORT of [undefined, '', ' ']) {
      expect(loadConfig({ STATUS_PORT }).statusPort, JSON.stringify(STATUS_PORT)).toBeNull();
    }
  });

  test('is a port, whatever whitespace is around it', () => {
    expect(loadConfig({ STATUS_PORT: '4100' }).statusPort).toBe(4100);
    expect(loadConfig({ STATUS_PORT: ' 4100 ' }).statusPort).toBe(4100);
  });

  test('anything else stops the server, and so does the port of the game', () => {
    for (const STATUS_PORT of ['0', '65536', 'on', '41 00']) {
      expect(() => loadConfig({ STATUS_PORT }), STATUS_PORT).toThrow(
        /STATUS_PORT must be a whole number from 1 to 65535/,
      );
    }
    expect(() => loadConfig({ STATUS_PORT: '3000' })).toThrow(/STATUS_PORT must be another port than PORT/);
    expect(() => loadConfig({ PORT: '4000', STATUS_PORT: '4000' })).toThrow(/STATUS_PORT/);
    expect(loadConfig({ PORT: '4000', STATUS_PORT: '3000' }).statusPort).toBe(3000);
  });
});

describe('FEEDBACK_PER_10_MINUTES', () => {
  test('defaults to 3', () => {
    expect(loadConfig({}).feedbackPerWindow).toBe(3);
    expect(loadConfig({ FEEDBACK_PER_10_MINUTES: ' ' }).feedbackPerWindow).toBe(3);
  });

  test('is a whole number from 1 up', () => {
    expect(loadConfig({ FEEDBACK_PER_10_MINUTES: '1000' }).feedbackPerWindow).toBe(1000);
    for (const value of ['0', '-1', '1.5', 'three']) {
      expect(() => loadConfig({ FEEDBACK_PER_10_MINUTES: value })).toThrow(
        `FEEDBACK_PER_10_MINUTES must be a whole number from 1 up, not "${value}"`,
      );
    }
  });
});

describe('MAX_FEEDBACK', () => {
  test('defaults to 10,000', () => {
    expect(loadConfig({}).maxFeedback).toBe(10_000);
    expect(loadConfig({ MAX_FEEDBACK: ' ' }).maxFeedback).toBe(10_000);
  });

  test('is a whole number from 1 up', () => {
    expect(loadConfig({ MAX_FEEDBACK: '50000' }).maxFeedback).toBe(50_000);
    for (const value of ['0', '-1', '1.5', '1e5', 'many']) {
      expect(() => loadConfig({ MAX_FEEDBACK: value })).toThrow(
        `MAX_FEEDBACK must be a whole number from 1 up, not "${value}"`,
      );
    }
  });
});

describe('ACCOUNTS_PER_HOUR', () => {
  test('defaults to 5', () => {
    expect(loadConfig({}).accountsPerHour).toBe(5);
    expect(loadConfig({ ACCOUNTS_PER_HOUR: ' ' }).accountsPerHour).toBe(5);
  });

  test('is a whole number from 1 up', () => {
    expect(loadConfig({ ACCOUNTS_PER_HOUR: '1000' }).accountsPerHour).toBe(1000);
    for (const value of ['0', '-1', '1.5', 'five']) {
      expect(() => loadConfig({ ACCOUNTS_PER_HOUR: value })).toThrow(
        `ACCOUNTS_PER_HOUR must be a whole number from 1 up, not "${value}"`,
      );
    }
  });
});

describe('MAX_CONNECTIONS_PER_ADDRESS, BUSY_CONNECTIONS and BUSY_MEMORY_MB', () => {
  test('default to 100, 10,000 and a share of the memory that is worked out at the start', () => {
    for (const blank of [undefined, '', ' ']) {
      const config = loadConfig({
        MAX_CONNECTIONS_PER_ADDRESS: blank,
        BUSY_CONNECTIONS: blank,
        BUSY_MEMORY_MB: blank,
      });
      expect(config).toMatchObject({ connectionsPerAddress: 100, busyConnections: 10_000, busyMemoryMb: null });
    }
  });

  test('are whole numbers from 1 up', () => {
    expect(
      loadConfig({ MAX_CONNECTIONS_PER_ADDRESS: '500', BUSY_CONNECTIONS: '2000', BUSY_MEMORY_MB: ' 768 ' }),
    ).toMatchObject({ connectionsPerAddress: 500, busyConnections: 2000, busyMemoryMb: 768 });
    for (const name of ['MAX_CONNECTIONS_PER_ADDRESS', 'BUSY_CONNECTIONS', 'BUSY_MEMORY_MB']) {
      for (const value of ['0', '-1', '1.5', '1e3', 'lots']) {
        expect(() => loadConfig({ [name]: value })).toThrow(`${name} must be a whole number from 1 up, not "${value}"`);
      }
    }
  });
});

describe('COOKIE_SECURE', () => {
  test('is on unless it is switched off', () => {
    for (const COOKIE_SECURE of [undefined, '', ' ', '1', 'true', 'yes', 'on']) {
      expect(loadConfig({ COOKIE_SECURE }).cookieSecure, String(COOKIE_SECURE)).toBe(true);
    }
    for (const COOKIE_SECURE of ['0', 'false', 'no', 'OFF']) {
      expect(loadConfig({ COOKIE_SECURE }).cookieSecure, COOKIE_SECURE).toBe(false);
    }
  });

  test('anything else stops the server', () => {
    for (const COOKIE_SECURE of ['2', 'secure', 'https']) {
      expect(() => loadConfig({ COOKIE_SECURE }), COOKIE_SECURE).toThrow(/COOKIE_SECURE/);
    }
  });
});

describe('the server secret', () => {
  test('is off without SERVER_SECRET or SERVER_SECRET_FILE', () => {
    expect(loadConfig({}).secret).toBeNull();
    expect(loadConfig({ SERVER_SECRET: '  ' }).secret).toBeNull();
  });

  test('comes from the variable or from the file it names, without the space around it', () => {
    const secret = 'k'.repeat(44);
    expect(loadConfig({ SERVER_SECRET: ` ${secret} ` }).secret).toBe(secret);
    const dir = mkdtempSync(join(tmpdir(), 'reviewer2-secret-'));
    try {
      writeFileSync(join(dir, 'secret'), `${secret}\n`);
      expect(loadConfig({ SERVER_SECRET_FILE: join(dir, 'secret') }).secret).toBe(secret);
      expect(() => loadConfig({ SERVER_SECRET_FILE: join(dir, 'missing') })).toThrow(/ENOENT/);
      expect(() => loadConfig({ SERVER_SECRET: secret, SERVER_SECRET_FILE: join(dir, 'secret') })).toThrow(/not both/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('that is too short to be safe stops the server', () => {
    expect(() => loadConfig({ SERVER_SECRET: 'k'.repeat(31) })).toThrow(/at least 32 characters/);
  });
});

describe('MAILER_SOCKET', () => {
  test('is off when unset, and taken from the repository root when it is relative', () => {
    expect(loadConfig({}).mailerSocket).toBeNull();
    expect(loadConfig({ MAILER_SOCKET: '/srv/mail/mailer.sock' }).mailerSocket).toBe('/srv/mail/mailer.sock');
    expect(loadConfig({ MAILER_SOCKET: fromRoot('/run/mail/mailer.sock') }).mailerSocket).toBe('/run/mail/mailer.sock');
  });

  test('is a path that a socket can have', () => {
    expect(() => loadConfig({ MAILER_SOCKET: `/${'x'.repeat(107)}` })).toThrow(/at most 107 bytes/);
  });
});

describe('AGENT_SOCKET', () => {
  test('is off when unset, and taken from the repository root when it is relative', () => {
    expect(loadConfig({}).agentSocket).toBeNull();
    expect(loadConfig({ AGENT_SOCKET: '/srv/agent/agent.sock' }).agentSocket).toBe('/srv/agent/agent.sock');
    expect(loadConfig({ AGENT_SOCKET: fromRoot('/run/agent/agent.sock') }).agentSocket).toBe('/run/agent/agent.sock');
  });

  test('is a path that a socket can have, and says so by its own name', () => {
    expect(() => loadConfig({ AGENT_SOCKET: `/${'x'.repeat(107)}` })).toThrow(
      /AGENT_SOCKET must be .* at most 107 bytes/,
    );
  });
});

describe('DATA_DIR', () => {
  test('keeps the database in memory when it is unset, empty or blank', () => {
    for (const DATA_DIR of [undefined, '', '  ']) {
      expect(loadConfig({ DATA_DIR }).dataDir, JSON.stringify(DATA_DIR)).toBeNull();
    }
  });

  test('is a directory, taken from the repository root when it is relative', () => {
    expect(loadConfig({ DATA_DIR: '/srv/game-data' }).dataDir).toBe('/srv/game-data');
    expect(loadConfig({ DATA_DIR: ' /srv/game-data/ ' }).dataDir).toBe('/srv/game-data');
    expect(loadConfig({ DATA_DIR: 'data' }).dataDir).toBe(join(root, 'data'));
  });
});

describe('CONTENT_DIR', () => {
  test('leaves the lists of thanks as the build bundled them when it is unset, empty or blank', () => {
    for (const CONTENT_DIR of [undefined, '', '  ']) {
      expect(loadConfig({ CONTENT_DIR }).contentDir, JSON.stringify(CONTENT_DIR)).toBeNull();
    }
  });

  test('is a directory, taken from the repository root when it is relative', () => {
    expect(loadConfig({ CONTENT_DIR: ' /srv/lists/ ' }).contentDir).toBe('/srv/lists');
    expect(loadConfig({ CONTENT_DIR: 'lists' }).contentDir).toBe(join(root, 'lists'));
  });
});

describe('settings that are gone', () => {
  test('are ignored, as ADMIN_COMMAND and FEEDBACK_COMMAND are since the status port lost its pages', () => {
    expect(loadConfig({ ADMIN_COMMAND: 'npm run admin --', FEEDBACK_COMMAND: 'triage-feedback' })).toEqual(
      loadConfig({}),
    );
  });
});

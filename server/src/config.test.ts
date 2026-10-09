import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadConfig } from './config';

// The repository's root, from server/src.
const root = resolve(import.meta.dirname, '..', '..');

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
  test('leaves the status page off when it is unset, empty or blank', () => {
    for (const STATUS_PORT of [undefined, '', ' ']) {
      expect(loadConfig({ STATUS_PORT }).statusPort, JSON.stringify(STATUS_PORT)).toBeNull();
    }
  });

  test('is a port, whatever whitespace is around it', () => {
    expect(loadConfig({ STATUS_PORT: '3302' }).statusPort).toBe(3302);
    expect(loadConfig({ STATUS_PORT: ' 3302 ' }).statusPort).toBe(3302);
  });

  test('anything else stops the server, and so does the port of the game', () => {
    for (const STATUS_PORT of ['0', '65536', 'on', '33 02']) {
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

describe('DATA_DIR', () => {
  test('keeps the database in memory when it is unset, empty or blank', () => {
    for (const DATA_DIR of [undefined, '', '  ']) {
      expect(loadConfig({ DATA_DIR }).dataDir, JSON.stringify(DATA_DIR)).toBeNull();
    }
  });

  test('is a directory, taken from the repository root when it is relative', () => {
    expect(loadConfig({ DATA_DIR: '/var/lib/reviewer2' }).dataDir).toBe('/var/lib/reviewer2');
    expect(loadConfig({ DATA_DIR: ' /var/lib/reviewer2/ ' }).dataDir).toBe('/var/lib/reviewer2');
    expect(loadConfig({ DATA_DIR: 'data' }).dataDir).toBe(join(root, 'data'));
  });
});

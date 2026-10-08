import { describe, expect, test } from 'vitest';
import { loadConfig } from './config';

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
      expect(() => loadConfig({ PORT }), JSON.stringify(PORT)).toThrow(/PORT/);
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
    expect(loadConfig({}).roomsPerMinute).toBe(5);
    expect(loadConfig({ ROOMS_PER_MINUTE: '' }).roomsPerMinute).toBe(5);
    expect(loadConfig({ ROOMS_PER_MINUTE: ' ' }).roomsPerMinute).toBe(5);
    expect(loadConfig({ ROOMS_PER_MINUTE: '1000' }).roomsPerMinute).toBe(1000);
    expect(loadConfig({ ROOMS_PER_MINUTE: ' 7 ' }).roomsPerMinute).toBe(7);
  });

  test('anything but a whole number from 1 up stops the server', () => {
    for (const ROOMS_PER_MINUTE of ['0', '-1', '1.5', '1e3', '5 5', 'many']) {
      expect(() => loadConfig({ ROOMS_PER_MINUTE }), JSON.stringify(ROOMS_PER_MINUTE)).toThrow(/ROOMS_PER_MINUTE/);
    }
  });
});

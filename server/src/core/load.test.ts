import { totalmem } from 'node:os';
import { describe, expect, test, vi } from 'vitest';
import { AddressConnections, BusyGauge, memoryLimit, type Load } from './load';

describe('the connections of each address', () => {
  test('admit up to the most an address may have open, each address on its own', () => {
    const open = new AddressConnections(3);
    for (let i = 0; i < 3; i += 1) {
      expect(open.admits('203.0.113.9')).toBe(true);
      open.opened('203.0.113.9');
    }
    expect(open.admits('203.0.113.9')).toBe(false);
    expect(open.admits('198.51.100.7')).toBe(true);
    open.closed('203.0.113.9');
    expect(open.admits('203.0.113.9')).toBe(true);
  });

  test('forget an address once its last connection has closed', () => {
    const open = new AddressConnections(100);
    for (let i = 0; i < 5; i += 1) open.opened('203.0.113.9');
    open.opened('198.51.100.7');
    expect(open.addresses).toBe(2);
    for (let i = 0; i < 5; i += 1) open.closed('203.0.113.9');
    expect(open.count('203.0.113.9')).toBe(0);
    expect(open.addresses).toBe(1);
    open.closed('198.51.100.7');
    expect(open.addresses).toBe(0);
  });
});

describe('a busy server', () => {
  const MB = 2 ** 20;

  function gauge(limits = { connections: 100, memory: 1000 * MB }) {
    const load: Load = { connections: 0, memory: 100 * MB };
    const log = vi.fn();
    return { load, log, busy: new BusyGauge(limits, () => ({ ...load }), log) };
  }

  test('is busy with more connections than the limit, and says so once', () => {
    const { load, log, busy } = gauge();
    load.connections = 100;
    expect(busy.check()).toBe(false);
    load.connections = 101;
    expect(busy.check()).toBe(true);
    expect(busy.check()).toBe(true);
    expect(busy.busy).toBe(true);
    expect(log).toHaveBeenCalledExactlyOnceWith('busy_started', {
      level: 'warn',
      connections: 101,
      memoryMb: 100,
      busyConnections: 100,
      busyMemoryMb: 1000,
    });
  });

  test('is busy with as much memory as the limit', () => {
    const { load, log, busy } = gauge();
    load.memory = 999 * MB;
    expect(busy.check()).toBe(false);
    load.memory = 1000 * MB;
    expect(busy.check()).toBe(true);
    expect(log).toHaveBeenCalledWith('busy_started', expect.objectContaining({ memoryMb: 1000 }));
  });

  test('stays busy until both the connections and the memory are well below their limits', () => {
    const { load, log, busy } = gauge();
    load.connections = 150;
    load.memory = 1200 * MB;
    expect(busy.check()).toBe(true);
    // Below the limits, but not by enough.
    load.connections = 95;
    load.memory = 950 * MB;
    expect(busy.check()).toBe(true);
    load.connections = 80;
    expect(busy.check()).toBe(true);
    load.memory = 899 * MB;
    expect(busy.check()).toBe(false);
    expect(log).toHaveBeenLastCalledWith('busy_ended', {
      connections: 80,
      memoryMb: 899,
      busyConnections: 100,
      busyMemoryMb: 1000,
    });
    expect(log.mock.calls.map(([event]) => event)).toEqual(['busy_started', 'busy_ended']);

    // And busy again, should it come to that.
    load.connections = 101;
    expect(busy.check()).toBe(true);
    expect(log).toHaveBeenCalledTimes(3);
  });

  test("by default, counts against the system's limit on the process's memory, or else the machine's", () => {
    const limit = memoryLimit();
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThanOrEqual(totalmem());
  });
});

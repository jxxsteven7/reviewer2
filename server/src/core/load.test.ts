import { totalmem } from 'node:os';
import { describe, expect, test, vi } from 'vitest';
import {
  AddressConnections,
  BusyGauge,
  defaultBusyMemory,
  heapLimit,
  memoryInUse,
  memoryLimit,
  type Load,
} from './load';

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

  test('count a connection until it closes, and no further', () => {
    const open = new AddressConnections(5);
    for (let i = 0; i < 5; i += 1) open.opened('203.0.113.9');
    expect(open.admits('203.0.113.9')).toBe(false);
    for (let i = 0; i < 5; i += 1) open.closed('203.0.113.9');
    // Closed as often as opened, the address is as new: a close that was counted twice would
    // have left it room for a sixth connection.
    for (let i = 0; i < 5; i += 1) {
      expect(open.admits('203.0.113.9')).toBe(true);
      open.opened('203.0.113.9');
    }
    expect(open.admits('203.0.113.9')).toBe(false);
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

  test("keeps its last answer while the load can't be read, which the log says once", () => {
    const load: Load = { connections: 101, memory: 100 * MB };
    let readable = true;
    const log = vi.fn();
    const busy = new BusyGauge(
      { connections: 100, memory: 1000 * MB },
      () => {
        if (!readable) throw new Error('EMFILE: too many open files');
        return { ...load };
      },
      log,
    );
    expect(busy.check()).toBe(true);
    readable = false;
    expect(busy.check()).toBe(true);
    expect(busy.check()).toBe(true);
    expect(log).toHaveBeenLastCalledWith('error', { where: 'busy', message: 'EMFILE: too many open files' });
    // Read again, the load counts again; unreadable again, the log says so again.
    readable = true;
    load.connections = 0;
    expect(busy.check()).toBe(false);
    readable = false;
    expect(busy.check()).toBe(false);
    expect(log.mock.calls.map(([event]) => event)).toEqual(['busy_started', 'error', 'busy_ended', 'error']);
  });

  test("by default, counts against the system's limit on the process's memory, or else the machine's", () => {
    const limit = memoryLimit();
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThanOrEqual(totalmem());
  });

  test('is busy by default at 90% of the memory the process may use, or of the heap limit if that is less', () => {
    const GB = 2 ** 30;
    expect(defaultBusyMemory(16 * GB, 4 * GB)).toBe(Math.round(0.9 * 4 * GB));
    expect(defaultBusyMemory(512 * MB, 4 * GB)).toBe(Math.round(0.9 * 512 * MB));
    expect(heapLimit()).toBeGreaterThan(0);
    expect(defaultBusyMemory()).toBeLessThanOrEqual(0.9 * Math.min(memoryLimit(), heapLimit()));
  });

  test('judges the memory by what is in use, which comes down again, not by the resident memory', () => {
    const inUse = memoryInUse();
    expect(inUse).toBeGreaterThan(0);
    expect(inUse).toBeLessThan(process.memoryUsage.rss());
    // As Node counts it, give or take what was allocated between the two readings.
    const { heapUsed, external } = process.memoryUsage();
    expect(Math.abs(inUse - (heapUsed + external))).toBeLessThan(MB);
  });
});

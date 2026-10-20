import { describe, expect, test, vi } from 'vitest';
import { MAX_COUNTED_ADDRESSES, Refusals } from './refusals';

describe("the limits' line of the minute", () => {
  test('sums up each limit on one line, with how often it refused and from how many addresses', () => {
    const log = vi.fn();
    const refusals = new Refusals(log);
    for (let i = 0; i < 40; i += 1) refusals.add('messages', '203.0.113.9');
    refusals.add('messages', '2001:db8:1:2::/64');
    refusals.add('rooms', '203.0.113.9');
    refusals.add('passwords', '198.51.100.7');
    refusals.add('passwords', '198.51.100.8');
    refusals.flush();
    expect(log.mock.calls).toEqual([
      ['limited', { level: 'warn', limit: 'messages', count: 41, addresses: 2 }],
      ['limited', { level: 'warn', limit: 'rooms', count: 1, addresses: 1 }],
      ['limited', { level: 'warn', limit: 'passwords', count: 2, addresses: 2 }],
    ]);
  });

  test('names no address', () => {
    const log = vi.fn();
    const refusals = new Refusals(log);
    refusals.add('connections_per_address', '203.0.113.9');
    refusals.add('busy_connections', '2001:db8:1:2::/64');
    refusals.flush();
    const written = JSON.stringify(log.mock.calls);
    expect(written).not.toContain('203.0.113');
    expect(written).not.toContain('2001:db8');
  });

  test('writes nothing for a minute in which nothing was refused, and starts every minute anew', () => {
    const log = vi.fn();
    const refusals = new Refusals(log);
    refusals.flush();
    expect(log).not.toHaveBeenCalled();

    refusals.add('feedback', '203.0.113.9');
    refusals.flush();
    refusals.flush();
    refusals.add('feedback', '198.51.100.7');
    refusals.flush();
    expect(log.mock.calls).toEqual([
      ['limited', { level: 'warn', limit: 'feedback', count: 1, addresses: 1 }],
      ['limited', { level: 'warn', limit: 'feedback', count: 1, addresses: 1 }],
    ]);
  });

  test('stops telling addresses apart past so many, but goes on counting the refusals', () => {
    const log = vi.fn();
    const refusals = new Refusals(log);
    for (let i = 0; i < MAX_COUNTED_ADDRESSES + 50; i += 1) refusals.add('busy_connections', `address ${i}`);
    refusals.flush();
    expect(log).toHaveBeenCalledExactlyOnceWith('limited', {
      level: 'warn',
      limit: 'busy_connections',
      count: MAX_COUNTED_ADDRESSES + 50,
      addresses: MAX_COUNTED_ADDRESSES,
    });
  });
});

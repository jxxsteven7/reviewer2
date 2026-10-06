import { describe, expect, test } from 'vitest';
import { clientIp, groupIp } from './clientIp';
import { CODE_ALPHABET, newCode, parseCode } from './codes';
import { isToken, memberKey, newToken } from './identity';
import { seededRng } from './random';
import { TokenBucket, WindowCounter } from './rateLimit';

describe('room codes', () => {
  test('are 4 characters without I, L, O or U', () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(CODE_ALPHABET).not.toMatch(/[ILOU]/);
    const rng = seededRng(9);
    for (let i = 0; i < 200; i += 1) expect(newCode(rng)).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  test('are read however they are typed', () => {
    expect(parseCode('K7QX')).toBe('K7QX');
    expect(parseCode(' k7qx ')).toBe('K7QX');
    expect(parseCode('R2-K7QX')).toBe('K7QX');
    expect(parseCode('r2-k7 qx')).toBe('K7QX');
    expect(parseCode('lo1O')).toBe('1010');
    expect(parseCode('\uff2b\uff17\uff31\uff38')).toBe('K7QX');
    expect(parseCode('R2AB')).toBe('R2AB');
  });

  test('refuse anything else', () => {
    for (const input of ['', 'K7Q', 'K7QXY', 'KUQX', 'K?QX', 'R2-']) expect(parseCode(input), input).toBeNull();
  });
});

describe('addresses', () => {
  test('come from the connection unless a proxy is trusted', () => {
    const headers = { 'x-forwarded-for': '203.0.113.9, 198.51.100.7' };
    expect(clientIp('10.0.0.2', headers, false)).toBe('10.0.0.2');
    expect(clientIp('10.0.0.2', headers, true)).toBe('198.51.100.7');
    expect(clientIp('10.0.0.2', {}, true)).toBe('10.0.0.2');
    expect(clientIp('10.0.0.2', { 'x-forwarded-for': ['203.0.113.9', '198.51.100.7'] }, true)).toBe('198.51.100.7');
  });

  test('group IPv6 by /64 and unwrap IPv4', () => {
    expect(groupIp('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(groupIp('2001:db8:0:1:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:0:1::/64');
    expect(groupIp('2001:DB8::1')).toBe('2001:db8:0:0::/64');
    expect(groupIp('2001:0db8:0000:0001::')).toBe('2001:db8:0:1::/64');
    expect(groupIp('::1')).toBe('0:0:0:0::/64');
    expect(groupIp('::')).toBe('0:0:0:0::/64');
  });

  test('are the same address however a proxy writes them', () => {
    // With a port, which changes with every connection.
    expect(groupIp('203.0.113.9:4711')).toBe('203.0.113.9');
    expect(groupIp('203.0.113.9:52000')).toBe('203.0.113.9');
    expect(groupIp('[2001:db8:0:1::7]:4711')).toBe('2001:db8:0:1::/64');
    expect(groupIp('[2001:db8:0:1::7]')).toBe('2001:db8:0:1::/64');
    expect(groupIp(' 203.0.113.9 ')).toBe('203.0.113.9');
    // With a zone.
    expect(groupIp('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    // IPv4 inside IPv6, in hexadecimal and written out in full.
    expect(groupIp('::ffff:c000:201')).toBe('192.0.2.1');
    expect(groupIp('0:0:0:0:0:ffff:c000:0201')).toBe('192.0.2.1');
    expect(groupIp('0000:0000:0000:0000:0000:FFFF:192.0.2.1')).toBe('192.0.2.1');
    expect(groupIp('::ffff:c633:6407')).toBe('198.51.100.7');
    // The same four groups in front of another prefix are not IPv4.
    expect(groupIp('64:ff9b::c000:201')).toBe('64:ff9b:0:0::/64');
  });

  test('are never made up from something that is no address', () => {
    for (const text of ['', 'unknown', '_hidden', '203.0.113', '203.0.113.9.1', '2001:db8::1::2', 'example.org:80']) {
      expect(groupIp(text), text).toBeNull();
    }
    // A forwarded entry that is no address leaves the proxy's own address to count.
    expect(clientIp('10.0.0.2', { 'x-forwarded-for': '203.0.113.9, unknown' }, true)).toBe('10.0.0.2');
    // And a connection without any address is counted with the others like it, not let off.
    expect(clientIp(undefined, {}, false)).toBe('unknown');
    expect(clientIp(undefined, { 'x-forwarded-for': 'unknown' }, true)).toBe('unknown');
  });
});

describe('identity', () => {
  test('tokens are 32 random bytes, and member keys are their hashes', () => {
    const token = newToken();
    expect(isToken(token)).toBe(true);
    expect(isToken('short')).toBe(false);
    expect(isToken(42)).toBe(false);
    expect(memberKey(token)).toBe(memberKey(token));
    expect(memberKey(token)).not.toContain(token);
    expect(memberKey(newToken())).not.toBe(memberKey(token));
  });
});

describe('rate limits', () => {
  test('a token bucket allows a burst, then refills over time', () => {
    let time = 0;
    const bucket = new TokenBucket(10, 3, () => time);
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true, false]);
    time += 100;
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
    time += 10_000;
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true, false]);
  });

  test('a window counter limits each key within its window', () => {
    let time = 0;
    const counter = new WindowCounter(2, 1000, () => time);
    counter.add('a');
    counter.add('a');
    expect(counter.allowed('a')).toBe(false);
    expect(counter.allowed('b')).toBe(true);
    time += 1000;
    expect(counter.allowed('a')).toBe(true);
    counter.prune();
  });
});

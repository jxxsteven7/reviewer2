import { describe, expect, test } from 'vitest';
import { clientIp, groupIp } from './clientIp';
import { CODE_ALPHABET, newCode, parseCode } from './codes';
import { cleanName, isToken, memberKey, newToken, sameName } from './identity';
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
  });

  test('group IPv6 by /64 and unwrap IPv4', () => {
    expect(groupIp('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(groupIp('2001:db8:0:1:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:0:1::/64');
    expect(groupIp('2001:DB8::1')).toBe('2001:db8:0:0::/64');
    expect(groupIp('::1')).toBe('0:0:0:0::/64');
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

  test('names are trimmed, folded and limited to 16 characters', () => {
    expect(cleanName('  Ann  ')).toBe('Ann');
    expect(cleanName('Ann   Lee')).toBe('Ann Lee');
    expect(cleanName('\uff21\uff4e\uff4e')).toBe('Ann');
    expect(cleanName('x'.repeat(16))).toBe('x'.repeat(16));
    expect(cleanName('x'.repeat(17))).toBeNull();
    expect(cleanName('\u{1f469}\u200d\u{1f52c}'.repeat(16))).not.toBeNull();
    for (const bad of ['', '   ', 'A\u200bnn', 'A\u202enn', 'A\nB\u0000']) expect(cleanName(bad), bad).toBeNull();
  });

  test('names that differ only in case clash', () => {
    expect(sameName('Ann', 'ANN')).toBe(true);
    expect(sameName('Ann', 'Anne')).toBe(false);
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

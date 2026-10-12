import { describe, expect, test } from 'vitest';
import { fnv1a } from './hash';

describe('fnv1a', () => {
  test('is the 32-bit FNV-1a hash, unsigned', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
    expect(fnv1a('g1:ann:wins:3')).toBe(fnv1a('g1:ann:wins:3'));
    expect(fnv1a('g1:ann:wins:3')).not.toBe(fnv1a('g2:ann:wins:3'));
  });
});

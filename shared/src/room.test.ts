import { describe, expect, test } from 'vitest';
import { nextChair } from './room';

describe('the next chair', () => {
  test('is the first to have joined among those online, or else among everyone, or nobody', () => {
    const ann = { id: 'ann', online: false };
    const bob = { id: 'bob', online: true };
    const cat = { id: 'cat', online: true };
    expect(nextChair([ann, bob, cat])).toBe('bob');
    expect(nextChair([ann, { ...cat, online: false }])).toBe('ann');
    expect(nextChair([])).toBeNull();
  });
});

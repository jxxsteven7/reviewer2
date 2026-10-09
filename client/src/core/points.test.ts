import { describe, expect, test } from 'vitest';
import { points, signedPoints } from './points';

describe('points', () => {
  test('are shown with a real minus sign', () => {
    expect([7, 0, -2].map(points)).toEqual(['7', '0', '\u22122']);
  });

  test('of one game carry their sign, or a dash for none', () => {
    expect([4, 0, -3, null].map(signedPoints)).toEqual(['+4', '0', '\u22123', '\u2013']);
  });
});

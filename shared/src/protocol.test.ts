import { describe, expect, test } from 'vitest';
import { drawFields } from './protocol';

// Word lists drawn at random: each usable list on the toss of a coin, and one at random when no
// coin lands heads.

// Answers the numbers given, one by one, as a source of randomness.
const answers = (...numbers: number[]) => {
  let next = 0;
  return (below: number) => {
    const number = numbers[next++] ?? 0;
    if (number >= below) throw new Error(`${number} is not below ${below}`);
    return number;
  };
};

describe('drawing word lists', () => {
  test('takes each list whose coin lands heads', () => {
    expect(drawFields(['a', 'b', 'c'], answers(1, 0, 1))).toEqual(['a', 'c']);
    expect(drawFields(['a', 'b', 'c'], answers(1, 1, 1))).toEqual(['a', 'b', 'c']);
  });

  test('takes one list at random when every coin lands tails, and none of none', () => {
    expect(drawFields(['a', 'b', 'c'], answers(0, 0, 0, 2))).toEqual(['c']);
    expect(drawFields(['a'], answers(0, 0))).toEqual(['a']);
    expect(drawFields([], answers())).toEqual([]);
  });
});

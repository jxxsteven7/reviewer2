// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { clearMemory, writeStored } from '../storage';
import { guidePath, keepProgress, readProgress } from './progress';

beforeEach(() => {
  localStorage.clear();
  clearMemory();
});

describe('how far the tutorial has been read', () => {
  test('starts with nothing read', () => {
    expect(readProgress()).toEqual({ chapters: {}, last: null });
  });

  test('keeps the step of each chapter, and the chapter read last', () => {
    keepProgress('student', 3, 12);
    keepProgress('pi', 2, 8);
    expect(readProgress()).toEqual({ chapters: { student: 3, pi: 2 }, last: 'pi' });
    keepProgress('student', 4, 12);
    expect(readProgress()).toEqual({ chapters: { student: 4, pi: 2 }, last: 'student' });
  });

  test('keeps a chapter read to its last step as read, when the reader goes back to an earlier step', () => {
    keepProgress('rules', 7, 7);
    expect(readProgress().chapters.rules).toBe('done');
    keepProgress('rules', 2, 7);
    expect(readProgress().chapters.rules).toBe('done');
  });

  test('drops what it cannot read, and keeps the rest', () => {
    writeStored('r2.guide', JSON.stringify({ chapters: { a: 0, b: 'x', c: 2, d: 'done', e: 1.5 }, last: 5 }));
    expect(readProgress()).toEqual({ chapters: { c: 2, d: 'done' }, last: null });
    writeStored('r2.guide', '[1, 2]');
    expect(readProgress()).toEqual({ chapters: {}, last: null });
    writeStored('r2.guide', 'not JSON');
    expect(readProgress()).toEqual({ chapters: {}, last: null });
  });

  test('works without storage, for as long as the page is open', () => {
    const throwing = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: throwing, setItem: throwing, removeItem: throwing });
    try {
      keepProgress('pi', 5, 8);
      expect(readProgress()).toEqual({ chapters: { pi: 5 }, last: 'pi' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('has an address for each step', () => {
    expect(guidePath('pi', 4)).toBe('/guide/pi/4');
    expect(guidePath('rules')).toBe('/guide/rules/1');
  });
});

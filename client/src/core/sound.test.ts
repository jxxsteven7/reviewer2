// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import { muted, playSound, setMuted } from './sound';
import { readStored } from './storage';

describe('the sounds', () => {
  test('are remembered as off or on, in storage that never throws', () => {
    expect(muted.value).toBe(false);
    setMuted(true);
    expect(muted.value).toBe(true);
    expect(readStored('r2.muted')).toBe('1');
    setMuted(false);
    expect(readStored('r2.muted')).toBe('0');
  });

  test('stay silent, without an error, where the browser has no audio or nobody has touched the page', () => {
    expect(() => playSound('reviewer2')).not.toThrow();
    window.dispatchEvent(new Event('click'));
    expect(() => playSound('waiting')).not.toThrow();
  });
});

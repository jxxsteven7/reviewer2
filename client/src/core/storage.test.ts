import { afterEach, describe, expect, test, vi } from 'vitest';
import { clearMemory, readStored, removeStored, writeStored } from './storage';

function fakeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

const throwing = (): never => {
  throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
};

afterEach(() => {
  vi.unstubAllGlobals();
  clearMemory();
});

describe('storage', () => {
  test('keeps values in localStorage when it works', () => {
    const local = fakeStorage();
    vi.stubGlobal('localStorage', local);
    writeStored('r2.test', 'a');
    expect(local.getItem('r2.test')).toBe('a');
    clearMemory();
    expect(readStored('r2.test')).toBe('a');
    removeStored('r2.test');
    expect(readStored('r2.test')).toBeNull();
  });

  test('falls back to memory when localStorage throws', () => {
    vi.stubGlobal('localStorage', { ...fakeStorage(), getItem: throwing, setItem: throwing, removeItem: throwing });
    expect(() => writeStored('r2.test', 'b')).not.toThrow();
    expect(readStored('r2.test')).toBe('b');
    expect(() => removeStored('r2.test')).not.toThrow();
    expect(readStored('r2.test')).toBeNull();
  });

  test('a value stays removed when localStorage can read but not remove it', () => {
    const local = fakeStorage();
    local.setItem('r2.test', 'old');
    vi.stubGlobal('localStorage', { ...local, getItem: local.getItem, removeItem: throwing });
    expect(readStored('r2.test')).toBe('old');
    removeStored('r2.test');
    expect(readStored('r2.test')).toBeNull();
    writeStored('r2.test', 'new');
    expect(readStored('r2.test')).toBe('new');
  });

  test('falls back to memory when there is no localStorage at all', () => {
    vi.stubGlobal('localStorage', undefined);
    writeStored('r2.test', 'c');
    expect(readStored('r2.test')).toBe('c');
  });

  test('falls back to memory when even looking at localStorage throws', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: throwing });
    try {
      writeStored('r2.test', 'd');
      expect(readStored('r2.test')).toBe('d');
    } finally {
      // @ts-expect-error -- remove the throwing getter again
      delete globalThis.localStorage;
    }
  });
});

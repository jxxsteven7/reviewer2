import { afterEach, expect, test, vi } from 'vitest';
import { forgetScreenRoom, SCREEN_ROOM, storedScreenRoom, storeScreenRoom } from './session';
import { clearMemory, readStored, writeStored } from './storage';

// A localStorage that counts its writes.
function fakeStorage(): Storage & { writes: number } {
  const values = new Map<string, string>();
  return {
    writes: 0,
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem(key, value) {
      this.writes += 1;
      values.set(key, value);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearMemory();
});

test("remembers the room that the browser's screen showed last, and writes it once", () => {
  const local = fakeStorage();
  vi.stubGlobal('localStorage', local);
  // Every snapshot of the room stores it again, and the storage is written for the first alone.
  storeScreenRoom('K7QX', 'room-a');
  storeScreenRoom('K7QX', 'room-a');
  storeScreenRoom('K7QX', 'room-a');
  expect(local.writes).toBe(1);
  expect(storedScreenRoom('K7QX')).toBe('room-a');
  expect(storedScreenRoom('M3PL')).toBeNull();
  // Another room takes its place, so that the browser keeps nothing of the rooms before.
  storeScreenRoom('M3PL', 'room-b');
  expect(local.getItem(SCREEN_ROOM)).toBe('{"code":"M3PL","roomId":"room-b"}');
  expect(storedScreenRoom('K7QX')).toBeNull();
  // Forgetting a room that isn't the one kept leaves it.
  forgetScreenRoom('K7QX');
  expect(storedScreenRoom('M3PL')).toBe('room-b');
  forgetScreenRoom('M3PL');
  expect(storedScreenRoom('M3PL')).toBeNull();
  expect(readStored(SCREEN_ROOM)).toBeNull();
});

test('makes nothing of a value in the storage that it did not write', () => {
  vi.stubGlobal('localStorage', fakeStorage());
  writeStored(SCREEN_ROOM, 'room-a');
  expect(storedScreenRoom('K7QX')).toBeNull();
  writeStored(SCREEN_ROOM, '{"code":"K7QX"}');
  expect(storedScreenRoom('K7QX')).toBeNull();
});

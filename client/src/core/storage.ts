// Browser storage that never throws. Private modes, some in-app browsers and full disks make
// localStorage throw or disappear, and the game must still work then (docs/rules/constraints.md),
// so every read and write goes through here. A value that can't be stored lives in memory for
// the rest of the page's life.

const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // some browsers throw when a page merely looks at localStorage
  }
}

export function readStored(key: string): string | null {
  const remembered = memory.get(key);
  if (remembered !== undefined) return remembered;
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  memory.set(key, value);
  try {
    storage()?.setItem(key, value);
  } catch {
    // memory keeps the value for this page
  }
}

export function removeStored(key: string): void {
  memory.delete(key);
  try {
    storage()?.removeItem(key);
  } catch {
    // nothing to remove
  }
}

// For tests: forget the values kept in memory.
export function clearMemory(): void {
  memory.clear();
}

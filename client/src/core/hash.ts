// FNV-1a over a string, as a 32-bit unsigned number: a quick hash for a choice that must come
// out the same on every page and after every refresh, such as the color of a default avatar
// (avatar.ts), which of its letters a group reads (games/keywords/letters.ts), and which line a
// streak gets (streaks.ts).
export function fnv1a(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

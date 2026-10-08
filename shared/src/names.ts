import { MAX_NAME_INPUT, MAX_NAME_LENGTH } from './protocol';
import { dropHidden, showsSomething, SILENT, textLength, trimMarks, trimStrays } from './text';

// Nicknames (docs/architecture.md). Both sides run these rules: the client while a player types,
// and the server before it lets anyone in or renames them. What shows and what doesn't is decided
// in text.ts, which the chat shares.

// A nickname as it will be shown, or null when it can't be one: empty, too long, or with something
// in it that a reader can't see. Spaces inside are collapsed and full-width forms folded.
export function cleanName(raw: string): string | null {
  if (raw.length > MAX_NAME_INPUT) return null;
  const name = raw.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  // Hidden characters, piles of marks and marks with nothing to sit on are refused, where a chat
  // message would merely lose them: a name is the player's own, and they should see that it isn't
  // what they typed. Two names could also differ only in a hidden character and look the same.
  if (dropHidden(name) !== name || trimMarks(name) !== name || trimStrays(name) !== name) return null;
  if (!showsSomething(name)) return null;
  return textLength(name) <= MAX_NAME_LENGTH ? name : null;
}

// Two names clash when a reader can't tell them apart: when they differ only in case, or only in
// silent characters, which show nothing where no letter or emoji needs them.
const nameKey = (name: string): string => name.replace(SILENT, '').toLocaleLowerCase('en');
export const sameName = (a: string, b: string): boolean => nameKey(a) === nameKey(b);

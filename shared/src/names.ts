import { MAX_NAME_INPUT, MAX_NAME_LENGTH } from './protocol';
import { dropHidden, showsSomething, SILENT, textLength, trimMarks, trimStrays } from './text';

// Nicknames (docs/architecture.md). Both sides run these rules: the client while a player types,
// and the server before it lets anyone in or renames them. What shows and what doesn't is decided
// in text.ts, which the chat shares.

// A name as it will be shown, with what is wrong with it, if anything: empty, too long, as a text
// of more than `maxInput` UTF-16 units is without a look, or with something in it that a reader
// can't see. Spaces inside are collapsed and full-width forms folded. A nickname is one of
// MAX_NAME_LENGTH characters; the name an account gives a friend (friends.ts) is one of its own
// length.
export type NameProblem = 'empty' | 'hidden' | 'too_long';

export function checkName(
  raw: string,
  maxLength = MAX_NAME_LENGTH,
  maxInput = MAX_NAME_INPUT,
): { name: string; problem: NameProblem | null } {
  if (raw.length > maxInput) return { name: '', problem: 'too_long' };
  const name = raw.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (name === '') return { name, problem: 'empty' };
  // Hidden characters, piles of marks and marks with nothing to sit on are refused, where a chat
  // message would merely lose them: a name is the player's own, and they should see that it isn't
  // what they typed. Two names could also differ only in a hidden character and look the same.
  if (dropHidden(name) !== name || trimMarks(name) !== name || trimStrays(name) !== name) {
    return { name, problem: 'hidden' };
  }
  if (!showsSomething(name)) return { name, problem: 'hidden' };
  return { name, problem: textLength(name) <= maxLength ? null : 'too_long' };
}

// A nickname as it will be shown, or null when it can't be one.
export function cleanName(raw: string): string | null {
  const { name, problem } = checkName(raw);
  return problem === null ? name : null;
}

// Two names clash when a reader can't tell them apart: when they differ only in case, or only in
// silent characters, which show nothing where no letter or emoji needs them.
const nameKey = (name: string): string => name.replace(SILENT, '').toLocaleLowerCase('en');
export const sameName = (a: string, b: string): boolean => nameKey(a) === nameKey(b);

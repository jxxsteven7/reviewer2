import { ROOM_CODE_LENGTH } from './protocol';

// Room codes: 4 characters of Crockford's base32, which leaves out I, L, O and U because they are
// easy to confuse. That makes about a million codes. A link looks like /room/K7QX, and the code is
// shown as a manuscript number, R2-K7QX. Both sides read a code that someone typed with
// parseCode(), so that the client never refuses what the server would take.
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE = new RegExp(`^[${CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
const PREFIX = 'R2';

// What people put around and between the characters of a code: spaces, dashes of every kind, the
// minus sign, underscores, and the characters that show nothing, which come along when a code is
// copied from a chat.
const FILLER = /[\s\p{Pd}\u2212_\p{Default_Ignorable_Code_Point}]+/gu;

// Reads a code as someone typed it: in any case and in full-width forms, with or without the R2
// prefix, with anything from FILLER anywhere in it, and with I or L for 1 and O for 0. Returns
// null when it can't be a code.
export function parseCode(input: string): string | null {
  const typed = input.normalize('NFKC').toUpperCase().replace(FILLER, '');
  // "R2" is the prefix only when a whole code follows it: R2AB is a code of its own.
  const prefixed = typed.length === PREFIX.length + ROOM_CODE_LENGTH && typed.startsWith(PREFIX);
  const code = (prefixed ? typed.slice(PREFIX.length) : typed).replace(/[IL]/g, '1').replace(/O/g, '0');
  return CODE.test(code) ? code : null;
}

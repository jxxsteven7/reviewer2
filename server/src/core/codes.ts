import { ROOM_CODE_LENGTH } from '@reviewer2/shared';
import type { Rng } from './random';

// Room codes: 4 characters of Crockford's base32, which leaves out I, L, O and U because they are
// easy to confuse. That makes about a million codes. A link looks like /room/K7QX, and the code is
// shown as a manuscript number, R2-K7QX.
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE = new RegExp(`^[${CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function newCode(rng: Rng): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) code += CODE_ALPHABET[rng.int(CODE_ALPHABET.length)];
  return code;
}

// Reads a code as someone typed it: in any case, with or without the R2- prefix, with spaces or
// dashes, and with I or L for 1 and O for 0. Returns null when it can't be a code.
export function parseCode(input: string): string | null {
  const code = input
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/^R2-/, '')
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  return CODE.test(code) ? code : null;
}

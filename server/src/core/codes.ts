import { CODE_ALPHABET, ROOM_CODE_LENGTH } from '@reviewer2/shared';
import type { Rng } from './random';

// Draws the code of a new room. What a code looks like and how a typed one is read is in the
// shared package (codes.ts there), because the client reads codes too.
export function newCode(rng: Rng): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) code += CODE_ALPHABET[rng.int(CODE_ALPHABET.length)];
  return code;
}

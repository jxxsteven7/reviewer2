import { AVATAR_SIZE, AVATAR_TARGET_BYTES, MAX_AVATAR_BYTES, usernameKey } from '@reviewer2/shared';
import { fnv1a } from './hash';

// Avatars on the page (docs/design.md): always a circle. A player who uploaded none, and every
// guest, gets a default one, drawn here from the name: its first character on a color that the
// name chooses, the same color for the same name everywhere, in any case or width.

// The colors are the tokens --avatar-1 to --avatar-8 in client/src/styles/tokens.css, so that
// another look can change them with the rest; this is how many there are.
export const AVATAR_COLORS = 8;

const segmenter =
  typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

// The first character of a name, as a reader sees it, in capitals where the script has them.
export function initialOf(name: string): string {
  const first = segmenter ? segmenter.segment(name)[Symbol.iterator]().next().value?.segment : [...name][0];
  return (first ?? '?').toLocaleUpperCase();
}

// The color of the name's default avatar, as a CSS value. A hash of the key of the name, so that
// "Ann" and "ANN" get the same color.
export function colorOf(name: string): string {
  return `var(--avatar-${(fnv1a(usernameKey(name)) % AVATAR_COLORS) + 1})`;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

// Encodes the cropped picture for upload: WebP, or JPEG where the browser can't write WebP, as
// Safari can't, at lower and lower quality until it fits in AVATAR_TARGET_BYTES, but no lower than
// 0.5. Encoding afresh leaves out everything else that the photo held, such as where it was taken.
// Null when it can't be made small enough for the server.
export async function encodeAvatar(canvas: HTMLCanvasElement): Promise<Blob | null> {
  if (canvas.width !== AVATAR_SIZE || canvas.height !== AVATAR_SIZE) return null;
  let blob = await toBlob(canvas, 'image/webp', 0.8);
  const webp = blob?.type === 'image/webp';
  const type = webp ? 'image/webp' : 'image/jpeg';
  let quality = webp ? 0.8 : 0.85;
  if (!webp) blob = await toBlob(canvas, type, quality);
  while (blob && blob.size > AVATAR_TARGET_BYTES && quality > 0.5) {
    quality = Math.max(0.5, Math.round((quality - 0.1) * 100) / 100);
    blob = await toBlob(canvas, type, quality);
  }
  return blob && blob.type === type && blob.size <= MAX_AVATAR_BYTES ? blob : null;
}

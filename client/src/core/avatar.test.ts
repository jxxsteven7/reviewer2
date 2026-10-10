import { AVATAR_SIZE, AVATAR_TARGET_BYTES, MAX_AVATAR_BYTES } from '@reviewer2/shared';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { AVATAR_COLORS, colorOf, encodeAvatar, initialOf } from './avatar';

// The tokens of the default avatars and of the ink, read from the stylesheet.
const tokens = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');
const token = (name: string) => tokens.match(new RegExp(`--${name}: (#[0-9a-f]{6});`))?.[1];

describe('the default avatar', () => {
  test('shows the first character of the name, as a reader sees it', () => {
    expect(initialOf('ann')).toBe('A');
    expect(initialOf('\u{5f20}\u{4e09}')).toBe('\u{5f20}');
    expect(initialOf('\u{1f469}\u{200d}\u{1f52c} Lab')).toBe('\u{1f469}\u{200d}\u{1f52c}');
    expect(initialOf('')).toBe('?');
  });

  test('has the same color for the same name, in any case or width', () => {
    expect(colorOf('Ann')).toBe(colorOf('ANN'));
    expect(colorOf('Ann')).toBe(colorOf('\u{ff21}nn'));
    expect(colorOf('Ann')).toMatch(/^var\(--avatar-[1-8]\)$/);
    const colors = new Set(['Ann', 'Bob', 'Cat', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Ida', 'Jo'].map(colorOf));
    expect(colors.size).toBeGreaterThan(3);
  });

  test('has eight colors in the tokens, which the ink initial reads well on, at 4.5:1 or more', () => {
    const channel = (value: number) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (color: string) => {
      const [r, g, b] = [1, 3, 5].map((at) => channel(parseInt(color.slice(at, at + 2), 16))) as [
        number,
        number,
        number,
      ];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ink = luminance(token('ink') ?? '');
    for (let n = 1; n <= AVATAR_COLORS; n += 1) {
      const color = token(`avatar-${n}`);
      expect(color, `--avatar-${n}`).toBeDefined();
      expect((luminance(color ?? '') + 0.05) / (ink + 0.05), color).toBeGreaterThanOrEqual(4.5);
    }
    expect(token(`avatar-${AVATAR_COLORS + 1}`)).toBeUndefined();
  });
});

// A canvas whose encoder writes `size(type, quality)` bytes, and only the types in `types`, as a
// browser writes PNG when it can't write the type it was asked for.
function canvas(
  size: (type: string, quality: number) => number,
  types = ['image/webp', 'image/jpeg'],
  side = AVATAR_SIZE,
) {
  const calls: [string, number][] = [];
  const fake = {
    width: side,
    height: side,
    toBlob(callback: (blob: Blob | null) => void, type: string, quality: number) {
      calls.push([type, quality]);
      const written = types.includes(type) ? type : 'image/png';
      callback(new Blob([new Uint8Array(size(written, quality))], { type: written }));
    },
  };
  return { canvas: fake as unknown as HTMLCanvasElement, calls };
}

describe('an avatar for upload', () => {
  test('is WebP at 0.8 when it fits', async () => {
    const { canvas: target, calls } = canvas(() => 20_000);
    const blob = await encodeAvatar(target);
    expect(blob?.type).toBe('image/webp');
    expect(calls).toEqual([['image/webp', 0.8]]);
  });

  test('is JPEG where the browser can not write WebP, and loses quality until it fits', async () => {
    const { canvas: target, calls } = canvas((_type, quality) => Math.round(quality * 50_000), ['image/jpeg']);
    const blob = await encodeAvatar(target);
    expect(blob?.type).toBe('image/jpeg');
    expect(blob?.size).toBeLessThanOrEqual(AVATAR_TARGET_BYTES);
    expect(calls.map(([type, quality]) => `${type} ${quality}`)).toEqual([
      'image/webp 0.8',
      'image/jpeg 0.85',
      'image/jpeg 0.75',
      'image/jpeg 0.65',
      'image/jpeg 0.55',
    ]);
  });

  test('stops at 0.5, and is sent if the server takes it, or not at all', async () => {
    const big = canvas(() => AVATAR_TARGET_BYTES + 1000);
    expect((await encodeAvatar(big.canvas))?.size).toBe(AVATAR_TARGET_BYTES + 1000);
    expect(big.calls.at(-1)).toEqual(['image/webp', 0.5]);
    expect(await encodeAvatar(canvas(() => MAX_AVATAR_BYTES + 1).canvas)).toBeNull();
    expect(await encodeAvatar(canvas(() => 1000, undefined, 200).canvas)).toBeNull();
  });
});

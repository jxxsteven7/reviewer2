import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { jpeg, webp } from '../../test/images';
import { avatarName, DirectoryAvatars, inspectAvatar, MemoryAvatars } from './avatars';

describe('an upload', () => {
  test('is an avatar when its header says it is a WebP or a JPEG of 256 pixels square', () => {
    expect(inspectAvatar(jpeg())).toBe('jpeg');
    expect(inspectAvatar(webp())).toBe('webp');
    expect(inspectAvatar(webp(256, 256, 'VP8L'))).toBe('webp');
    // The extended format with an alpha channel, as a browser writes a picture with transparency.
    expect(inspectAvatar(webp(256, 256, 'VP8X', 0x10))).toBe('webp');
  });

  test('of another size, or animated, is not', () => {
    for (const [width, height] of [
      [255, 256],
      [256, 512],
      [4096, 4096],
      [1, 1],
    ] as const) {
      expect(inspectAvatar(jpeg(width, height)), `${width}x${height}`).toBeNull();
      expect(inspectAvatar(webp(width, height)), `${width}x${height}`).toBeNull();
    }
    expect(inspectAvatar(webp(256, 256, 'VP8X', 0x02))).toBeNull();
  });

  test('of anything else is not, nor one larger than 64 KB', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"></svg>');
    const html = Buffer.from('<!doctype html><script>alert(1)</script>');
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000001000000010008060000', 'hex');
    const gif = Buffer.from('GIF89a\x00\x01\x00\x01', 'latin1');
    for (const bytes of [svg, html, png, gif, Buffer.alloc(0), jpeg().subarray(0, 30), webp().subarray(0, 100)]) {
      expect(inspectAvatar(bytes)).toBeNull();
    }
    expect(inspectAvatar(jpeg(256, 256, 64 * 1024))).toBeNull();
    expect(inspectAvatar(jpeg(256, 256, 60 * 1024))).toBe('jpeg');
    // A JPEG whose scan starts before any frame header says no size.
    const scanFirst = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]), jpeg().subarray(2)]);
    expect(inspectAvatar(scanFirst)).toBeNull();
  });

  test('that is HTML behind a JPEG header is an avatar to the server, and is served as an image alone', () => {
    // The server doesn't decode; the headers it is served with keep any browser from running it.
    const polyglot = Buffer.concat([jpeg(256, 256, 10), Buffer.from('<script>alert(1)</script>')]);
    expect(inspectAvatar(polyglot)).toBe('jpeg');
  });

  test('is named after what it holds', () => {
    expect(avatarName(jpeg(), 'jpeg')).toMatch(/^[0-9a-f]{64}\.jpg$/);
    expect(avatarName(webp(), 'webp')).toMatch(/^[0-9a-f]{64}\.webp$/);
    expect(avatarName(jpeg(), 'jpeg')).toBe(avatarName(jpeg(), 'jpeg'));
    expect(avatarName(jpeg(256, 256, 10), 'jpeg')).not.toBe(avatarName(jpeg(), 'jpeg'));
  });
});

describe('the avatars in a directory', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reviewer2-avatars-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('are kept once each, read by name, counted and removed', () => {
    const files = new DirectoryAvatars(join(dir, 'avatars'));
    const name = files.save(jpeg(), 'jpeg');
    expect(files.save(jpeg(), 'jpeg')).toBe(name);
    expect(files.read(name)).toEqual(jpeg());
    expect(files.bytes()).toBe(jpeg().length);
    files.save(webp(), 'webp');
    expect(files.names().sort()).toEqual([name, avatarName(webp(), 'webp')].sort());
    files.remove(name);
    expect(files.read(name)).toBeNull();
    expect(files.bytes()).toBe(webp().length);
    // Nothing outside the directory can be named.
    expect(files.read('../avatars.db')).toBeNull();
  });

  test('are counted again on start, without what a write that never finished left', () => {
    const first = new DirectoryAvatars(dir);
    const name = first.save(jpeg(), 'jpeg');
    writeFileSync(join(dir, `${name}.tmp`), 'half a file');
    const again = new DirectoryAvatars(dir);
    expect(again.bytes()).toBe(jpeg().length);
    expect(readdirSync(dir)).toEqual([name]);
  });
});

describe('the avatars in memory', () => {
  test('work the same', () => {
    const files = new MemoryAvatars();
    const name = files.save(webp(), 'webp');
    expect(files.read(name)).toEqual(webp());
    expect(files.bytes()).toBe(webp().length);
    files.remove(name);
    expect(files.names()).toEqual([]);
  });
});

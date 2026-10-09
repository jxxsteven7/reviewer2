import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { AVATAR_SIZE, MAX_AVATAR_BYTES } from '@reviewer2/shared';

// Avatars that players upload (docs/architecture.md). The browser crops and encodes them; the
// server never decodes an image. It only reads the header of a file, which says what it is and how
// large a picture it holds, and takes a WebP or a JPEG of AVATAR_SIZE pixels square, of up to
// MAX_AVATAR_BYTES. So no image decoder runs on the server, and no file can make the phones of the
// other players in a room decode a picture far larger than its bytes.
//
// A file is named after the SHA-256 of what it holds, so that two accounts that upload the same
// picture share it, and the name changes whenever the picture does, which lets browsers keep it
// for good. The name is unguessable without the picture, so that only those who are shown it, the
// owner and the players in the same rooms, can ask for it.

export type AvatarKind = 'webp' | 'jpeg';

const EXTENSIONS: Record<AvatarKind, string> = { webp: 'webp', jpeg: 'jpg' };
export const AVATAR_CONTENT_TYPES: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg' };
export const AVATAR_FILE = /^[0-9a-f]{64}\.(webp|jpg)$/;

// The directory under DATA_DIR that the avatars are kept in.
export const AVATAR_DIR = 'avatars';

// All avatars together may take this much room on the disk.
export const MAX_AVATAR_STORAGE = 2 * 2 ** 30;

interface Size {
  width: number;
  height: number;
}

// The size that a JPEG's frame header gives, which comes after the markers that hold other things,
// such as the tables and the metadata. Null when the file ends or its scan starts before there is
// one.
function jpegSize(bytes: Buffer): Size | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    let marker = bytes[at + 1] as number;
    // A marker may be padded with any number of 0xff.
    while (marker === 0xff && at + 2 < bytes.length) {
      at += 1;
      marker = bytes[at + 1] as number;
    }
    at += 2;
    // Markers that stand alone, without a length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    // The end of the image, or the start of its scan, before any frame header.
    if (marker === 0xd9 || marker === 0xda) return null;
    if (at + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(at);
    if (length < 2) return null;
    // The frame headers: every SOF marker but those that share its range for other things.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (at + 7 > bytes.length) return null;
      return { height: bytes.readUInt16BE(at + 3), width: bytes.readUInt16BE(at + 5) };
    }
    at += length;
  }
  return null;
}

// The size that a WebP's first chunk gives: a lossy picture (VP8), a lossless one (VP8L), or the
// extended format (VP8X), whose header says whether the file is animated, which an avatar isn't.
function webpSize(bytes: Buffer): Size | null {
  if (bytes.length < 30) return null;
  if (bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') return null;
  // The RIFF header says how long the file is.
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) return null;
  const chunk = bytes.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return null;
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    const animated = ((bytes[20] as number) & 0x02) !== 0;
    return animated ? null : { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  }
  return null;
}

// What an upload is, if it can be an avatar: a WebP or a JPEG, by its header, of the size that
// avatars have, and no larger in bytes than they may be.
export function inspectAvatar(bytes: Buffer): AvatarKind | null {
  if (bytes.length > MAX_AVATAR_BYTES) return null;
  const webp = webpSize(bytes);
  const kind: AvatarKind | null = webp ? 'webp' : jpegSize(bytes) ? 'jpeg' : null;
  const size = webp ?? jpegSize(bytes);
  return kind && size && size.width === AVATAR_SIZE && size.height === AVATAR_SIZE ? kind : null;
}

export const avatarName = (bytes: Buffer, kind: AvatarKind): string =>
  `${createHash('sha256').update(bytes).digest('hex')}.${EXTENSIONS[kind]}`;

// Where the avatars are kept: a directory, or memory, for a server whose database is in memory too.
export interface AvatarFiles {
  // Keeps the file, unless one with its name is there already, and returns its name.
  save(bytes: Buffer, kind: AvatarKind): string;
  read(name: string): Buffer | null;
  remove(name: string): void;
  names(): string[];
  // How much room all of them take.
  bytes(): number;
}

export class DirectoryAvatars implements AvatarFiles {
  #bytes = 0;

  // Makes the directory when it isn't there, as the snapshots' is made, and, for the server that
  // owns it, clears away what a write that never finished left behind.
  constructor(
    private readonly dir: string,
    { owner = true } = {},
  ) {
    mkdirSync(dir, { recursive: true });
    if (owner) for (const name of readdirSync(dir)) if (name.endsWith('.tmp')) unlinkSync(join(dir, name));
    for (const name of this.names()) this.#bytes += statSync(join(dir, name)).size;
  }

  save(bytes: Buffer, kind: AvatarKind): string {
    const name = avatarName(bytes, kind);
    const file = join(this.dir, name);
    if (existsSync(file)) return name;
    // Written whole under another name first, so that nobody is ever served half a file.
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, bytes);
    renameSync(temporary, file);
    this.#bytes += bytes.length;
    return name;
  }

  read(name: string): Buffer | null {
    if (!AVATAR_FILE.test(name)) return null;
    try {
      return readFileSync(join(this.dir, name));
    } catch {
      return null;
    }
  }

  remove(name: string): void {
    if (!AVATAR_FILE.test(name)) return;
    const file = join(this.dir, name);
    try {
      const { size } = statSync(file);
      unlinkSync(file);
      this.#bytes -= size;
    } catch {
      // It was gone already.
    }
  }

  names(): string[] {
    return readdirSync(this.dir).filter((name) => AVATAR_FILE.test(name));
  }

  bytes(): number {
    return this.#bytes;
  }
}

export class MemoryAvatars implements AvatarFiles {
  readonly #files = new Map<string, Buffer>();

  save(bytes: Buffer, kind: AvatarKind): string {
    const name = avatarName(bytes, kind);
    if (!this.#files.has(name)) this.#files.set(name, Buffer.from(bytes));
    return name;
  }

  read(name: string): Buffer | null {
    return this.#files.get(name) ?? null;
  }

  remove(name: string): void {
    this.#files.delete(name);
  }

  names(): string[] {
    return [...this.#files.keys()];
  }

  bytes(): number {
    let total = 0;
    for (const file of this.#files.values()) total += file.length;
    return total;
  }
}

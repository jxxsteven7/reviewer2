// Files that look like images to a reader of their headers, for the tests of avatars. The server
// reads no more than the header (accounts/avatars.ts), so what comes after it is filler.

const u32 = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
};

// A baseline JPEG: start of image, a JFIF header, the frame header with the size, and a scan.
export function jpeg(width = 256, height = 256, filler = 2000): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    Buffer.from([0xff, 0xdb, 0x00, 0x04, 0x00, 0x01]),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 3]),
    Buffer.from([1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    Buffer.from([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0]),
    Buffer.alloc(filler, 0x55),
    Buffer.from([0xff, 0xd9]),
  ]);
}

// A WebP of one chunk: lossy (VP8), lossless (VP8L) or extended (VP8X, with `flags`).
export function webp(width = 256, height = 256, chunk: 'VP8 ' | 'VP8L' | 'VP8X' = 'VP8 ', flags = 0): Buffer {
  const data = Buffer.alloc(400, 0x55);
  if (chunk === 'VP8 ') {
    data.writeUIntLE(0, 0, 3);
    data.set([0x9d, 0x01, 0x2a], 3);
    data.writeUInt16LE(width, 6);
    data.writeUInt16LE(height, 8);
  } else if (chunk === 'VP8L') {
    data[0] = 0x2f;
    data.writeUInt32LE(((height - 1) << 14) | (width - 1), 1);
  } else {
    data[0] = flags;
    data.writeUIntLE(width - 1, 4, 3);
    data.writeUIntLE(height - 1, 7, 3);
  }
  const body = Buffer.concat([Buffer.from(chunk, 'latin1'), u32(data.length), data]);
  return Buffer.concat([Buffer.from('RIFF'), u32(4 + body.length), Buffer.from('WEBP'), body]);
}

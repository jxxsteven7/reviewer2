// Writes a gzip copy and a Brotli copy beside every text file in dist/, at the highest
// compression levels. The server sends a copy to the browsers that accept it rather than
// compress the file on every request; see staticFiles in server/src/http.ts.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

// Fonts and images are compressed already. Source maps are left out: only developer tools fetch
// them, and at 1 MB they would take most of the compression time.
const TEXT = /\.(css|html|js|json|svg|txt|webmanifest|xml)$/;

const dist = join(import.meta.dirname, 'dist');
const kB = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;
const total = { files: 0, plain: 0, gzip: 0, brotli: 0 };

for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !TEXT.test(entry.name)) continue;
  const file = join(entry.parentPath, entry.name);
  const plain = readFileSync(file);
  const gzip = gzipSync(plain, { level: constants.Z_BEST_COMPRESSION });
  const brotli = brotliCompressSync(plain, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_SIZE_HINT]: plain.length,
    },
  });
  // A copy that is no smaller than the file, as happens with very small files, would never be the
  // better thing to send.
  if (gzip.length >= plain.length || brotli.length >= plain.length) continue;
  writeFileSync(`${file}.gz`, gzip);
  writeFileSync(`${file}.br`, brotli);
  total.files += 1;
  total.plain += plain.length;
  total.gzip += gzip.length;
  total.brotli += brotli.length;
}

console.log(
  `compressed ${total.files} text files: ${kB(total.plain)}, ${kB(total.gzip)} as gzip, ${kB(total.brotli)} as Brotli`,
);

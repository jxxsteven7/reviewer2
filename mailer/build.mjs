// Bundles the mailer into one CommonJS file, dist/mailer.cjs, which runs on Node alone, like the
// server's build (server/build.mjs). It has no dependencies of its own: it calls the mail service
// with fetch.

import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/mailer.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: true,
  define: { 'import.meta.dirname': '__dirname' },
  logLevel: 'info',
});

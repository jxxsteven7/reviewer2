// Bundles the agent into one CommonJS file, dist/agent.cjs, which runs on Node alone, like the
// server's build (server/build.mjs) and the mailer's. It calls the language model with fetch, and
// the shared rules and schemas go into the bundle with it.

import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/agent.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  define: { 'import.meta.dirname': '__dirname' },
  logLevel: 'info',
});

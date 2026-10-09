// Bundles the server and its dependencies into one CommonJS file, dist/index.cjs, and the
// operator's commands into dist/admin.cjs, so that production needs no node_modules. It is CommonJS because socket.io's dependencies call
// require() for Node's built-in modules, which an ES module bundle can't do.
//
// APP_VERSION, when set, becomes the version that /healthz reports; see docs/development.md.

import { build } from 'esbuild';

await build({
  // The server, and the operator's commands (src/admin.ts).
  entryPoints: { index: 'src/index.ts', admin: 'src/adminCli.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  // Optional native add-ons that ws uses when they are installed; it works without them.
  external: ['bufferutil', 'utf-8-validate'],
  define: {
    'import.meta.dirname': '__dirname',
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || 'dev'),
  },
  logLevel: 'info',
});

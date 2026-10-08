// Starts the bundled server for the end-to-end tests; playwright.config.ts runs this file. The
// server gets exactly the settings below and nothing from the shell that runs the tests, such as
// a HOST or PUBLIC_DIR exported for testing on a phone, so whatever it reads and isn't set here
// has its default. Its log goes to a file, which helpers.ts reads after each test to fail the
// test on an error the server reported.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = join(import.meta.dirname, '..');
const port = process.env.E2E_PORT;
const log = process.env.E2E_SERVER_LOG;
if (!port || !log) throw new Error('E2E_PORT and E2E_SERVER_LOG must be set; playwright.config.ts sets them');

mkdirSync(dirname(log), { recursive: true });
const file = createWriteStream(log);
const server = spawn(process.execPath, [join(root, 'server', 'dist', 'index.cjs')], {
  cwd: root,
  env: {
    HOST: '127.0.0.1',
    PORT: port,
    PUBLIC_DIR: join(root, 'client', 'dist'),
    WORDS_DIR: join(root, 'words'),
    TRUST_PROXY: '0',
    // Every test makes a room from the same address.
    ROOMS_PER_MINUTE: '1000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.pipe(file, { end: false });
server.stderr.pipe(file, { end: false });
// A crash shows in the test output as well.
server.stderr.pipe(process.stderr);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.kill(signal));
server.on('close', (code) => {
  file.end();
  process.exitCode = code ?? 0;
});

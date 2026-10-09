import { createServer } from 'node:net';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// End-to-end tests: real browsers against the production build, which `npm run build` makes
// first (docs/development.md). Each test plays with several browser contexts, one per player.

// The server listens on a free port, so that the tests of two worktrees can run at the same
// time. The port is picked below the range that the system hands to outgoing connections,
// which starts at 32768 on Linux and at 49152 on macOS and Windows, so that nothing is given
// the port between the probe here and the server's start. Two runs that pick the same number in
// the same moment remain possible, one chance in ten thousand. Every worker loads this file
// again, so the port that the main process picked reaches them through the environment, which
// they inherit.
const isFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = 20000 + Math.floor(Math.random() * 10000);
    if (await isFree(port)) return port;
  }
  throw new Error('no free port between 20000 and 29999 for the test server');
}
process.env.E2E_PORT ||= String(await freePort());
const PORT = Number(process.env.E2E_PORT);
// The server's log, which helpers.ts reads after each test. It is in the output directory, which
// Playwright empties before it starts the server, and named after the port, so that two runs in
// one worktree don't write into the same file.
process.env.E2E_SERVER_LOG ||= join(import.meta.dirname, 'test-results', `server-${PORT}.log`);
// The mails that the mailer writes out instead of sending them, which helpers.ts reads the links
// in mails from.
process.env.E2E_MAIL_LOG ||= join(import.meta.dirname, 'test-results', `mails-${PORT}.jsonl`);

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  // CI runs each project in a job of its own, from the matrix in .github/workflows/ci.yml. When
  // you add, rename or remove a project, change the matrix too.
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    // e2e/server.mjs starts the server with its settings pinned and keeps its log.
    command: 'node e2e/server.mjs',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    env: { E2E_PORT: String(PORT), E2E_SERVER_LOG: process.env.E2E_SERVER_LOG, E2E_MAIL_LOG: process.env.E2E_MAIL_LOG },
  },
});

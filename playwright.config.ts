import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// End-to-end tests: real browsers against the production build, which `npm run build` makes
// first (docs/development.md). Each test plays with several browser contexts, one per player.

// The server listens on a free port, so that the tests of two worktrees can run at the same
// time. Every worker loads this file again, so the port that the main process picked reaches
// them through the environment, which they inherit.
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
process.env.E2E_PORT ||= String(await freePort());
const PORT = Number(process.env.E2E_PORT);
// The server's log, which helpers.ts reads after each test. It is in the output directory, which
// Playwright empties before it starts the server, and named after the port, so that two runs in
// one worktree don't write into the same file.
process.env.E2E_SERVER_LOG ||= join(import.meta.dirname, 'test-results', `server-${PORT}.log`);

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
    env: { E2E_PORT: String(PORT), E2E_SERVER_LOG: process.env.E2E_SERVER_LOG },
  },
});

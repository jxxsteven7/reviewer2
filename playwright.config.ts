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
    command: 'node server/dist/index.cjs',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    // Every variable the server reads (docs/development.md), so that none exported in a shell,
    // such as HOST or PUBLIC_DIR for testing on a phone, reaches it. The limit on creating rooms
    // is raised, since every test makes a room from the same address.
    env: {
      HOST: '127.0.0.1',
      PORT: String(PORT),
      PUBLIC_DIR: join(import.meta.dirname, 'client', 'dist'),
      WORDS_DIR: join(import.meta.dirname, 'words'),
      TRUST_PROXY: '0',
      ROOMS_PER_MINUTE: '1000',
    },
  },
});

import { defineConfig } from 'vitest/config';

// One project per workspace. The client's tests run with its Vite config, so that they see the
// same plugins as the app.
export default defineConfig({
  test: {
    projects: [
      { extends: false, test: { name: 'shared', root: './shared', include: ['src/**/*.test.ts'] } },
      {
        extends: false,
        test: { name: 'server', root: './server', include: ['src/**/*.test.ts', 'test/**/*.test.ts'] },
      },
      { extends: './client/vite.config.ts', test: { name: 'client', root: './client', include: ['src/**/*.test.ts'] } },
      { extends: false, test: { name: 'mailer', root: './mailer', include: ['src/**/*.test.ts'] } },
      { extends: false, test: { name: 'agent', root: './agent', include: ['src/**/*.test.ts'] } },
    ],
  },
});

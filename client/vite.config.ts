import { fileURLToPath, URL } from 'node:url';
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    vue(),
    // Compiles the locale files at build time, so the page needs no eval and runs under a
    // strict Content Security Policy.
    VueI18nPlugin({
      include: fileURLToPath(new URL('./src/locales/*.json', import.meta.url)),
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || 'dev'),
  },
  server: {
    port: 5173,
    // The server runs on port 3000 during development; see docs/development.md.
    proxy: {
      '/socket.io': { target: 'http://127.0.0.1:3000', ws: true },
      '/healthz': { target: 'http://127.0.0.1:3000' },
    },
  },
  build: {
    sourcemap: true,
  },
});

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite';
import vue from '@vitejs/plugin-vue';
import english from 'hyphen/en-us/index.js';
import { defineConfig, type Plugin } from 'vite';

const WORDS_DIR = fileURLToPath(new URL('../words/', import.meta.url));
const HYPHENATION = 'virtual:hyphenation';

// The English terms of the word library, hyphenated with Liang's en-us patterns (the `hyphen`
// package, the same patterns that TeX uses) at build time, as a module that maps each term that
// the patterns break to itself with soft hyphens. The page then carries a few hundred bytes of
// break points instead of the patterns, which weigh as much as the rest of the app. A word the
// patterns leave whole, and a word outside the library, such as one of the chair's own, gets a
// plainer fallback at run time (src/games/keywords/hyphenate.ts).
function hyphenation(): Plugin {
  const resolved = `\0${HYPHENATION}`;
  return {
    name: 'hyphenation',
    resolveId(id) {
      return id === HYPHENATION ? resolved : undefined;
    },
    load(id) {
      if (id !== resolved) return undefined;
      const words: Record<string, string> = {};
      const files = readdirSync(WORDS_DIR)
        .filter((name) => name.endsWith('.json'))
        .sort();
      for (const file of files) {
        const path = join(WORDS_DIR, file);
        this.addWatchFile(path);
        const list = JSON.parse(readFileSync(path, 'utf8')) as { terms?: { en?: string }[] };
        for (const { en } of list.terms ?? []) {
          if (!en) continue;
          const broken = english.hyphenateSync(en, { minWordLength: 6 });
          if (broken !== en) words[en] = broken;
        }
      }
      return `export default ${JSON.stringify(words)};`;
    },
  };
}

export default defineConfig({
  plugins: [
    vue(),
    // Compiles the locale files at build time, so the page needs no eval and runs under a
    // strict Content Security Policy.
    VueI18nPlugin({
      include: fileURLToPath(new URL('./src/locales/*.json', import.meta.url)),
    }),
    hyphenation(),
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
      // The account API and the avatars. The Host header stays the page's, which the API's check of
      // where a request comes from compares with its Origin.
      '/api': { target: 'http://127.0.0.1:3000' },
      '/avatars': { target: 'http://127.0.0.1:3000' },
    },
  },
  build: {
    sourcemap: true,
    // Nothing is inlined as a data: URL, which the Content Security Policy refuses: the fonts come
    // in slices, and the smallest of them would otherwise be written into the stylesheet.
    assetsInlineLimit: 0,
  },
});

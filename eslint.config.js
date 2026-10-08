import js from '@eslint/js';
import vueI18n from '@intlify/eslint-plugin-vue-i18n';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/dist/', 'coverage/', 'playwright-report/', 'test-results/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
    // TypeScript already reports undefined names, and knows the globals declared in env.d.ts.
    rules: { 'no-undef': 'off' },
  },
  {
    files: ['client/src/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['server/**', 'scripts/**', 'e2e/*.mjs', '*.config.*', 'client/vite.config.ts', 'client/compress.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // The front end must not bundle zod. A schema is built when its module loads, so no bundler
    // can leave it out, and building one probes `new Function`, which the page's own Content
    // Security Policy refuses. The schemas are in shared/src/schemas.ts, which only the server
    // imports, and nothing else on the client's side may reach zod or that module.
    files: ['client/**', 'shared/src/**'],
    ignores: ['shared/src/schemas.ts', 'shared/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // zod itself and its other entry points, such as zod/mini.
              group: ['zod', 'zod/*'],
              message: 'Only shared/src/schemas.ts may import zod, and only the server imports it.',
            },
            {
              // The module by its package path and by any relative one, with or without ".ts".
              group: ['**/schemas', '**/schemas.*'],
              message: "The schemas are for the server only: they would pull zod into the client's bundle.",
            },
          ],
        },
      ],
      // The rule above doesn't look at import().
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression[source.value=/^zod(\\/|$)|(^|\\/)schemas(\\.|$)/]',
          message: 'Neither zod nor the schemas may be imported here, also not with import().',
        },
      ],
    },
  },
  {
    // All interface text lives in the locale files (docs/rules/constraints.md), so templates may
    // contain only numbers and symbols as they are: the section sign, middle dot, infinity,
    // arrows, bullet, ellipsis, slashes, brackets and dashes.
    files: ['client/src/**/*.vue'],
    extends: [vueI18n.configs['flat/recommended']],
    settings: {
      'vue-i18n': { localeDir: './client/src/locales/*.json', messageSyntaxVersion: '^11.0.0' },
    },
    rules: {
      '@intlify/vue-i18n/no-raw-text': [
        'error',
        {
          ignorePattern: '^[\\s\\d\u00a7\u00b7\u00d7\u221e\u2192\u2190\u2022\u2026/:#()\\[\\]+\\-\u2013\u2014]+$',
        },
      ],
      '@intlify/vue-i18n/no-missing-keys': 'error',
    },
  },
  prettier,
]);

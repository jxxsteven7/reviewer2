# 0001: Tech stack for the first version

- Status: accepted
- Date: 2026-10-06

## Context

The brief fixed TypeScript on both sides, a Vue front end, a Node server with Socket.IO, interface text in locale files, room state in memory, and shared types. The hard constraints rule out Google services and public CDNs and ask for one Node process on one port ([../rules/constraints.md](../rules/constraints.md)). Open were the package manager and the tooling.

## Decision

| Area | Choice |
|---|---|
| Package manager | npm workspaces: `shared`, `server`, `client`, later `mailer` |
| Node | `^22.22.2 \|\| ^24.15 \|\| >=26`; CI uses 24 LTS. Raised from `^22.13 \|\| ^24` on 2026-10-09, when `npm ci` stopped running below and the server came to use `backup()` from `node:sqlite` |
| Language | TypeScript `~6.0.3`; vue-tsc for `.vue` files |
| Front end | Vue 3.5, Vite 8, vue-router 5, vue-i18n 11 with messages compiled at build time |
| Server | Node's `http`, Socket.IO 4.8, sirv for static files |
| Validation | zod 4, schemas in `shared` |
| Tests | Vitest 5; Playwright end to end |
| Lint and format | ESLint 10 with typescript-eslint, eslint-plugin-vue and vue-i18n's `no-raw-text`; Prettier |
| Builds | Vite, text files compressed ahead of time; esbuild bundles the server into one CommonJS file |
| Fonts | Source Serif 4 from `@fontsource-variable`, self-served; interface text in system fonts. Superseded on 2026-10-10 by the three fonts of the party look, served the same way in slices by character range; see [../design.md](../design.md) |
| Deployment | The build, run with Node; no container image |

## Why

- **npm, not pnpm:** Node 25 dropped corepack, so pnpm would be one more install for every contributor.
- **TypeScript 6, not 7:** typescript-eslint doesn't support the native rewrite yet.
- **Compiled i18n messages:** the message compiler needs `eval`, which the Content Security Policy forbids.
- **No Express:** a few HTTP routes besides Socket.IO don't need it.
- **One CommonJS bundle:** production needs no `node_modules`; CommonJS because socket.io's dependencies `require()` Node's built-ins.
- **One web font:** every byte counts on a slow link into mainland China, and a Chinese web font weighs megabytes. Since the party look, the Chinese fonts come sliced, and a page downloads only the slices it uses.
- **No container image:** the build needs only Node, and Docker Hub is hard to reach from mainland China.
- **Compression at build time:** sirv sends files as they are; gzip and Brotli copies cut the script to a third.

Alternatives: pnpm (needs corepack), React (the brief chose Vue), Biome (incomplete Vue support).

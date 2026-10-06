# 0001: Tech stack for the first version

- Status: accepted
- Date: 2026-10-06

## Context

The project brief fixed the outline: TypeScript on both sides, a Vue front end, a Node server with Socket.IO, interface text in locale files, room state in memory, and a workspace that shares types between the front end and the back end. The hard constraints rule out Google services and public CDNs and ask for one Node process on one port (see [../rules/constraints.md](../rules/constraints.md)). What was left open was the package manager and the tooling around the code.

## Decision

| Area | Choice |
|---|---|
| Package manager | npm workspaces: `shared`, `server`, `client` |
| Node | `^22.13 \|\| ^24 \|\| >=26`; CI uses 24 LTS |
| Language | TypeScript, pinned to `~6.0.3`; vue-tsc checks `.vue` files |
| Front end | Vue 3.5, Vite 8, vue-router 5, vue-i18n 11 with messages compiled at build time |
| Server | Node's `http` module, Socket.IO 4.8 and sirv for static files |
| Validation | zod 4, with schemas in `shared` |
| Tests | Vitest 5 for unit and integration tests, Playwright for end-to-end tests |
| Linting and formatting | ESLint 10 with typescript-eslint, eslint-plugin-vue and the vue-i18n plugin's `no-raw-text` rule, plus Prettier |
| Builds | Vite for the front end, with its text files compressed ahead of time; esbuild bundles the server and its dependencies into one CommonJS file |
| Fonts | Source Serif 4 from `@fontsource-variable`, bundled and served by our own server. Interface text uses system fonts |
| Deployment | The build, run directly with Node; no container image |

zod and Playwright are decided here but are not dependencies yet. Each is added with the first code that uses it: zod with the first messages between the client and the server, and Playwright with the first end-to-end test.

## Consequences

- **npm instead of pnpm.** Node 25 stopped shipping corepack, so pnpm would be one more thing for every contributor to install, including people who only add words. npm comes with Node.
- **TypeScript 6.0, not 7.** TypeScript 7 is the native rewrite. typescript-eslint doesn't support it yet: its peer range ends below 6.1. We move to 7 once the linting stack supports it.
- **vue-i18n with compiled messages.** The message compiler would otherwise need `eval`, which the Content Security Policy forbids.
- **No Express.** The server has two HTTP routes besides Socket.IO, the static files and `/healthz`, so Node's own `http` module is enough.
- **Production needs no `node_modules`.** The server is bundled into one file. It is CommonJS because socket.io's dependencies call `require()` for Node's built-in modules, which an ES module bundle can't do.
- **One web font.** Every byte counts on a slow link into mainland China. Chinese text uses the system's fonts, because a Chinese web font weighs several megabytes.
- **No container image for now.** The first version is one process with no database, and the build needs only Node, so a container would add a Dockerfile to maintain and nothing the app needs. Images from Docker Hub are also hard to pull from mainland China. An image can come back when a host calls for one.
- **Compression at build time.** sirv sends files as they are, so the build writes a gzip and a Brotli copy of each text file at the highest level, and the server sends the copy that the browser accepts. That makes the script about a third of its size, at no cost per request.

## Alternatives considered

- **pnpm workspaces**: faster and stricter installs, but they need corepack or a separate install.
- **React**: the team is comfortable with it too, but the brief and the README had already chosen Vue.
- **Biome instead of ESLint and Prettier**: faster, but its Vue support is incomplete, and there is no equivalent of `no-raw-text`.

# Development

How to set up, run and test the app on your own machine. The rules for branches, commits and pull requests are in [rules/git.md](rules/git.md).

## Requirements

- [Node.js](https://nodejs.org) 22.13 or later. Use an even-numbered release (22, 24 or 26): the test runner doesn't support 23 or 25. CI and the Docker image use 24 LTS, which `.node-version` names for version managers such as fnm.
- npm, which comes with Node. The repository is an npm workspace with three packages: `shared`, `server` and `client`.
- Git.

In mainland China, installs are faster from a mirror of the npm registry: `npm config set registry https://registry.npmmirror.com`. That setting stays on your machine.

## Setting up

```bash
npm install
```

Run it in every worktree, because each worktree has its own `node_modules`. It also turns on the git hooks by setting `core.hooksPath` (`scripts/install-hooks.mjs`).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Starts the server on port 3000, restarting it when its code changes, and the Vite dev server on <http://localhost:5173>, which forwards Socket.IO and `/healthz` to the server. Open the Vite address. |
| `npm run build` | Builds the front end into `client/dist`, with a gzip and a Brotli copy beside each text file, and bundles the server into `server/dist/index.cjs` |
| `npm start` | Runs the production build: the front end and Socket.IO on one port, <http://localhost:3000> |
| `npm test` | Runs the unit and integration tests with Vitest. `npx vitest` keeps watching |
| `npm run lint` | ESLint, then Prettier's check |
| `npm run format` | Rewrites files with Prettier and fixes what ESLint can |
| `npm run typecheck` | TypeScript and vue-tsc over every package |
| `npm run check:names` | Looks for the name of the board game in every tracked file; see [rules/constraints.md](rules/constraints.md) |
| `node --test scripts/*.test.mjs` | Tests the scripts in `scripts/` |

Before you push, run `npm run lint`, `npm run typecheck` and `npm test`. CI runs them too, and also checks that the production build and the Docker image work.

## Project layout

| Path | Contents |
|---|---|
| `shared/src/` | Types and rules that the client and the server share. The package is `@reviewer2/shared`, and both sides import its TypeScript source directly |
| `server/src/` | The server. `config.ts` reads the environment variables, `http.ts` serves the front end with its cache and security headers, `server.ts` puts HTTP and Socket.IO on one port, and `index.ts` starts it |
| `server/test/` | Integration tests that start a real server |
| `client/src/` | The Vue app: `core/` for the parts that all games share, `styles/` for the design tokens, `locales/` for all interface text |
| `scripts/` | Repository scripts with no dependencies: the commit and name checks, the README sync check and the hook installer |

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | The port the server listens on |
| `HOST` | `127.0.0.1`, or `0.0.0.0` in Docker | The address the server listens on. Set it to `0.0.0.0` to reach the server from other devices |
| `PUBLIC_DIR` | `client/dist` | Where the built front end is |
| `APP_VERSION` | `dev` | Read at build time: the version that `/healthz` and the page footer report. The Docker build sets it to the commit |

Never commit passwords, keys or tokens. `.env` files are ignored by git.

## Testing on a phone

Phones on the same Wi-Fi can reach the production build on your computer:

```bash
npm run build
HOST=0.0.0.0 npm start
```

Then open `http://<your computer's address>:3000` on the phone. On a Mac, `ipconfig getifaddr en0` prints the address. To try WeChat's built-in browser, send the link to yourself in WeChat and open it there. On plain `http`, browsers turn off `navigator.share` and the clipboard, so the page falls back to letting you select the link and copy it by hand.

`npm run dev` listens only on your own computer. For hot reload on a phone, run `npm run dev -w client -- --host` together with `npm run dev -w server`.

## Docker

```bash
docker build --build-arg APP_VERSION="$(git rev-parse --short HEAD)" --tag reviewer2 .
docker run --rm --publish 3000:3000 reviewer2
```

The image holds only the bundled server, the built front end and `words/`. It runs as the unprivileged `node` user and checks its own health on `/healthz`.

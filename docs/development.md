# Development

How to set up, run and test the app on your own machine. The rules for branches, commits and pull requests are in [rules/git.md](rules/git.md).

## Requirements

- [Node.js](https://nodejs.org) 22.13 or later, but not 23 or 25: the test runner doesn't support them, and `npm install` refuses to run on a version outside `engines` in `package.json`. CI uses 24 LTS, which `.node-version` names for version managers such as fnm.
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
| `npm test` | Runs the tests of the scripts in `scripts/` with Node's test runner, then the unit and integration tests with Vitest. `npx vitest` keeps watching |
| `npm run lint` | ESLint, then Prettier's check |
| `npm run format` | Rewrites files with Prettier and fixes what ESLint can |
| `npm run typecheck` | TypeScript and vue-tsc over every package |
| `npm run check:names` | Looks for the name of the board game in every tracked file; see [rules/constraints.md](rules/constraints.md) |
| `node --test scripts/*.test.mjs` | Tests the scripts in `scripts/` |

Before you push, run `npm run lint`, `npm run typecheck` and `npm test`. CI runs them too, and also checks that the production build works.

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
| `HOST` | `127.0.0.1` | The address the server listens on. Set it to `0.0.0.0` to reach the server from other devices |
| `PUBLIC_DIR` | `client/dist` | Where the built front end is |
| `APP_VERSION` | `dev` | Read at build time: the version that `/healthz` and the page footer report. Set it to the commit when you build for production |

Never commit passwords, keys or tokens. `.env` files are ignored by git.

## Testing on a phone

Phones on the same Wi-Fi can reach the production build on your computer:

```bash
npm run build
HOST=0.0.0.0 npm start
```

Then open `http://<your computer's address>:3000` on the phone. On a Mac, `ipconfig getifaddr en0` prints the address. To try WeChat's built-in browser, send the link to yourself in WeChat and open it there.

`npm run dev` listens only on your own computer. For hot reload on a phone, run `npm run dev -w client -- --host` together with `npm run dev -w server`.

## Running in production

The production build needs Node and nothing from `node_modules`. Build it with the commit as its version:

```bash
APP_VERSION="$(git rev-parse --short HEAD)" npm run build
```

Then copy `server/dist/`, `client/dist/` and `words/` to the server, in the same layout, and run `node server/dist/index.cjs` there. It listens on `127.0.0.1:3000` unless `HOST` and `PORT` say otherwise, and `/healthz` answers once it is up.

- **Restart the server after replacing the build.** It lists the front end's files when it starts, so a running server would serve the new `index.html` but answer its new assets with 404.
- **Behind a reverse proxy,** pass the original `Host` header on, for nginx `proxy_set_header Host $host;`, along with the WebSocket upgrade headers. The Content Security Policy names the host the page was requested from, so that older iPhones allow the WebSocket connection to it.

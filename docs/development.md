# Development

How to run and test the app on your machine. Branches, commits and PRs are in [rules/git.md](rules/git.md).

## Requirements

- [Node.js](https://nodejs.org) 22.22.2 or later, 24.15 or later on Node 24, and not 23 or 25: the test runner doesn't support them. CI uses 24 LTS and 22.22.2.
- npm and Git. The repository is an npm workspace of `shared`, `server`, `client` and `mailer`.

In mainland China, `npm config set registry https://registry.npmmirror.com` is faster.

## Commands

Run `npm install` first, in every worktree; it also turns on the git hooks.

| Command | What it does |
|---|---|
| `npm run dev` | The server on port 3000 and Vite on <http://localhost:5173>, which forwards API and socket requests to it; open the Vite address. Both read `.env` |
| `npm run dev:mailer` | The mailer, as `.env` says; see [Accounts and email](#accounts-and-email) |
| `npm run build` | `client/dist`, `server/dist/index.cjs` and `admin.cjs`, `mailer/dist/mailer.cjs` |
| `npm start` | The production build on one port, <http://localhost:3000> |
| `npm test` | The tests of `scripts/`, then Vitest (`npx vitest` watches) |
| `npm run test:e2e` | Playwright, end to end; see below |
| `npm run lint`, `npm run format` | ESLint and Prettier: check, or fix |
| `npm run typecheck` | TypeScript and vue-tsc over every package |
| `npm run check:names`, `npm run check:words` | The forbidden name ([rules/constraints.md](rules/constraints.md)); the word lists ([../words/README.md](../words/README.md)) |

Before you push, run `npm run lint`, `npm run typecheck` and `npm test`. After changing the interface or a game's flow, also `npm run build && npm run test:e2e`.

## End-to-end tests

The tests in `e2e/` start the built server and the mailer on free ports and open a browser context per player. They play whole games in both languages, reload pages, cut the network and chat; afterwards every snapshot any page received is checked for colors, chats and choices it must not hold. Script, console and logged server errors fail the test.

```bash
npx playwright install chromium webkit   # once; on Linux add --with-deps
npm run build
npm run test:e2e
npx playwright test --project=iphone-webkit e2e/seats.spec.ts   # one browser, one file
```

In mainland China, set `PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright` for the install.

## Environment variables

`.env.example` has a development set. Defaults in brackets.

| Variable | Meaning |
|---|---|
| `PORT` [3000], `HOST` [127.0.0.1] | Where the server listens |
| `PUBLIC_DIR` [`client/dist`] | The built front end |
| `WORDS_DIR` [`words`] | The word lists |
| `DATA_DIR` [off] | An existing directory for the database, snapshots and avatars ([architecture.md](architecture.md#data)); unset, data is lost at every stop |
| `ROOMS_PER_MINUTE` [5], `FEEDBACK_PER_10_MINUTES` [3], `ACCOUNTS_PER_HOUR` [5] | Limits per address; raise them where many people share one |
| `STATUS_PORT` [off] | The operator's status page, on `127.0.0.1` only ([architecture.md](architecture.md#status)) |
| `TRUST_PROXY` [off] | `1` behind a reverse proxy that sets `X-Forwarded-For`, and only there |
| `COOKIE_SECURE` [on] | `0` only over plain HTTP, as in development |
| `SERVER_SECRET` or `SERVER_SECRET_FILE` [off] | The server's secret, 32 characters or more, or a file holding it. It fingerprints email addresses ([architecture.md](architecture.md#mail)), so never change or lose it. Without it, no email |
| `MAILER_SOCKET` [off] | The mailer's Unix socket, at most 107 bytes. Without it, no email |
| `APP_VERSION` [`dev`] | Build time: the version `/healthz` and the footer report |

The mailer reads `MAILER_TRANSPORT` [`resend`] (`print` writes the mails out as JSON instead of sending them), `RESEND_API_KEY` or `RESEND_API_KEY_FILE` (required with `resend`), `MAILER_BASE_URL` [`https://playreviewer2.com`] (where the links lead; HTTPS with `resend`), `MAILER_SOCKET` (required, unless systemd's socket activation hands a socket over), `STATE_DIRECTORY` or `MAILER_STATE_DIR` (where the daily count of mails is kept; required with `resend`) and `MAILER_PRINT_FILE` [off] (a file that `print` writes the mails to as well).

Never commit passwords, keys or tokens; `.env` is ignored by git.

## Accounts and email

Accounts need no setting. Email needs the secret and the mailer: copy `.env.example` to `.env` and run `npm run dev:mailer` beside `npm run dev`; the mails appear in the mailer's output.

The operator takes an avatar down with the command the build makes, beside the running server:

```bash
DATA_DIR=data node server/dist/admin.cjs avatar remove <username>          # back to the default avatar
DATA_DIR=data node server/dist/admin.cjs avatar remove <username> --ban    # and no more uploads
DATA_DIR=data node server/dist/admin.cjs avatar allow <username>           # uploads again
DATA_DIR=data node server/dist/admin.cjs accounts [--json]                 # statistics of the accounts
```

`accounts` prints the number of accounts, the new ones on each of the last 30 days, the active ones in the last 7 and 30 days, and every username with its registration date, games and matches. An account is active when one of its logins was used or it finished a game; a login that has ended takes its time with it, so an account that only logged in and out counts by its games alone. It never prints password hashes, email fingerprints, tokens or addresses.

## Testing on a phone

```bash
npm run build
HOST=0.0.0.0 COOKIE_SECURE=0 npm start
```

Open `http://<your computer's address>:3000` on a phone on the same Wi-Fi, or in WeChat to try its browser. `npm start` doesn't read `.env`, and without `COOKIE_SECURE=0` the phone's browser drops the login cookie, which is `Secure`, over plain HTTP, so logging in wouldn't stick.

## Running in production

The build needs only Node. Build it with its version, from the last commit's title on `main`:

```bash
APP_VERSION="$(git log -1 --format=%s | grep -oE '^v[0-9]+\.[0-9]+\.[0-9]+' || git rev-parse --short HEAD)" npm run build
```

Copy `server/dist/`, `client/dist/`, `mailer/dist/` and `words/` in the same layout and run `node server/dist/index.cjs`. What the code expects of any deployment:

- **`DATA_DIR`** set to a writable directory, and in your backups.
- **A restart after replacing the build**.
- **Behind a reverse proxy**, the `Host` header and the WebSocket upgrade passed through, `TRUST_PROXY=1`, and the player's address in `X-Forwarded-For`, or all players share one address's limits. Any proxy other than Cloudflare must drop the `CF-IPCountry` header, or a client can choose the country it is counted under.
- **For accounts**, HTTPS only, HTTP redirected, HSTS on, and `COOKIE_SECURE` on.
- **For email**, the secret from a file only the service reads (`SERVER_SECRET_FILE`), and the mailer as a service of its own on `MAILER_SOCKET`. Only the mailer needs the internet, Resend's key and a state directory.
- **The status page** is `http://127.0.0.1:<STATUS_PORT>` on the server's own machine.

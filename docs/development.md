# Development

How to set up, run and test the app on your own machine. The rules for branches, commits and pull requests are in [rules/git.md](rules/git.md).

## Requirements

- [Node.js](https://nodejs.org) 22.22.2 or later, and 24.15 or later on Node 24, but not 23 or 25: the test runner doesn't support them, and `npm install` refuses to run on a version outside `engines` in `package.json`. Some of the development tools need 22.22.2 or 24.15, and the server needs at least 22.16 for the snapshots of its database, which use `backup()` from `node:sqlite`. CI uses 24 LTS, which `.node-version` names for version managers such as fnm, and runs the type checks and the tests on 22.22.2 as well.
- npm, which comes with Node. The repository is an npm workspace with four packages: `shared`, `server`, `client` and `mailer`.
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
| `npm run dev` | Starts the server on port 3000, restarting it when its code changes, and the Vite dev server on <http://localhost:5173>, which forwards Socket.IO, `/healthz`, `/api` and `/avatars` to the server. Open the Vite address. Both read `.env` if there is one; see [Accounts and email](#accounts-and-email) |
| `npm run dev:mailer` | Starts the mailer, which sends the mails of accounts, as `.env` says; see [Accounts and email](#accounts-and-email) |
| `npm run build` | Builds the front end into `client/dist`, with a gzip and a Brotli copy beside each text file, bundles the server into `server/dist/index.cjs` and the operator's command into `server/dist/admin.cjs`, and the mailer into `mailer/dist/mailer.cjs` |
| `npm start` | Runs the production build: the front end and Socket.IO on one port, <http://localhost:3000> |
| `npm test` | Runs the tests of the scripts in `scripts/` with Node's test runner, then the unit and integration tests with Vitest. `npx vitest` keeps watching |
| `npm run test:e2e` | Plays the game end to end in desktop Chromium, phone Chromium and iPhone WebKit with Playwright, against the production build. Run `npm run build` first; see [End-to-end tests](#end-to-end-tests) |
| `npm run lint` | ESLint, then Prettier's check |
| `npm run format` | Rewrites files with Prettier and fixes what ESLint can |
| `npm run typecheck` | TypeScript and vue-tsc over every package |
| `npm run check:names` | Looks for the name of the board game in every tracked file; see [rules/constraints.md](rules/constraints.md) |
| `npm run check:words` | Checks the word lists in `words/`; see [../words/README.md](../words/README.md) |
| `node --test scripts/*.test.mjs` | Tests the scripts in `scripts/` |

Before you push, run `npm run lint`, `npm run typecheck` and `npm test`. When you change the interface or the flow of a game, also run `npm run build && npm run test:e2e`; see [End-to-end tests](#end-to-end-tests). CI runs all of them, and also checks that the production build works.

## End-to-end tests

The tests in `e2e/` start the bundled server on a free port, with the mailer, which writes the mails to a file that the tests read the links from, and open a browser context for each player, as if on separate phones. They play whole games in both languages. They reload a page, go to the home page and back, and cut the network in the middle of a game. They take over an empty PI seat, keep players in their group, and let two students of a group choose cards and chat. After every test, every snapshot that any page received during it is checked, whether or not the test looked at it: outside a PI's seat, no snapshot before the end of a game holds the color of an unrevealed card anywhere in it, and no snapshot holds another group's chat or choices of cards. One guesser gets the snapshots over long-polling instead of WebSocket. A test also fails on a script error or a console error on any page, and on an error that the server logged.

```bash
npx playwright install chromium webkit   # once: the browsers the tests use
npm run build
npm run test:e2e
npx playwright test --project=iphone-webkit e2e/seats.spec.ts   # one browser, one file
```

On Linux, add `--with-deps` to the install the first time: WebKit needs system libraries, which it then installs with apt, asking for sudo. In mainland China, the browsers download faster from a mirror: set `PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright` for the install. When a test fails, `npx playwright show-trace` opens its trace from `test-results/`. Each run picks a free port for its server, so the tests of two worktrees can run at the same time.

## Project layout

| Path | Contents |
|---|---|
| `shared/src/` | Types and rules that the client and the server share. The package is `@reviewer2/shared`, and both sides import its TypeScript source directly |
| `server/src/` | The server. `config.ts` reads the environment variables, `http.ts` serves the front end with its cache and security headers, `server.ts` puts HTTP and Socket.IO on one port, `stats.ts` counts what the operator sees, `status.ts` serves the status page, `main.ts` starts and stops it all, and `index.ts` runs `main.ts`. `core/` holds rooms, players and connections, `games/` one module per game, `accounts/` the account API, logins, email and avatars, and `store/` the database and what is kept in it. `admin.ts` is the operator's command; see [architecture.md](architecture.md) |
| `mailer/` | The mailer, a program of its own that sends the mails of accounts; see [architecture.md](architecture.md#the-mailer) |
| `server/test/` | Integration tests that start a real server and connect to it with Socket.IO clients |
| `client/src/` | The Vue app: `core/` for the parts that all games share, `styles/` for the design tokens, `locales/` for all interface text |
| `e2e/` | End-to-end tests with Playwright |
| `scripts/` | Repository scripts with no dependencies: the commit and name checks, the README sync check and the hook installer |

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | The port the server listens on |
| `HOST` | `127.0.0.1` | The address the server listens on. Set it to `0.0.0.0` to reach the server from other devices |
| `PUBLIC_DIR` | `client/dist` | Where the built front end is |
| `WORDS_DIR` | `words` | Where the word lists are. The server refuses to start when there is no list in it that it can read, or no term in any list |
| `DATA_DIR` | off | The directory for the database and its snapshots; see [architecture.md](architecture.md#data). It must be there already. A relative path is taken from the repository's root, so `mkdir data && DATA_DIR=data npm start` keeps the database in `data/`, which git ignores. Leave it unset to keep the database in memory, which is lost when the server stops; the server logs `database_opened` with which of the two it has |
| `ROOMS_PER_MINUTE` | `5` | How many times a minute one address may try to create a room; see [architecture.md](architecture.md). Raise it where many people share one address, such as a class behind one router, and for tests, where every room comes from one address. A higher limit protects less against abuse, so the server logs `rooms_per_minute_raised` when it starts with one, and the `listening` line reports the value in use |
| `FEEDBACK_PER_10_MINUTES` | `3` | How much feedback one address may send in 10 minutes; see [architecture.md](architecture.md#feedback). Raise it for the same reasons as `ROOMS_PER_MINUTE`; the server logs `feedback_limit_raised` when it starts with a higher limit, and the `listening` line reports the value in use |
| `STATUS_PORT` | off | The port of the status page for the operator, which listens on `127.0.0.1` only, whatever `HOST` says; see [architecture.md](architecture.md#status). Leave it unset to keep the page off. It must be another port than `PORT`. When the port can't be opened, the server logs `status_unavailable` and runs without the page |
| `TRUST_PROXY` | off | Set it to `1` behind a reverse proxy that sets `X-Forwarded-For`, and only there, so that the limits count each player's own address; see [architecture.md](architecture.md). `1`, `true`, `yes` and `on` switch it on, and a value the server doesn't know stops it |
| `COOKIE_SECURE` | on | Whether the login cookie is `Secure`, with the `__Host-` prefix; see [architecture.md](architecture.md#accounts). Set it to `0` only where the game is served over plain HTTP, as with `npm run dev` or on a phone in the same Wi-Fi: a browser drops a `Secure` cookie that comes over plain HTTP from anywhere but localhost, and WebKit even from there. The server logs `cookies_not_secure` when it is off |
| `ACCOUNTS_PER_HOUR` | `5` | How many accounts one address may create in an hour. Raise it for the same reasons as `ROOMS_PER_MINUTE`; the server logs `accounts_per_hour_raised` when it starts with a higher limit |
| `SERVER_SECRET` or `SERVER_SECRET_FILE` | off | The server's secret, at least 32 characters, such as `head -c 32 /dev/urandom \| base64`, or the file that holds it, as systemd's credentials give it. It fingerprints email addresses ([architecture.md](architecture.md#mail)), so it must never change or be lost: every address bound with it would stop matching. Keep a copy apart from the database and its backups. Without it, accounts have no email |
| `MAILER_SOCKET` | off | The mailer's Unix socket, a path of at most 107 bytes, taken from the repository's root when it is relative. Without it, accounts have no email |
| `APP_VERSION` | `dev` | Read at build time: the version that `/healthz` and the page footer report. Set it to the commit when you build for production |

The mailer has settings of its own:

| Variable | Default | Meaning |
|---|---|---|
| `MAILER_TRANSPORT` | `resend` | `resend` sends the mails through Resend; `print` writes each one out as a line of JSON instead, link included, and needs no key |
| `RESEND_API_KEY` or `RESEND_API_KEY_FILE` | | Resend's key, or the file that holds it. Needed for `resend` |
| `MAILER_BASE_URL` | `https://playreviewer2.com` | The site's address, which the links in mails lead to. With `resend`, it must be HTTPS |
| `MAILER_SOCKET` | | The socket to listen on, a path taken from the repository's root when it is relative. Under systemd, the mailer gets its socket from systemd instead |
| `STATE_DIRECTORY` or `MAILER_STATE_DIR` | | Where the count of mails is kept, so that the limit of 50 a day lasts through a restart. systemd sets `STATE_DIRECTORY`. Needed for `resend` |
| `MAILER_PRINT_FILE` | | A file that `print` writes the mails to as well |

Never commit passwords, keys or tokens. `.env` files are ignored by git, but for `.env.example`.

## Accounts and email

Accounts work without any setting. Email, for binding an address and resetting a forgotten password, needs the server's secret and the mailer. For development, copy `.env.example` to `.env`, which `npm run dev` and `npm run dev:mailer` read: it sets a secret for development, has the mailer print the mails instead of sending them, with links to the Vite address, and turns `COOKIE_SECURE` off for plain HTTP. Then run `npm run dev:mailer` beside `npm run dev`. The mails, and the links in them, appear in the mailer's output.

The operator takes an avatar down with the command that the build makes, with `DATA_DIR` naming the server's data:

```bash
DATA_DIR=data node server/dist/admin.cjs avatar remove <username>          # back to the default avatar
DATA_DIR=data node server/dist/admin.cjs avatar remove <username> --ban    # and no more uploads
DATA_DIR=data node server/dist/admin.cjs avatar allow <username>           # uploads again
```

It runs beside the server, which goes on as it is, and reads the accounts of the players in its rooms again at every sweep: within a minute, the rooms show the default avatar. Browsers and Cloudflare may keep the picture for as long as they had cached it, which is up to a year; purge its address, which the command prints, from Cloudflare's cache.

## Testing on a phone

Phones on the same Wi-Fi can reach the production build on your computer:

```bash
npm run build
HOST=0.0.0.0 npm start
```

Then open `http://<your computer's address>:3000` on the phone. On a Mac, `ipconfig getifaddr en0` prints the address. To try WeChat's built-in browser, send the link to yourself in WeChat and open it there. On plain `http`, browsers turn off `navigator.share` and the clipboard, so the page falls back to letting you select the link and copy it by hand.

`npm run dev` listens only on your own computer. For hot reload on a phone, run `npm run dev -w client -- --host` together with `npm run dev -w server`.

## Running in production

The production build needs Node and nothing from `node_modules`. Build it with the commit as its version:

```bash
APP_VERSION="$(git rev-parse --short HEAD)" npm run build
```

Then copy `server/dist/`, `client/dist/`, `mailer/dist/` and `words/` to the server, in the same layout, and run `node server/dist/index.cjs` there. It listens on `127.0.0.1:3000` unless `HOST` and `PORT` say otherwise, and `/healthz` answers once it is up.

- **Keep `words/` beside the build.** The server refuses to start when it can't read the directory of the word lists, which is `words/` unless `WORDS_DIR` names another, or when there is no list in it, or no term in any list.
- **Keep the data.** Set `DATA_DIR` to a directory that exists and that the server can write, for example the `StateDirectory` that systemd makes for the service, such as `/var/lib/reviewer2`. The server keeps its database there, with up to three hourly snapshots and one from before each migration in `snapshots/`, and stops taking feedback once the database is larger than 50 MB, so a few hundred MB are plenty. It needs no permission to run programs there, so the directory can be on a volume mounted with `noexec`. The snapshots stay on the same disk; copy them elsewhere for a backup. Without `DATA_DIR`, players' feedback is lost at every restart.
- **Restart the server after replacing the build.** It lists the front end's files when it starts, so a running server would serve the new `index.html` but answer its new assets with 404.
- **Behind a reverse proxy,** pass the original `Host` header on, for nginx `proxy_set_header Host $host;`, along with the WebSocket upgrade headers. The Content Security Policy names the host the page was requested from, so that older iPhones allow the WebSocket connection to it.
- **The status page.** Set `STATUS_PORT`, for example to `3302`, and open `http://127.0.0.1:3302` on the server itself, and `http://127.0.0.1:3302/feedback` for what players sent. From another computer, forward the port first: `ssh -L 3302:127.0.0.1:3302 <server>`, then open the same addresses there.
- **Behind a reverse proxy, also set `TRUST_PROXY=1`** and have the proxy add the player's address to `X-Forwarded-For`, for nginx `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`. Without it every connection comes from the proxy's own address, so all players together may create as many rooms a minute as `ROOMS_PER_MINUTE` allows, 5 unless it is set, and mistype 20 codes, and anyone can use that up for everyone. The server logs `forwarded_address_ignored` once when it sees the header while the setting is off, and the `listening` line says which way it is set.
- **Accounts.** Serve the site over HTTPS only, as Cloudflare's "Always Use HTTPS" and HSTS do, and leave `COOKIE_SECURE` on. Keep `DATA_DIR`, which also holds the avatars, in the backups; how long a backup is kept is how long a deleted account lingers in it.
- **Email.** Give the server its secret, from a file that only root can read, through systemd: `LoadCredential=server-secret:/etc/reviewer2/server-secret` and `SERVER_SECRET_FILE=%d/server-secret`. Run the mailer as a service of its own, which systemd starts from its socket, such as `ListenStream=/run/reviewer2-mailer/mailer.sock` with `SocketMode=0660` and a group that only the game server is in besides root; set `MAILER_SOCKET` to that path for the game server, and add `AF_UNIX` to its `RestrictAddressFamilies`. The game server keeps `PrivateNetwork=yes`: a socket on the file system is outside its network namespace. With `AF_UNIX`, the game server could reach any other Unix socket it can see and may use, so hide `/run` from it but for the mailer's directory. The mailer itself needs the internet, its key from a credential (`RESEND_API_KEY_FILE`), and a `StateDirectory`. Resend sends from `noreply@playreviewer2.com`, once the domain's SPF, DKIM and DMARC records are in place.
- **Behind a reverse proxy that isn't Cloudflare,** have it drop the `CF-IPCountry` header, for nginx `proxy_set_header CF-IPCountry "";`. With `TRUST_PROXY=1` the server believes the header, which Cloudflare sets on every request, and a proxy that passes it through as it came would let anyone pick the country they are counted under on the status page.

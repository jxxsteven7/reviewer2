# Development

How to run and test the app on your machine. Branches, commits and PRs are in [rules/git.md](rules/git.md).

## Requirements

- [Node.js](https://nodejs.org) 24.15 or later, and not 25: the test runner doesn't support it. CI uses 24 LTS.
- npm and Git. The repository is an npm workspace of `shared`, `server`, `client` and `mailer`.

In mainland China, `npm config set registry https://registry.npmmirror.com` is faster.

## Commands

Run `npm install` first, in every worktree; it also turns on the git hooks.

| Command | What it does |
|---|---|
| `npm run dev` | The server on port 3000 and Vite on <http://localhost:5173>, which forwards API and socket requests to it; open the Vite address. Both read `.env` |
| `npm run dev:mailer` | The mailer, as `.env` says; see [Accounts and email](#accounts-and-email) |
| `npm run dev:agent` | The agent, as `.env` says; see [AI players](#ai-players) |
| `npm run build` | `client/dist`, `server/dist/index.cjs` and `admin.cjs`, `mailer/dist/mailer.cjs`, `agent/dist/agent.cjs` |
| `npm start` | The production build on one port, <http://localhost:3000> |
| `npm test` | The tests of `scripts/`, then Vitest (`npx vitest` watches) |
| `npm run test:e2e` | Playwright, end to end; see below |
| `npm run lint`, `npm run format` | ESLint and Prettier: check, or fix |
| `npm run typecheck` | TypeScript and vue-tsc over every package |
| `npm run check:names`, `npm run check:words` | The forbidden name ([rules/constraints.md](rules/constraints.md)); the word lists ([../words/README.md](../words/README.md)) |

Before you push, run `npm run lint`, `npm run typecheck` and `npm test`. After changing the interface or a game's flow, also `npm run build && npm run test:e2e`.

## End-to-end tests

The tests in `e2e/` start the built server, the mailer and the agent on free ports, the agent with a model that answers by rule (`e2e/model.mjs`), and open a browser context per player. They play whole games in both languages, reload pages, cut the network and chat; afterwards every snapshot any page received is checked for colors, chats and choices it must not hold. Script, console and logged server errors fail the test. The tests run side by side, those of one file too, so none may count on another having run.

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
| `CONTENT_DIR` [off] | A directory with newer copies of `ACKNOWLEDGMENTS.md` and `SPONSORS.md`, which the home page shows without a new build or a restart; a file there that is missing or can't be used leaves the one the build bundled ([architecture.md](architecture.md#lists-of-thanks)) |
| `ROOMS_PER_MINUTE` [5], `FEEDBACK_PER_10_MINUTES` [3], `ACCOUNTS_PER_HOUR` [5] | Limits per address; raise them where many people share one |
| `MAX_FEEDBACK` [10000] | How many pieces of feedback the server keeps, with 5 KB for each on average, before it takes no more; nothing is deleted to make room, so raise it when the server is full |
| `STATUS_PORT` [off] | The operator's status page, on `127.0.0.1` only ([architecture.md](architecture.md#status)) |
| `ADMIN_COMMAND` [`node server/dist/admin.cjs`] | What the status page puts in front of the operator's commands it shows for copying: however `admin.cjs` is run where the server is, `DATA_DIR` included, such as `DATA_DIR=<dir> node <path>/admin.cjs` |
| `FEEDBACK_COMMAND` [off] | A command of the operator's that takes the subcommands of `admin.cjs feedback`, and `publish <id>`, which publishes the feedback as an issue in one go, such as `triage-feedback`: the status page shows the feedback commands with it in front, as `<FEEDBACK_COMMAND> resolve <id> <pr>`, in place of `ADMIN_COMMAND` and `feedback`, and, first, `<FEEDBACK_COMMAND> publish <id>` for feedback whose player agreed to an issue and that has none yet, before the `draft` and `issue` commands that do it by hand. Unset, the page shows the `admin.cjs feedback` commands alone |
| `TRUST_PROXY` [off] | `1` behind a reverse proxy that sets `X-Forwarded-For`, and only there |
| `COOKIE_SECURE` [on] | `0` only over plain HTTP, as in development |
| `SERVER_SECRET` or `SERVER_SECRET_FILE` [off] | The server's secret, 32 characters or more, or a file holding it. It fingerprints email addresses ([architecture.md](architecture.md#mail)), so never change or lose it. Without it, no email |
| `MAILER_SOCKET` [off] | The mailer's Unix socket, at most 107 bytes. Without it, no email |
| `AGENT_SOCKET` [off] | The agent's Unix socket, at most 107 bytes. Without it, no AI players ([architecture.md](architecture.md#ai-players)) |
| `APP_VERSION` [`dev`] | Build time: the version `/healthz` and the footer report |

The mailer reads `MAILER_TRANSPORT` [`resend`] (`print` writes the mails out as JSON instead of sending them), `RESEND_API_KEY` or `RESEND_API_KEY_FILE` (required with `resend`), `MAILER_BASE_URL` [`https://playreviewer2.com`] (where the links lead; HTTPS with `resend`), `MAILER_SOCKET` (required, unless systemd's socket activation hands a socket over), `STATE_DIRECTORY` or `MAILER_STATE_DIR` (where the daily count of mails is kept; required with `resend`) and `MAILER_PRINT_FILE` [off] (a file that `print` writes the mails to as well).

The agent reads `AGENT_SOCKET` (required, unless systemd's socket activation hands a socket over), `AGENT_MODEL_URL` (required: a service that answers OpenAI's chat completions, without a slash at the end, such as `http://127.0.0.1:11434/v1` for a model that Ollama runs on the same machine), `AGENT_MODEL` (required: the model's name there), `AGENT_MODEL_KEY` or `AGENT_MODEL_KEY_FILE` [off] (the key that the service wants, if any; with one, `AGENT_MODEL_URL` is HTTPS unless it is on the same machine), `AGENT_CONCURRENCY` [2] (the requests that go to the model at once) and `AGENT_QUEUE` [32] (how many more may wait).

Never commit passwords, keys or tokens; `.env` is ignored by git.

## Accounts and email

Accounts need no setting. Email needs the secret and the mailer: copy `.env.example` to `.env` and run `npm run dev:mailer` beside `npm run dev`; the mails appear in the mailer's output.

The operator's commands, which the build makes, run beside the running server:

```bash
DATA_DIR=data node server/dist/admin.cjs avatar remove <username>          # back to the default avatar
DATA_DIR=data node server/dist/admin.cjs avatar remove <username> --ban    # and no more uploads
DATA_DIR=data node server/dist/admin.cjs avatar allow <username>           # uploads again
DATA_DIR=data node server/dist/admin.cjs profile clear <username>          # no link or bio on their public page
DATA_DIR=data node server/dist/admin.cjs profile clear <username> --ban    # and none ever again
DATA_DIR=data node server/dist/admin.cjs profile allow <username>          # a link and a bio again
DATA_DIR=data node server/dist/admin.cjs profile list                      # every page with a link or a bio
DATA_DIR=data node server/dist/admin.cjs accounts [--json]                 # statistics of the accounts
DATA_DIR=data node server/dist/admin.cjs accounts bar <username>           # no public rooms for this account
DATA_DIR=data node server/dist/admin.cjs accounts unbar <username>         # public rooms again
DATA_DIR=data node server/dist/admin.cjs agents allow <username>           # may invite AI players
DATA_DIR=data node server/dist/admin.cjs agents deny <username>            # may not any more
DATA_DIR=data node server/dist/admin.cjs agents list                       # who may
DATA_DIR=data node server/dist/admin.cjs feedback adopt <id>               # thank its player; prints the entry
DATA_DIR=data node server/dist/admin.cjs feedback draft <id> [--json]      # the title and body of its issue
DATA_DIR=data node server/dist/admin.cjs feedback issue <id> <number>      # the GitHub issue it was published as
DATA_DIR=data node server/dist/admin.cjs feedback issue <id> --clear       # take that back
DATA_DIR=data node server/dist/admin.cjs feedback resolve <id> <pr>        # the pull request that resolved it
DATA_DIR=data node server/dist/admin.cjs feedback resolve <id> --clear     # take that back
DATA_DIR=data node server/dist/admin.cjs feedback close <id>               # not adopted; stays for the record
DATA_DIR=data node server/dist/admin.cjs feedback reopen <id>
DATA_DIR=data node server/dist/admin.cjs feedback delete <id>              # into the trash, deleted after 30 days
DATA_DIR=data node server/dist/admin.cjs feedback restore <id>             # out of the trash
DATA_DIR=data node server/dist/admin.cjs feedback trash                    # what is in the trash, with its days left
DATA_DIR=data node server/dist/admin.cjs reports list                      # the latest reports of players
DATA_DIR=data node server/dist/admin.cjs acknowledgments list
DATA_DIR=data node server/dist/admin.cjs acknowledgments add <name> --kind feedback|words|playtesting --account <username>|--no-account
```

`accounts` counts the accounts, the new ones and the active ones, and lists every username with its registration date, games and matches, never a password hash, email fingerprint, token or address. `accounts bar` keeps an account out of public rooms, as for a player others reported ([architecture.md](architecture.md#public-rooms)); `reports list` shows who reported whom. `agents allow` lets an account invite AI players to the private rooms it chairs, while they are tried out ([AI players](#ai-players)).

The `feedback` commands are the only way to change what became of a piece of feedback; the status page shows it and changes nothing ([architecture.md](architecture.md#feedback)). `feedback adopt` records that feedback was adopted, counted for the account of a player who left a name while logged in, and says when the name is another account's username; `acknowledgments add` thanks someone by hand, counted for the account `--account` names or, with `--no-account`, for none, and takes one or the other, so that an account isn't left out by mistake. `feedback draft` writes the title and the body of the issue for feedback whose player agreed to a public issue, from a template, with its text and name and never its contact, and records nothing; `feedback issue` records the issue it became, for such feedback alone; `feedback resolve` takes any feedback. `feedback delete` puts feedback in the trash, from which the server deletes it for good after 30 days, unless `feedback restore` brings it back; feedback that was adopted can't be deleted, only closed. No command changes what a player sent, and the acknowledgments and the reports are never deleted or changed.

To publish feedback as a GitHub issue, draft it, create the issue from the draft on a machine that reaches GitHub, such as with the [GitHub CLI](https://cli.github.com) and [jq](https://jqlang.org) in a checkout of the repository, and record the issue's number. The server itself needs no access to GitHub. `feedback draft` prints why there is no draft, and exits with 1, for feedback it refuses, so check its exit code before creating the issue:

```bash
if draft=$(DATA_DIR=data node server/dist/admin.cjs feedback draft <id> --json); then  # {"id", "kind", "title", "body"}
  gh issue create --title "$(jq -r .title <<< "$draft")" --body "$(jq -r .body <<< "$draft")"
else
  echo "$draft"                                                               # why there is no draft
fi
DATA_DIR=data node server/dist/admin.cjs feedback issue <id> <number>         # the number in the issue's address
```

## Acknowledgments

`ACKNOWLEDGMENTS.md` is the list of thanks, which the home page shows ([architecture.md](architecture.md#lists-of-thanks)). `feedback adopt` and `acknowledgments add` print an entry for it and the section to put it in: replace `<what they did>` with a few words, add the line and open a PR, or, as an admin, commit it to `main` ([maintainers.md](maintainers.md#lists-of-thanks)). The sections are `## Helpful discussions`, `## Data` and `## Pilot study`, after the introduction; an entry is one line:

```markdown
- [Alice](https://alice.example) — suggested public rooms (#40)
- Bob — added the physics word list (#41)
- An anonymous player — reported the reconnect bug (#42)
```

A name follows the nickname rules, with every ASCII punctuation character escaped (`Dr\. Who`), as the commands print it; a link starts with `https://`, with `(` and `)` percent-encoded, as they print it too, and holds no `\`. What they did is English in printable ASCII, without Markdown, emoji codes or web addresses; `#40`, after a space or a bracket, becomes a link on the home page. The first entry, under its heading, replaces `_No one yet._`. `npm test` checks the file and names each line that breaks the rules.

## Sponsors

`SPONSORS.md` has two sections after the introduction. `.github/workflows/sponsors.yml` writes `## GitHub Sponsors` every day, between the lines `<!-- start of GitHub Sponsors, ... -->` and `<!-- end of GitHub Sponsors -->`, and takes out `_No one yet._` or puts it back; leave all of that to it. A WeChat tipper asks to be named in the tip's message, with the name they want or the phrase that the tip sheet suggests ("list me" in English) for their WeChat name. Below those lines, add those who sponsor in other ways and ask to be named, by name, perhaps with an `https://` link, by the rules of a name in the acknowledgments. A line of thanks to them, in any language, may follow the name after ` — `, an em dash with a space on each side; whether to write one, and what, is up to the maintainers:

```markdown
## Other ways

- Alice — Thanks for the late-night fixes
- Bob
```

A line of thanks has 1 to 40 visible characters, counted as in a nickname, ordinary single spaces with none at its ends, no control or hidden characters, at most four marks of a kind on a character, no links (no `http`, `://`, `www.`, domain such as `example.com`, email address or Markdown link) and no HTML (no `<`, `>`, `&...;` reference or `:emoji:` code); Markdown's characters such as `*` stay as written, and GitHub may show them as formatting. It has nothing to do with what someone gave, which is never shown. An entry has ` — ` once at most, and the home page shows the line under the name as written, in both languages.

The workflow needs the repository secret `SPONSOR_TOKEN` ([maintainers.md](maintainers.md#sponsors)); without it, it does nothing. It also runs from the Actions tab, and `SPONSOR_TOKEN=<token> node scripts/update-sponsors.mjs` brings the file up to date locally. `npm test` checks the file as it checks the acknowledgments.

## Testing on a phone

```bash
npm run build
HOST=0.0.0.0 COOKIE_SECURE=0 npm start
```

Open `http://<your computer's address>:3000` on a phone on the same Wi-Fi, or in WeChat to try its browser. `npm start` doesn't read `.env`, and without `COOKIE_SECURE=0` the phone's browser drops the login cookie, which is `Secure`, over plain HTTP, so logging in wouldn't stick.

## AI players

AI players ([architecture.md](architecture.md#ai-players)) need the agent and a language model that answers OpenAI's chat completions, which the agent asks with reasoning off and for JSON in a schema: a local one, such as one that [Ollama](https://ollama.com) runs, or a service's. Set `AGENT_SOCKET`, `AGENT_MODEL_URL` and `AGENT_MODEL` in `.env`, run `npm run dev:agent` beside `npm run dev`, and let your account have AI players with `admin.cjs agents allow <username>`: in the private rooms it chairs, the waiting room offers to invite Reviewer 1. The agent's prompts are in `agent/src/prompts.ts`; change `PROMPT_VERSION` with them.

## Running in production

The build needs only Node. Build it with its version, the latest one in the commit titles on `main`, since a change to the [docs for people](rules/versioning.md#docs-for-people) alone lands without one:

```bash
APP_VERSION="$(git log --first-parent --format=%s | awk '!v && /^v[0-9]+\.[0-9]+\.[0-9]+ / { v = $1 } END { if (!v) exit 1; print v }' || git rev-parse --short HEAD)" npm run build
```

Copy `server/dist/`, `client/dist/`, `mailer/dist/`, `agent/dist/` and `words/` in the same layout and run `node server/dist/index.cjs`. What the code expects of any deployment:

- **`DATA_DIR`** set to a writable directory, and in your backups.
- **A restart after replacing the build**.
- **Behind a reverse proxy**, the `Host` header and the WebSocket upgrade passed through, `TRUST_PROXY=1`, and the player's address in `X-Forwarded-For`, or all players share one address's limits. Any proxy other than Cloudflare must drop the `CF-IPCountry` header, or a client can choose the country it is counted under.
- **For accounts**, HTTPS only, HTTP redirected, HSTS on, and `COOKIE_SECURE` on.
- **For email**, the secret from a file only the service reads (`SERVER_SECRET_FILE`), and the mailer as a service of its own on `MAILER_SOCKET`. Only the mailer needs the internet, Resend's key and a state directory.
- **For AI players**, the agent as a service of its own on `AGENT_SOCKET`, set for both. Only the agent needs to reach the language model.
- **The status page** is `http://127.0.0.1:<STATUS_PORT>` on the server's own machine.

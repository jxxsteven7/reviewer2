# Hard constraints

Follow these in every line of code. Reviewers check them item by item.

## Access from mainland China

- Don't use any Google services, such as Firebase, Google Fonts, Google Analytics, Google Sign-In or reCAPTCHA.
- Don't load anything from public CDNs such as unpkg, jsDelivr or cdnjs. Bundle fonts, scripts and icons into the project and serve them from our own server.
- Keep the architecture simple: one Node process serves both the static front end and WebSocket, on one domain and one port. The status page for the operator is the one exception: the same process may serve it on a second port that only the server's own machine can reach, and nothing that players use goes there; see [../architecture.md](../architecture.md#status). The mailer is a program of its own, but it serves nothing to players: only the game server talks to it, over a Unix socket; see [../architecture.md](../architecture.md#mail).
- Before adding an external dependency or third-party service, confirm that it is available and reliable in mainland China.

## Intellectual property

- The first game borrows its mechanics from a commercial board game. **The name of that game must not appear anywhere**: not in the UI, copy, code identifiers, docs, file names, commit messages, branch names or PR titles and descriptions, in English or in Chinese.
  - `scripts/check-names.mjs` enforces this. It checks files and file paths, in the `pre-commit` hook on your machine and in the `Forbidden name` check in CI. `scripts/check-commits.mjs` uses it to check commit messages, PR titles and descriptions, and branch names, in the `commit-msg` hook and in the `Commits and version` check. It stores the name only as hashes, so the script doesn't contain it either.
  - If the check flags something by mistake, rephrase the text. Don't weaken the check.
- All word lists are original. Don't use the official word list of any commercial board game.
- Art, icons and color schemes are original and don't imitate the original game's visual design.

## Game state

- The server is authoritative. Clients only send actions to the server and never change game state themselves.
- State is filtered by role. The colors of unrevealed cards are sent only to captains. The data that guessers and spectators receive must not contain them, so they can't be found even with developer tools.
- Reads and writes to browser local storage are wrapped in error handling, and the game still works when storage is unavailable.

## UI

- All UI text lives in the locale files (`zh.json` and `en.json`), never hard-coded in components, and every string exists in both languages. The status page for the operator is the one exception: it is a tool for whoever runs the server, not part of the game, so it is in English only and its text lives with its template in `server/src/statusPage.ts`.
- The UI is mobile-first and works in WeChat's built-in browser.
- Don't break reconnection. After a refresh or a locked screen, players return to their room, team and role.

## Secrets

- Never commit passwords, keys or tokens. Use environment variables. `.env` is already ignored by `.gitignore`.

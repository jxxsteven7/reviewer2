# Hard constraints

Reviewers check these item by item.

## Access from mainland China

- No Google services: Firebase, Google Fonts, Google Analytics, Google Sign-In, reCAPTCHA.
- Nothing from public CDNs such as unpkg, jsDelivr or cdnjs. Fonts, scripts and icons are bundled and served by our own server.
- One Node process serves the front end and WebSocket on one domain and one port. The only exceptions, which serve no player, are the operator's status page ([status](../architecture.md#status)) and the mailer ([mail](../architecture.md#mail)).
- Check that any new dependency or third-party service is available and reliable in mainland China.

## Intellectual property

- The first game borrows its mechanics from a commercial board game. **That game's name appears nowhere**: not in the UI, copy, identifiers, docs, file names, commits, branch names, PR titles or descriptions, in English or Chinese. `scripts/check-names.mjs` and `scripts/check-commits.mjs` enforce it, in the local hooks and in CI, holding the name only as hashes. Rephrase what a check flags by mistake; never weaken the check.
- All word lists are original: never the official word list of a commercial board game.
- Art, icons and colors are original and don't imitate that game's look.

## Game state

- The server is authoritative. Clients send actions and never change game state themselves.
- State is filtered by role. The colors of unrevealed cards go to captains only; guessers and spectators must not receive them, so developer tools can't find them.
- Browser local storage is read and written inside error handling, and the game works without it.

## UI

- All UI text lives in `zh.json` and `en.json`, never in components, every string in both. The one exception is the operator's status page, in English only, in `server/src/statusPage.ts`.
- Mobile-first, and works in WeChat's built-in browser.
- Reconnection keeps working: after a refresh or a locked screen, players return to their room, team and role.

## Secrets

- Never commit passwords, keys or tokens. Use environment variables; `.env` is ignored by git.

## The live deployment

- Don't describe how the project's own servers are run (hosts, network, the services in front of them, paths, ports, service units, sandboxing, release scripts) in files, commits, issues, PRs or review comments. The operators keep that to themselves.
- Describe what the code supports, in terms that fit any deployment ([../development.md](../development.md#running-in-production)), with placeholders or made-up values in examples and tests.

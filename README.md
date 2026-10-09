# Reviewer 2

**English** | [简体中文](README.zh-CN.md)

**Online party games for academics.** Play in the browser: everyone joins the same room from their own phone or laptop. Pick a nickname and you're in, with no sign-up.

## What it is

- **Academic themes.** The games are built around everyday academic life: peer review, submissions, lab meetings, grant applications and thesis defenses. There is no general-audience edition.
- **A shared word library.** At the core is a library of academic terms, organized by field, contributed by the community and shared by all the games.
- **Made for peers.** The project is non-profit and has no ads.

### The first game: team word guessing

Two research groups, Red and Blue, face off over 25 academic terms. Each group's captain knows which cards belong to their group, but may give only **one word and one number** as a clue. The rest of the group then flips cards based on the clue. Flip an irrelevant paper or one of the other group's cards and your turn ends. Flip **Reviewer 2** and your paper is rejected on the spot: your group loses. That card gave the project its name.

The game is called **Double Blind** for now. In the code, its module is called `keywords`, and [docs/games/keywords.md](docs/games/keywords.md) has the full rules.

## Features

- Bilingual interface in Chinese and English
- Playable worldwide, **including mainland China**: no Google services and no public CDNs; fonts, scripts and icons are all self-hosted
- Mobile-first, and works in WeChat's built-in browser
- Reconnects automatically after a phone locks or the browser goes to the background, returning players to their room, team and role
- Server-authoritative, with data filtered by role: guessers can't see the colors of unrevealed cards, even with the browser's developer tools

## Status

🚧 In early development. The first game can be played from a local build (see [Running locally](#running-locally)), but it isn't online yet. Once it launches, it will live at <https://playreviewer2.com>.

The first version has a game lobby, creating and joining rooms, choosing teams and roles, separate captain and guesser views, a view for a projector, real-time sync, automatic reconnection, a bilingual interface, a default "general academia" word list with a validation script, and "play again".

## Tech stack

| Part | Choice |
|---|---|
| Language | TypeScript, front end and back end, in an npm workspace |
| Front end | Vue 3 + Vite, vue-i18n |
| Back end | Node.js + Socket.IO |
| Storage | Room state in server memory; no database in the first version |
| Tests | Vitest, and Playwright end to end |
| Deployment | One Node process serves both the static front end and WebSocket, on one domain and one port |

## Project layout (planned)

| Path | Contents |
|---|---|
| `client/src/core/` | Front-end shared layer: connection, rooms, lobby, i18n |
| `client/src/games/` | Each game's UI, such as `keywords/` |
| `client/src/locales/` | `zh.json` and `en.json` |
| `server/src/core/` | Back-end shared layer: room management, player identity, connections |
| `server/src/games/` | Each game's rules and state |
| `shared/` | Types shared by the front end and back end |
| `words/` | Word lists, one JSON file per field |
| `docs/` | Documentation and project rules |

## Running locally

You need [Node.js](https://nodejs.org) 22.13 or later, but not 23 or 25, which the test runner doesn't support. CI uses 24 LTS.

```bash
npm install   # also turns on the git hooks
npm run dev   # front end on http://localhost:5173, server on port 3000
```

`npm run build && npm start` runs the production build on one port, <http://localhost:3000>. The other commands, testing on a phone, running in production and the environment variables are in [docs/development.md](docs/development.md).

## Contributing

Contributions of code, words and ideas are welcome. The full rules are in **[CONTRIBUTING.md](CONTRIBUTING.md)**. The core rules are:

1. **`main` is protected.** Nobody, maintainers included, commits or pushes to `main` directly. Every change goes through a pull request.
2. **Work on your own branch.** Project members use a git worktree with its own branch. Outside contributors fork the repository and work on a branch in their fork.
3. **All code is reviewed.** Whether it was written by a person or by AI, by a member or by an outside contributor, someone other than the author must approve it before it is merged.
4. **No AI or agent attribution in commits.** The committer is responsible for what they submit.
5. **The repository is written in English.** Code, comments, commit messages, docs and rules use standard English. This README's Chinese translation is the only translated document, and CI keeps the two in sync.
6. **Every pull request is squash-merged and versioned.** It lands on `main` as one commit titled `vX.Y.Z <type>: <summary>`. CI raises the patch number by one for every PR, and maintainers decide when the minor or major number goes up. See [docs/rules/versioning.md](docs/rules/versioning.md).

If you work with Codex or Claude Code, they read `AGENTS.md` and `CLAUDE.md` automatically and follow the same rules. The rule files live in `docs/rules/`, and you can reference them in a chat with `@`, for example `@docs/rules/review.md`.

### Project members

Start each piece of work in its own worktree and branch, and keep the main checkout on `main`:

```bash
git fetch origin
git worktree add ../fix-reconnect -b fix/reconnect origin/main
cd ../fix-reconnect
# edit and commit, then:
git push -u origin fix/reconnect
```

Then open a pull request on GitHub and wait for review. The directory layout, local hooks and cleanup after merging are covered in [docs/rules/git.md](docs/rules/git.md).

### Outside contributors (fork)

1. **Fork** this repository on GitHub.
2. Clone your fork, add this repository as `upstream`, and create a branch from the latest upstream `main`:

   ```bash
   git clone git@github.com:<your-username>/reviewer2.git
   cd reviewer2
   git remote add upstream https://github.com/jxxsteven7/reviewer2.git
   git fetch upstream
   git switch -c fix/lobby-typo upstream/main
   ```

3. Commit your changes and push them to your fork: `git push -u origin fix/lobby-typo`.
4. Open a pull request against `main` in this repository and fill in the template.
5. A maintainer reviews it. Push any follow-up changes to the same branch. Once the PR is approved, a maintainer merges it.

For larger changes, please open an issue first.

### Contributing words

The word library in `words/` is shared by all the games, with one JSON file per academic field. A good term is short, and everyone in its field knows it, such as "attention", "convergence", "baseline" or "generalization". A word-list PR changes the files under `words/`, and also `scripts/check-words.mjs` and its tests when it changes the format; it is reviewed like any other PR. The format, what makes a good term and how each game uses the library are described in [words/README.md](words/README.md).

All terms must be original. Do not use the official word list of any commercial board game.

## License

License files will be added before the repository goes public. The plan is MIT for the code and CC BY-SA 4.0 for the word lists.

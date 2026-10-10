# Reviewer 2

**English** | [简体中文](README.zh-CN.md)

**Online party games for academics.** Everyone joins a room from their own phone. A nickname is enough; an account is optional.

## What it is

- **Academic themes.** Peer review, submissions, lab meetings, grants and defenses.
- **A shared word library** of academic terms, by field, contributed by the community.
- **Made for peers.** Non-profit, with no ads.

### The first game: team word guessing

Two research groups, Red and Blue, face off over 25 academic terms. Each group's PI knows which cards are theirs but may give only **a short clue and a number**; the students then flip cards. Flip an irrelevant paper or the other group's card and the turn ends. Flip **Reviewer 2** and your paper is rejected on the spot: your group loses.

**Double Blind** is its name for now; its module is `keywords`, and [docs/games/keywords.md](docs/games/keywords.md) has the rules.

## Features

- Bilingual, Chinese and English
- Playable **in mainland China**: no Google services or public CDNs
- Mobile-first; works in WeChat's browser
- Reconnects after a locked screen to the same seat
- Server-authoritative: guessers can't see unrevealed colors, even with developer tools
- Optional accounts: an avatar, a record of games, and an email address only for resetting a password, never stored
- Matches: several scored games in a row, with titles

## Status

🚧 Early development. The first game is online at <https://playreviewer2.com>; you can also run your own copy ([Running locally](#running-locally)).

## Tech stack

| Part | Choice |
|---|---|
| Language | TypeScript, in an npm workspace |
| Front end | Vue 3 + Vite, vue-i18n |
| Back end | Node.js + Socket.IO |
| Storage | Rooms in memory; feedback and accounts in SQLite (`node:sqlite`); avatars as files |
| Tests | Vitest, and Playwright end to end |
| Deployment | One Node process on one port, plus a small mailer |

## Project layout

| Path | Contents |
|---|---|
| `client/src/` | The Vue app: `core/` shared, `games/<game>/` each game's screens, `locales/` all interface text |
| `server/src/` | The server: `core/` rooms, `games/<game>/` each game's rules, `accounts/`, `store/` the database |
| `shared/` | Types and rules used by both sides |
| `mailer/` | The program that sends the mails of accounts |
| `words/` | Word lists, one JSON file per field |
| `e2e/`, `scripts/`, `docs/` | End-to-end tests, repository checks, documentation |

## Running locally

You need [Node.js](https://nodejs.org) 22.22.2 or later (24.15 or later on Node 24), but not 23 or 25.

```bash
npm install   # also turns on the git hooks
npm run dev   # front end on http://localhost:5173, server on port 3000
```

The other commands, testing on a phone and the environment variables are in [docs/development.md](docs/development.md).

## Contributing

The rules are in **[CONTRIBUTING.md](CONTRIBUTING.md)**; in short:

1. `main` is protected: every change is a pull request from a branch of your own, or from a fork.
2. Someone other than the author reviews every PR; a collaborator merges it once approved and green.
3. No AI or agent attribution in commits.
4. The repository is in English; this README is the only translated file.
5. Every PR is squash-merged as one versioned commit; see [docs/rules/versioning.md](docs/rules/versioning.md).

AI assistants read `AGENTS.md`.

### Contributing words

One JSON file per field in `words/`, shared by all games. A good term is short and known to everyone in its field, and all terms are original. See [words/README.md](words/README.md).

## License

The code is under the [MIT License](LICENSE). The word lists in `words/` are under [CC BY-SA 4.0](words/LICENSE).

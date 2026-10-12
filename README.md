# Reviewer 2

**English** | [简体中文](README.zh-CN.md)

**Online party games for academics.** Everyone joins a room from their own phone. A nickname is enough to join; an account, which we recommend, keeps your avatar and records.

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
- Optional accounts: an avatar, a record of games, friends, an academic rank and a public page; see [Privacy](#privacy)
- Matches: several scored games in a row, with titles
- Public rooms: play with strangers, with an account, and report players who misbehave

## Privacy

What we promise players:

- **An account is recommended, not required.** A nickname is enough to play; an account keeps your avatar, records, rank and titles from game to game.
- **Only your friends** see whether you are online and whether you are in a room, and the room's code only when it is public. The players in a room see who is in it with them, as always; nobody else learns any of this.
- **Your public page** shows anyone who opens it your username, avatar, rank, titles, player number and the day you registered, with the link and the line you chose to write; your record and your acknowledgments only if you turn that on. Everyone sees how many accounts like it; only you see which.
- **Passwords** are kept only as a one-way hash. Nobody, the operator included, can read them.
- **An account's email address is never stored.** The server keeps only a keyed fingerprint of it, to check the address and to mail a password reset.
- **No IP addresses or names in the logs.** Statistics are counts only: players, rooms and countries.
- **Feedback** is read only by the project's operator, unless you agree to its becoming a GitHub issue, which shows its text and the name you left, never your contact. A contact is kept as written and deleted after 90 days. The feedback itself is kept as the project's archive of suggestions; only what the operator discards, such as spam, is deleted 30 days after it is discarded.
- **Reports** of players in public rooms are read only by the operator, and kept for good. A report keeps who reported whom, the name the reported player had in the room, the room's number and the note the reporter wrote.
- **Replays** of finished games are kept for good when a player with an account took part, for them to watch again: the board, the clues, and the nicknames of those who revealed a card, guests included. A room with the chair's own words keeps none.
- **Deleting an account** deletes everything of it, except that feedback sent from it, acknowledgments counted for it, reports it sent or got, and replays of games it played in, which others played in too, stay, no longer linked to it; backups keep the rest only until they expire.

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

A local copy needs no key for any outside service. For email, copy `.env.example` to `.env` and run `npm run dev:mailer` beside `npm run dev`: the mails are printed, not sent. The other commands, testing on a phone and the environment variables are in [docs/development.md](docs/development.md).

## Contributing

The rules are in **[CONTRIBUTING.md](CONTRIBUTING.md)**; in short:

1. `main` is protected: every change is a pull request from a branch of your own, or from a fork.
2. Someone other than the author reviews every PR, except a maintainer's own PR for the [docs for people](docs/rules/versioning.md#docs-for-people); a collaborator merges it once approved and green.
3. No AI or agent attribution in commits.
4. The repository is in English; this README is the only translated file.
5. Every PR is squash-merged as one commit, with a version unless it changes only docs for people; see [docs/rules/versioning.md](docs/rules/versioning.md).

AI assistants read `AGENTS.md`.

Players whose suggestions are adopted, who add words or who test early versions are thanked, by name or anonymously, in [ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md) and at the foot of the home page. Sponsors are thanked in [SPONSORS.md](SPONSORS.md), also at the foot of the home page.

### Contributing words

One JSON file per field in `words/`, shared by all games. A good term is short and known to everyone in its field, and all terms are original. See [words/README.md](words/README.md).

## Support

Reviewer 2 is free to play, with no ads. If you enjoy it, buy the author a cola with WeChat from the foot of the home page, or sponsor the author on [GitHub Sponsors](https://github.com/sponsors/jxxsteven7).

## License

The code is under the [MIT License](LICENSE), except `shared/src/han-variants.ts`, which is built from the data of OpenCC and stays under the [Apache License 2.0](shared/LICENSE-OpenCC). The word lists in `words/` are under [CC BY-SA 4.0](words/LICENSE).

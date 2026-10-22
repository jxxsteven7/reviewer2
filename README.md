# Reviewer 2

**English** | [简体中文](README.zh-CN.md)

**Online party games for academics.** Everyone joins a room from their own phone. Nothing is needed to join; an account, which we recommend, keeps your avatar and records.

## What it is

- **Academic themes.** Peer review, submissions, lab meetings, grants and defenses.
- **A shared word library** of academic terms, by field, contributed by the community.
- **Made for peers.** Non-profit, with no ads.

### The first game: team word guessing

Two research groups, Red and Blue, face off over 25 academic terms. Each group's PI knows which cards are theirs but may give only **a short clue and a number**; the students then flip cards. Flip an irrelevant paper or the other group's card and the turn ends. Flip **Reviewer 2** and your paper is rejected on the spot: your group loses.

**Double Blind** is its name for now; its module is `keywords`, and [docs/games/keywords.md](docs/games/keywords.md) has the rules.

### The second game: finding Reviewer 2

Four to twelve players each get a term. The students share one; **Reviewer 2** gets a similar one and doesn't know it; from six players on, a PI gets none. In turn, everyone describes their term in a few words, then all vote someone out. Reviewer 2 wins by lasting until two or three players are left, the PI by outlasting every Reviewer 2, and the students by voting them all out. Players show as numbers, and who had which shows at the end.

**Who's Reviewer 2?** is its name for now; its module is `impostor`, and [docs/games/impostor.md](docs/games/impostor.md) has the rules. It is in **beta**: its rules, points and pairs of terms may still change, and before 1.0 a big update may clear this game's records so far. Accounts, friends and the first game's records stay, and you can keep playing; it is how the game gets better.

## Features

- Bilingual, Chinese and English
- Playable **in mainland China**: no Google services or public CDNs
- Mobile-first; works in WeChat's browser
- Reconnects after a locked screen to the same seat
- Server-authoritative: even with developer tools, guessers can't see unrevealed colors, nor players the others' terms
- Optional accounts: an avatar, a record of games, friends and friend titles, an academic rank and a public page; see [Privacy](#privacy)
- Matches: several scored games in a row, ranked by total; the first game's award titles
- Public rooms: play with strangers, with an account, and report players who misbehave
- A tutorial for newcomers, in chapters to read in any order: each game step by step, as a student and as the PI, with a finger on what to tap, and the site, from making a room to sending feedback; how far you have read stays on your device
- AI players, being tried out: Reviewer 1 can play a group's PI or student, advise people, and play the turn of a player who has gone offline; in the second game it describes, votes and judges reports like anyone; it has a page of its own as player number 0; anyone with an account can play with it from the home page, alone, where it takes the other seats, or with friends, where it takes the seats nobody takes; see [Privacy](#privacy)

## Privacy

What we promise players:

- **An account is recommended, not required.** Nothing is needed to play: a guest gives no name, and is numbered in each room in the order guests come in, as Guest 1, Guest 2 and so on; an account keeps your avatar, records, rank and titles from game to game, and how you last set up a room, for the next one; only you see that.
- **Only your friends** see whether you are online and whether you are in a room, whether a game is on there and which of their other friends are in it with you, and the room's code only when it is public or they are in the room too. The players in a room see who is in it with them, as always; nobody else learns any of this, but for the operator, who can see on the server's own machine which accounts are connected at that moment, in which room and from which country, by account id alone; the server keeps none of it.
- **A line with a friend request** is for the account you ask alone, and is deleted once the request is answered or withdrawn. **The names you give your friends** are yours alone: your friends aren't told, and nobody else sees them.
- **Friend titles**, such as your Co-First Author, are counted from the games you played with each friend, and only you see them: on your friends list and on a friend's page.
- **Your public page** shows anyone who opens it your username, avatar, rank, titles, player number and the day you registered, with the link and the line you chose to write; your record, and how many of your feedback contributions were adopted, each until you turn it off (accounts registered before these were on by default show each only once turned on). Everyone sees how many accounts like it; only you see which. Anyone with an account can find it in the friend search by your full username or by its link, never by a part of your username.
- **Passwords** are kept only as a one-way hash. Nobody, the operator included, can read them.
- **An account's email address is never stored.** The server keeps only a keyed fingerprint of it, to check the address and to mail a password reset.
- **No IP addresses or names in the logs.** Statistics are counts only: players, rooms and countries.
- **Feedback** is read by the project's operator, and what you write may become a public GitHub issue, with your name if you sign it, and never your contact. The issue of a bug report also says which version of the site it came from and the names and versions of your browser and system, read from the user agent that your browser sends with a bug report, which the server keeps and which may name a phone's model; the model never goes to GitHub. Feedback that is adopted always does, and the home page lists it among the feedback contributions by your name, or as from an anonymous player if you chose to stay anonymous. Signed while you are logged in, it keeps your account and no name, and is listed by the account's avatar and username as they are now, which open your public page, or as from a deleted player once you delete the account; without an account, you type the name to sign with. Feedback sent while you are logged in is linked to your account, which counts how much of it was adopted, signed or not, and feedback sent from the card at the end of a game is linked to that game. A contact is kept as written and deleted after 90 days. The feedback itself is kept as the project's archive of suggestions; only what the operator discards, such as spam, is deleted 30 days after it is discarded.
- **Issues on GitHub** that the operator adopts are listed among the feedback contributions too, by the GitHub username of the issue's author, linked to their GitHub page, or as from an anonymous player if they asked so on the form; the server keeps the username and the id of the GitHub account as they were when the issue was adopted, so that the author can still be told once the account is renamed, and at the author's request lists them anonymously or drops both. A security problem reported privately is listed the same way once it is fixed and its advisory published.
- **Reports** of players in public rooms are read only by the operator, and kept for good. A report keeps who reported whom, the name the reported player had in the room, the room's number and the note the reporter wrote.
- **Every game is recorded** for good, however it ended and whoever played in it, a game with the chair's own words included: the board, every move and when it came, such as each clue and reveal, what the players said in their group's chat, during the game and after it as the group talks it over until the next game, and who did each, linked to their account if they have one; when anyone came or left, when time ran out on players who were offline, and how the game ended. Cards chosen but not revealed, quick reactions and who was offline for a moment are not recorded. The marks that a group's students put on the cards are recorded only as they stood when the group revealed a card, when a turn ended and when the game ended, never each change, and no replay shows them. The cards a PI marks as the ones a clue is meant for are hidden from everyone during the game and shown to everyone in the room afterwards. The players with accounts can watch a finished game again: the board, the clues and the groups, without the chat. A replay keeps no name: it shows each account as it is when the replay is opened, with its username and avatar, or a friend by the name you give them, a deleted account as a deleted player, and guests by their numbers in the room.
- **In the second game** the record keeps, in the same way, which number each player had, every description, vote and guess of the term, every report and how each player judged it, what was said in the off-field chat and after the game, and the two terms a setter gave. Its replay shows the descriptions, the votes, the reports and who had which number, without the chats.
- **After a game that finished**, you may rate it, such as its words, and after a game with AI players, guess which players they were; both are kept with the record of the game, by the player you were in it. The ratings decide which words come up more often and which no longer do.
- **Words you give** for a game, a setter's two terms or a chair's own words, may be adopted into the shared word library, credited to your account unless you chose to stay anonymous.
- **What the records are for:** training and testing the game's AI players, and research: they may be published as a dataset, without names or accounts. Registering asks you to agree to this, and the account keeps which version of the notice you agreed to and when; a guest is reminded of it on the way into a room. When an AI plays in a game, as an AI player or for someone who went offline, the record keeps each of its moves with the model it asked, how long the model was let think and what it thought before it answered, and the reason it gave, and the game brings nobody points, a streak, a title or a friend title.
- **Deleting an account** deletes everything of it, except that feedback sent from it, whose adopted pieces stay on the home page, as from a deleted player if you signed them, though a GitHub issue already published keeps the name on it, reports it sent or got, its words adopted into the library, credited to nobody, and the records of games it played in or set the words of, which others played in too, stay, no longer linked to it: their replays show it as a deleted player, by no name, and what it said, reported, rated and guessed in them stays, as anonymous as the rest of the records; backups keep the rest only until they expire.

## Status

🚧 Early development. The first game is online at <https://playreviewer2.com>, and a short video in Chinese shows it, on [Bilibili](https://www.bilibili.com/video/BV1zWnV6dEZJ/) and [Xiaohongshu](https://www.xiaohongshu.com/explore/6ad4e5dd00000000260167e2?xsec_token=AByTN8Z8X6brbc3zw_WfC7p2wDOBsnAxwnBSDCy9YLHzU=); you can also run your own copy ([Running locally](#running-locally)).

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
| `agent/` | The program that asks a language model for the AI players' moves |
| `words/` | Word lists, one JSON file per field |
| `e2e/`, `scripts/`, `docs/` | End-to-end tests, repository checks, documentation |

## Running locally

You need [Node.js](https://nodejs.org) 24.15 or later, but not 25.

```bash
npm install   # also turns on the git hooks
npm run dev   # front end on http://localhost:5173, server on port 3000
```

A local copy needs no key for any outside service. For email, copy `.env.example` to `.env` and run `npm run dev:mailer` beside `npm run dev`: the mails are printed, not sent. AI players also need a language model, and `npm run dev:agent`. The other commands, testing on a phone and the environment variables are in [docs/development.md](docs/development.md).

## Contributing

The rules are in **[CONTRIBUTING.md](CONTRIBUTING.md)**; in short:

1. `main` is protected: every change is a pull request from a branch of your own, or from a fork.
2. Someone other than the author reviews every PR, except a maintainer's own PR for the [docs for people](docs/rules/versioning.md#docs-for-people); a collaborator merges it once approved and green.
3. No AI or agent attribution in commits.
4. The repository is in English; this README is the only translated file.
5. Every PR is squash-merged as one commit, with a version unless it changes only docs for people; see [docs/rules/versioning.md](docs/rules/versioning.md).

AI assistants read `AGENTS.md`.

Players whose feedback is adopted, and developers whose issues are, are listed, by name or anonymously, among the feedback contributions on the home page; each is a GitHub issue labeled [adopted](https://github.com/jxxsteven7/reviewer2/issues?q=label%3Aadopted), or a published security advisory. Those who wrote the code are GitHub's [contributors](https://github.com/jxxsteven7/reviewer2/graphs/contributors). The maintainers thank others in [ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md), and sponsors in [SPONSORS.md](SPONSORS.md), both also on the home page.

### Contributing words

One JSON file per field in `words/`, shared by all games. A good term is short and known to everyone in its field, and all terms are original. See [words/README.md](words/README.md).

## Support

Reviewer 2 is free to play, with no ads. If you enjoy it, buy the author a cola with WeChat from the foot of the home page, or sponsor the author on [GitHub Sponsors](https://github.com/sponsors/jxxsteven7).

## License

The code is under the [MIT License](LICENSE), except `shared/src/han-variants.ts`, which is built from the data of OpenCC and stays under the [Apache License 2.0](shared/LICENSE-OpenCC). The word lists in `words/` are under [CC BY-SA 4.0](words/LICENSE), and so is `words/dictionary/han-glosses.json`, the English meanings of the characters of the lists, built from [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict).

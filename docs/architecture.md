# Architecture

How the app is put together. The constraints are in [rules/constraints.md](rules/constraints.md), the first game's rules in [games/keywords.md](games/keywords.md).

## One process, one port

One Node process serves everything on one port: the built front end, `/healthz`, the lists of thanks and the account API under `/api/`, avatars under `/avatars/` and Socket.IO under `/socket.io/`. Rooms live in memory and end with the process; feedback and accounts are in a SQLite database, avatars as files beside it ([Data](#data)). The only other things, serving no player, are the operator's status page, on a second port reachable only locally ([Status](#status)), and the mailer, a program of its own that alone holds the mail service's key and talks to the internet; the game server asks it over a Unix socket to send a mail, and needs no internet itself ([Mail](#mail)).

| Layer | Where | What it does |
|---|---|---|
| Shared | `shared/src/` | Types and rules both sides run; `schemas.ts` for the server alone |
| Server core | `server/src/core/` | Rooms, players, connections, limits, the word library |
| Server games | `server/src/games/<game>/` | One module per game: seats, rules, views |
| Server accounts | `server/src/accounts/` | Logins, the account API, email, avatars |
| Server store | `server/src/store/` | The database and what is kept in it |
| Mailer | `mailer/` | Sends the mails of accounts ([The mailer](#the-mailer)) |
| Client core | `client/src/core/` | Connection, rooms, lobby, language |
| Client games | `client/src/games/<game>/` | Each game's screens |

## Rooms

- **Codes:** four characters of Crockford's base32, shown as `R2-K7QX`, linked as `/room/K7QX`; `parseCode()` in `shared/src/codes.ts` reads them. Codes are reused, so every snapshot carries a random `roomId`.
- **Phases:** `lobby`, `playing`, `ended`, back to `lobby`. Each game has a random `gameId`. A room can be a [match](#matches).
- **The chair** is the first member and alone changes settings, starts and ends games and matches, shuffles, benches, removes, hands the chair on, or closes the room. When the chair leaves, or is offline for 3 minutes, the earliest-joined online member takes over.
- **Playing or watching.** A newcomer sends `play: true` to play; the game decides what that means ([seats](games/keywords.md#seats)). A returning member keeps their seat. A removed one stays out by their member key, which is the account's for a player who is logged in and the browser's otherwise, and by the keys of the browsers they were connected from: for as long as the room lasts (`removed`) if it was public when they were removed, and for 2 minutes (`removed_recently`) if it was private, whatever it becomes later. A room remembers its last 200 removals.
- **Revisions.** Every change bumps `rev`.
- **Screens,** such as a projector, watch without a token or seat, through `room:watch`, with a spectator's view; up to 5 per room. In a public room a screen takes an account with a seat there, one screen each ([Public rooms](#public-rooms)).

## Public rooms

- **Listing.** A room is private unless its creator makes it public, or the chair does in the waiting room (`room:public`). The home page lists public rooms (`meta:rooms`): code, game, language, fields, member count and whether a game is on; no full rooms or rooms with nobody online; at most 50, waiting rooms first, then the oldest.
- **Accounts.** Creating, listing or joining a public room, by the list, code or link, takes an account (`account_required`), so that players can be reported and barred. Guests and screens already in a room stay when it is listed. A new screen there takes an account with a seat (`not_member`), one each, a new one replacing the old.
- **Reports.** A member with an account may report another (`room:report`). The `reports` table (migration 6) keeps who reported whom, the name they had, the room's code and the note, for the status page and `admin.cjs reports list`; it is an archive ([Feedback](#feedback)).
- **Bars.** `admin.cjs accounts bar` keeps an account out of public rooms (`public_barred`), not private ones. A public room whose chair could no longer list it, a barred account or a guest, goes off the list by the next sweep; everyone in it stays.

## Players and identity

- **Tokens.** A browser gets a random 32-byte token on its first connection and keeps it in local storage. Every connection first gets `session`, with the server's `version`, the `account` logged in (or null) and, when just issued, the `token`.
- **Member keys.** The server never stores tokens; it works with the token's SHA-256, which never leaves the server. An account's key is the SHA-256 of its ID, so an account is one player on every device.
- **Nicknames:** 1 to 16 characters, unique in a room; rules in `shared/src/names.ts` and `shared/src/text.ts`, shared with the client. A guest can't take a registered username (`name_reserved`).

## Messages

Everything after the page load goes over Socket.IO, except the account API ([Accounts](#accounts)). `shared/src/protocol.ts` describes the room messages; each game adds `<game>:<action>` ones.

- **Answers:** `{ ok: true, ... }` or `{ ok: false, error }`; an unknown message is `bad_request`. The client shows `errors.<code>` from the locale files.
- **Validation:** every payload against a zod schema from `shared/src/schemas.ts`, which the client never imports (ESLint refuses it): zod probes `new Function`, which the Content Security Policy forbids.
- **In order:** one connection's messages run in arrival order, and handlers never await between reading a room and writing it.
- **Snapshots.** After every visible change, each connection gets its own complete `room:state`; the client keeps the highest `rev` for its `roomId`.
- **Closing.** `room:closed` says why a room is gone: `removed` or `removed_recently`, as `room:join` would then answer, `dismissed` (a screen the chair sent away), `expired`, `left`, `closed` or `restart`.

| Message | Payload | Who and errors |
|---|---|---|
| `meta:feedback` | `kind`, `text`, `contact`?, `credit`?, `link`?, `publicIssue`?, `version`, `language`, `page` | Anyone ([Feedback](#feedback)) |
| `meta:rooms` | | Anyone; the public rooms ([Public rooms](#public-rooms)) |
| `meta:seats` | | Anyone; the rooms where they have a seat ([reconnecting](#the-handshake-and-reconnecting)) |
| `room:create` | `game`, `language`, `fields`, `settings`?, `name` (guests), `play`, `match`?, `public`? | Anyone; `bad_settings`, `bad_match`, `account_required`, `public_barred` |
| `room:join` | `code`, or `invitation` ([Friends](#friends)); `name`, `play` (newcomers); `roomId` (returning) | Anyone; `removed`, `removed_recently`, `room_full`, `account_required`, `public_barred`, `name_required`, `invitation_expired` |
| `room:watch` | `code`, `roomId` (returning screen) | A screen; `removed`, `removed_recently`, `screens_full`; in a public room `account_required`, `public_barred`, `not_member` |
| `room:leave`, `room:rename` | `name` | Members; `account_name` for accounts |
| `room:emote` | `emote`: `waiting`, `deadline`, `reviewer2` | Members; one every 10 seconds, else `emote_cooldown` with `waitMs`; in no snapshot |
| `room:report` | `playerId`, `text`? | Members with accounts, in a public room; `not_public`, `report_too_long`, `report_limited`, `report_full` |
| `room:settings` | `fields`, `settings`, `words` | The chair, in the waiting room; all or none; `match_locked`, `bad_words`, `custom_words_private` ([custom words](games/keywords.md#custom-words)) |
| `room:public` | `public` | The chair, in the waiting room; `account_required`, `public_barred`, `custom_words_private` |
| `room:start` | `round` | The chair; `stale` |
| `room:end`, `room:again` | `gameId` | The chair; `stale`; `match_over` after a match's last game |
| `room:matchEnd`; `room:matchNext` | `matchId`; and `match` (rules or null) | The chair; ends a match early; starts another or an ordinary room. `stale`, `match_over`, `wrong_phase`, `bad_match` |
| `room:shuffle`, `room:dismiss` (screens), `room:close` | | The chair |
| `room:spectate`, `room:remove`, `room:chair` | `playerId` | The chair |
| `friends:list` | | Accounts; friends with their presence, and the requests each way ([Friends](#friends)) |
| `friends:request` | `username` or `playerId` | Accounts; `no_such_account`, `no_such_player`, `not_member`, `self_friend`, `already_friends`, `request_pending`, `request_declined`, `friend_requests_full`, `friend_limited`, `friends_full` |
| `friends:accept`, `friends:decline`, `friends:remove` | `username` | Accounts; `no_such_request`, also for a name that is no account's; `friends_full` |
| `friends:invite` | `username` | Members with accounts; `not_member`, `not_friends`, also for a name that is no account's, `friend_in_room`, `friend_removed`, `friend_offline`, `invite_cooldown` |
| `friends:ignore` | `id` | Accounts; the invitation is forgotten |

## The handshake and reconnecting

The handshake carries `{ token, code, roomId }` (a screen `{ watch: code, roomId }`), and a member's connection is put back into its room before any message runs. It only brings back: its one answer is `room:closed` with `expired` for a `roomId` the code no longer has, so the client always follows it with `room:join` or `room:watch`.

The home page asks `meta:seats` once connected, after every reconnect and when it hears `room:closed` (a connection that came from a room's page is still in it), and offers a way back to each room where the connection still has a member's seat, never taking the player there by itself. Seats are found by the connection's key, its account's on every device, or by the guest seat its account would adopt; the answer gives each room's code, game and whether a game is on (`playing` until the room is back in the waiting room), at most 5, the newest first. It looks up no code, so it doesn't count against an address's codes.

## Games

A game implements `GameModule` (`server/src/core/game.ts`). The core owns the room, its members and the chair; the module owns its data and decides seats, settings, starting, messages, deadlines, views and matches. Its data is immutable. `views()` is the only way its data leaves the server, called once per snapshot for each member and the screens.

**Words.** The room draws from the chair's fields, unused words first. A module may say which words must not share a game, with `wordsClash()` ([games/keywords.md](games/keywords.md#setting-up)). `drawWords()` in `server/src/core/words.ts` takes the words in random order and keeps each that clashes with none kept before; `scripts/check-words.mjs` makes sure each list has enough such words ([../words/README.md](../words/README.md#contributing)). If short, it draws again, each time the word with the fewest clashes; when some clash all the same, the game starts and the server logs `words_clashed`.

**Time.** A module says when it next has something to do with `deadline()`. The server keeps one timer per room and calls `tick()` when it fires and before every game message, so an action for a turn whose time ran out is `stale` even before the timer fired.

**Errors.** A module that throws leaves the room as it was; the message is answered `internal` and logged.

## Replays

At the end of a game that a player with an account took part in, the room asks `GameModule.replay()` for the game as something to watch again, and keeps it as JSON in the `replays` table (migration 7), once per game, up to 64 KB; a larger one is logged as `replay_too_large` and left out, and a withdrawn game has none, nor has a game of a room with the chair's own words ([custom words](games/keywords.md#custom-words)). A replay belongs to the game, not to an account: `POST /api/account/replay` with `gameId` answers it to an account that has the game in `game_records`, and `no_replay` to anyone else. Deleting an account deletes its `game_records`, and the replay stays for the others who played in it. For the first game, a replay holds the board with every color, the clues and the guesses, who revealed each card, by player ID, and the nicknames that those who revealed a card had in the game, guests included ([games/keywords.md](games/keywords.md#replays)).

## Matches

A match plays a set number of games, scores every player in each, and ranks them by total. `MatchRules` (`shared/src/match.ts`), given at creation: 1 to 10 games (3); groups `fixed` or `switch`, made `random` by the server or by `choose` of the players. The room keeps the match (`server/src/core/match.ts`); the game scores and groups it through `GameModule.match` ([games/keywords.md](games/keywords.md#matches)). A withdrawn game isn't one of the match's. Settings are locked once a game has been scored. After the last scored game, the players still in the room are ranked by total, ties sharing a place: the highest total gets the Best Paper Award, and with three or more ranked, the lowest is the game's black hole. Ending early ranks as they stand, without titles. Each ranked account keeps the match (`TitleStore` in `server/src/store/records.ts`).

## Limits and housekeeping

- **Rate:** about 10 messages a second per connection, bursts of 20; a message is at most 16 KB.
- **Per address:** 5 rooms a minute (`ROOMS_PER_MINUTE`), 20 codes a minute that belong to no room (past them, public rooms are still found), 3 pieces of feedback every 10 minutes (`FEEDBACK_PER_10_MINUTES`). Behind a reverse proxy, `TRUST_PROXY` takes the address from `X-Forwarded-For`. **Per account:** 5 reports an hour, 30 friend requests a day, one invitation a minute to the same friend ([Friends](#friends)).
- **In one place:** `SocketLimits` in `server/src/core/socket.ts`, `RoomLimits` in `server/src/core/rooms.ts`. 30 players per room, 2000 rooms per server.
- **The sweep,** once a minute, closes rooms with nobody online for 30 minutes or nothing happening for 6 hours, and drops members offline for 10 minutes from waiting rooms.
- **Stopping:** every connection hears `room:closed` with `restart`, then the database closes; after 5 seconds the process ends anyway (`stop_timed_out`). A wrong setting, library or database stops the server before it listens (`startup_failed`, `listen_failed`).

## HTTP

Files under `/assets/` carry a content hash and are cached for good; everything else is `no-cache`. Every response carries a Content Security Policy (`script-src 'self'`, no framing) and `nosniff`.

## Data

- **`DATA_DIR`** ([development.md](development.md)) holds `reviewer2.db`, `snapshots/` and `avatars/`. Without it, the database is in memory, gone at every stop.
- **SQLite** through `node:sqlite`, synchronous; WAL mode, a 5-second wait on a lock, secure delete.
- **Migrations:** `PRAGMA user_version` and `server/src/store/migrations.ts`, run on start in one transaction, after a snapshot.
- **Snapshots** every hour into `snapshots/`, the last three kept.
- **The disk.** Feedback stops at 10,000 pieces or 50 MB, which `MAX_FEEDBACK` raises together; nothing is deleted to make room, and only what the operator puts in the trash ever goes, 30 days later ([Feedback](#feedback)). Past 1 GB nothing new is kept (`storage_full`). Avatars up to 2 GB.
- **Deleting.** Everything of an account goes with it through foreign keys, its friendships included; earlier snapshots keep it. Its feedback, its acknowledgments and the reports it sent or got stay, no longer linked to it, and so do the replays of the games it played in, which hold the nicknames of those who revealed a card and the clues, since the others played in them too ([Replays](#replays)).

## Feedback

Players send it from the foot of the home page or a room; the status page shows it. The rules are in `shared/src/feedback.ts`, run on both sides. **Kept:** text, contact, kind (a suggestion, a new game, a bug or the word lists), version, language, page, time, for a bug only the user agent, whether the player agreed to a public GitHub issue (no unless ticked), and with a name for the acknowledgments its `https://` link and the account it was given from ([Acknowledgments](#acknowledgments)). **Not kept:** address, nickname, token, member key, room code. When full, players are told (`feedback_full`).

**An archive, with a trash.** The feedback is the project's archive of suggestions: no code changes what a player sent, and `server/src/store/archive.test.ts` fails if any is added. The only changes are what players were promised and the operator's notes: **contacts are cleared after 90 days** (`contacts_cleared`), deleting an account unlinks its feedback, and `admin.cjs feedback` records what became of it (migration 9), which the status page shows as a status and a trail: `issue` the GitHub issue it became, which only feedback whose player agreed may become, with its text and name and never its contact; `resolve` the pull request that resolved it; `close` and `reopen` whether it was closed without being adopted; `adopt` thanks its player ([Acknowledgments](#acknowledgments)). The status is the first of these that holds: in the trash, closed, thanked, resolved, published as an issue, or new. `feedback delete` puts feedback in the trash and `feedback restore` brings it back; the server deletes what has been in the trash for 30 days, at start and every hour, logging only the count (`feedback_purged`). That purge is the one way a row ever goes; adopted feedback can't be deleted, since its acknowledgment points at it, and feedback in the trash still counts against the limits until it is purged. The table was rebuilt once, in migration 5, every row copied with its id, so that its kinds are checked in `shared/src/feedback.ts` alone and a new kind needs no migration; since then, migrations only add to it. The reports of players are a strict archive: no row is deleted ([Public rooms](#public-rooms)).

## Acknowledgments

The players who helped are thanked as a paper thanks people, in one list: `ACKNOWLEDGMENTS.md`, which maintainers write by hand and the home page shows ([Lists of thanks](#lists-of-thanks)). Its sections are Helpful discussions (suggestions, new games and bug reports), Data (word lists) and Pilot study (playtesting), whose headings the page shows in its language. An entry is a name, which follows the nickname rules, perhaps with an `https://` link, or `An anonymous player`; then ` — ` and what they did, in plain English, where `#12` links to that issue or pull request ([format](development.md#acknowledgments)). `shared/src/acknowledgments.ts` has the rules.

The `acknowledgments` table, migration 4, only records whom the operator thanked with `admin.cjs`: `feedback adopt`, for feedback with or without a name, and `acknowledgments add`, by hand, such as for a playtester. Both print the entry for the file. A row counts for an account only when the player left a name while logged in, or the operator named the account, and the account's page shows how often it is thanked for each kind. Which account goes with which entry stays in the database, never in the file or the API. The table is a strict archive: no command deletes or changes a row, and deleting an account only unlinks its rows; the feedback a row came from can't be deleted either ([Feedback](#feedback)).

## Sponsors

`SPONSORS.md` thanks the sponsors by name alone: no amounts, tiers, or whether they give monthly. Every day, `.github/workflows/sponsors.yml` asks GitHub for the maintainer's public sponsors, ended ones too, the oldest first, and writes their usernames, linked to their profiles, between the two lines that mark the section `GitHub Sponsors` (`scripts/update-sponsors.mjs`); a sponsor who makes their sponsorship private drops off at the next run. A change goes to a PR of the maintainer's own, which merges without a version once CI passes. Maintainers add those who sponsor in other ways, such as a WeChat tip, under `Other ways`, and only if they ask, by a name that follows the nickname rules, perhaps with an `https://` link ([format](development.md#sponsors)). `shared/src/sponsors.ts` has the rules.

## Lists of thanks

The home page folds the acknowledgments and the sponsors until a player opens one, and only then asks `GET /api/acknowledgments` or `GET /api/sponsors` for its sections. The build bundles both files into the server. With `CONTENT_DIR`, the server shows the copies in that directory instead, so a list changes without a new build or a restart: each request compares the file's modification time, size and inode with those of the copy read last, and the server reads the file again only when they differ, or when it couldn't open or read it the last time, such as for its permissions. A file that is missing, over 64 KiB, not UTF-8 or against the rules leaves the bundled copy in use, and the log says why with `thanks_list_skipped`, once for each new reason. The server never writes to the directory. One parser checks both files, on the server and in CI (`server/src/thanks.test.ts`), by the rules in `shared/src/lists.ts` and those of each list. Names are plain text; links, only `https://`, open in a new tab with `rel="nofollow ugc noopener"`.

## Accounts

Optional: a username and a password, with an avatar, a record of games, titles, acknowledgments, and, if wanted, an email address for resetting a forgotten password, which itself is never kept.

- **Usernames** follow the nickname rules, with at least 2 characters and no reserved names; `usernameKey()` in `shared/src/accounts.ts` compares them.
- **Passwords:** 8 to 128 characters after NFKC, as scrypt hashes, N = 2^15, r = 8, p = 3 (`server/src/accounts/passwords.ts`). Two hashes at a time, then `busy`.
- **Logins:** a 32-byte secret in a cookie, kept as its SHA-256 (`sessions`). `HttpOnly`, `SameSite=Lax`, `Path=/`, and unless `COOKIE_SECURE=0`, `Secure` with `__Host-`. Ends after 30 days unused, a year in all, or on logout or a password change; its connections then get `account:ended`.
- **Connections.** The handshake reads the cookie; a logged-in connection takes its member key from the account. A guest's seat becomes the account's when the browser logs in and comes back.
- **Records.** At a game's end the room asks `GameModule.results()` and keeps the result per account, with the game's points ([Academic ranks](#academic-ranks)).

## Friends

Accounts only; guests see none of it. `shared/src/friends.ts` has the types, the limits and the error codes.

- **Requests.** An account asks another by username (`friends:request`), or a player in the same room by their ID from the player menu, if both have accounts. The other side accepts or declines on their account page; asking someone who has asked already accepts theirs. Either side ends a friendship (`friends:remove`), which also takes back a request. Every change tells both sides' connections `friends:changed`, and so do a new username or avatar and the deletion of an account, to everyone whose page names it.
- **Limits** (`FRIEND_LIMITS`): 100 friends; 20 requests open per sender and 50 waiting per account; 30 requests a day per account, counted before a username is looked up, so that trying names costs as much as asking, and for a player in the room only when a request goes out; after a decline, whoever was declined waits 7 days before asking again, while whoever declined may ask at any time. The other friends messages answer a name that is no account's as they answer a stranger's.
- **Presence.** `friends:list` says of each friend whether they are online, every tab and device counting as one person, and which room they are in: with its code if the room is public, so that the page offers a Join button, and without it if the room is private, which only an invitation leads into. Nobody but a friend learns this, through any message or API; requests show the username and avatar alone.
- **Invitations.** A member with an account invites a friend who is online into their room (`friends:invite`), once a minute for the same friend, unless the chair has removed the friend from it. Every connection of the friend hears `friends:invited`, with the inviter, the room's code and ID and how long the invitation stands, and a connection that comes while it stands hears it too. `room:join` with the `invitation` in place of the code lets the friend in, into a private room too, as a newcomer like any other: a removal by the chair and the account requirement of a public room keep them out as they would anyone. An invitation is used up when the friend comes into the room, by it or by the code, and forgotten when they ignore it (`friends:ignore`); it lapses after 10 minutes, when the inviter leaves, when the room closes or when the two part (`invitation_expired`). However an invitation ends, at once or found by the sweep, every connection of the friend hears `friends:uninvited`, so that none of their pages shows it on. Whoever has a seat in the room comes back by the code, with a lapsed invitation in hand or not. Invitations live in memory and are never kept.
- **Data.** The `friendships` table (migration 8): one row per pair, whichever side asked, with its status and when it was asked and answered. A friendship that is removed is deleted, and a declined request is deleted once its wait is over; an account's rows go with it.

## Academic ranks

Shown only; they change nothing in the game. Every game that ends by itself is scored as a match scores it ([games/keywords.md](games/keywords.md#matches)), in a match or not, and each account player's points go on their `game_records` row (migration 8; older rows count as 0). A withdrawn game counts for nothing, and a game is recorded once per account. The total holds a rank (`shared/src/ranks.ts`): undergraduate from 0, master's student from 30, PhD student from 100, postdoc from 250, lecturer from 450, associate professor from 700, professor from 1000, academician from 2000. The rank travels with the player in every snapshot (`PlayerView.rank`), is read again when a game ends, when the account changes and at every sweep, and the account page shows the total and the way to the next rank.

### The account API

`ACCOUNT_API` in `shared/src/accounts.ts`. Answers are JSON, `{ ok: true, ... }` or `{ ok: false, error }`, with a matching status. HTTP because only an HTTP response can set a cookie that scripts never see.

| Address | Does |
|---|---|
| `GET /api/account` | The account, or null |
| `GET /api/account/records` | The record (login) |
| `POST /api/account/replay` | `gameId`; a game to watch again, for an account that played in it (login) |
| `POST /api/register` | `username`, `password`; logs in |
| `POST /api/login`, `/api/logout` | |
| `POST /api/account/username` | Renames (login) |
| `POST /api/account/avatar`, `.../avatar/remove` | The image itself, or the default (login) |
| `POST /api/account/password` | Every login ends; this browser gets a new one (login, password) |
| `POST /api/account/email`, `.../email/remove` | Mails a binding link, or unbinds (login, password) |
| `POST /api/email/confirm` | Binds (the link) |
| `POST /api/password/forgot` | Mails a reset link |
| `POST /api/password/reset` | Every browser logged out, this one in (the link) |
| `POST /api/account/delete` | Deletes everything (login, password) |

A changing request must come from this site: `Origin` names the host, or `Sec-Fetch-Site` is `same-origin`. Only logging in or out sets the cookie.

**Limits** (`server/src/accounts/limits.ts`), counted before any hashing: 5 accounts an hour per address (`ACCOUNTS_PER_HOUR`); wrong passwords 20 a minute per address and 10 in 15 minutes per name (`login_limited`); 30 `name_reserved` answers an hour per address, then `rate_limited`; 60 changing requests a minute per address; a few mails a day per account and destination; 10 avatar changes a day.

## Mail

Email is only for resetting a password. An address is bound through a mailed link, and the database keeps only its HMAC-SHA256 with a key derived from `SERVER_SECRET`. Without the secret and the mailer, the API answers `mail_unavailable`. A server started with another secret unbinds every address (`addresses_unbound`). Binding asks for the password; the link works once, for 24 hours. A forgotten password is answered the same for any address; a reset link works once, for 30 minutes, and logs out everywhere. Links carry the secret after `#`, so it never reaches a server or log; the database keeps its SHA-256 (`email_tokens`).

### The mailer

`mailer/` alone holds the mail service's key and writes two fixed mails in both languages (`mailer/src/locales/`). The game server asks over a Unix socket with one line of JSON of five fields, `{"v": 1, "kind", "to", "token", "language"}` (`shared/src/mail.ts`). It builds the link itself; at most 50 mails in 24 hours. It sends through Resend's API; `MAILER_TRANSPORT=print` writes each mail out as JSON instead, for development and tests.

## Avatars

The page crops the picture and encodes it at 256 by 256 as WebP or JPEG, within 30 KB. **The server never decodes an image:** it reads the header only (type, size, still, at most 64 KB; `server/src/accounts/avatars.ts`). Files live in `avatars/` under `DATA_DIR`, named by SHA-256. Served under `/avatars/<name>` with `nosniff`, `default-src 'none'` and a year of `immutable` caching. The operator's `admin.cjs avatar remove <username> [--ban]` takes one down ([development.md](development.md#accounts-and-email)).

## Threat model

- **Guessed passwords:** slow salted scrypt and limits per address and name before hashing.
- **Who has an account:** answers that reveal a taken name are limited, `login_failed` is the same for a wrong name or password, and the friends messages answer a name that is no account's as they answer a stranger's, except the request, which costs one of the day's 30.
- **Stolen logins and other sites:** a random secret, kept hashed, only in a hardened cookie, HTTPS only; `Origin` and `Sec-Fetch-Site` checks, no CORS, no framing; password change, binding and deletion ask for the password.
- **Links and mail:** 256 random bits after `#`, kept as hashes, short-lived, used once; two fixed mails from a mailer that alone holds the key.
- **A leaked database** holds usernames, password hashes, hashes of random secrets, keyed HMACs of email addresses, records with their points and titles, who is friends with whom and who asked whom, the replays of games, with their boards, the clues and the nicknames of those who revealed a card, the feedback, with the contacts of the last 90 days and the user agents of bug reports, and the reports, with who reported whom, the name the player had, in which room and the note; no IP addresses.

## Logging

One JSON object per line on stdout, never a token: rooms created and closed (`empty`, `idle`, `stale`, `chair`, `restart`), games started and ended, errors, the `stats` line, and named events such as `listening`, `startup_failed`, `database_opened`, `snapshot_failed`, `storage_full`, `feedback_received`, `feedback_purged`, `report_received`, `account_created`, `mail_not_sent`, `words_clashed`, `match_ended`, `thanks_list_read` and `thanks_list_skipped`; Node's warnings come as `warning` lines, so every line is JSON.

## Status

`server/src/stats.ts` counts for both the log and the page: no addresses, tokens, names or room codes. The `stats` line, every 5 minutes: rooms, members, connections by transport and country, memory. The status page, with `STATUS_PORT`, listens on `127.0.0.1` only, which is why it needs no password, and answers only a `Host` of `localhost`, `127.0.0.1` or `[::1]`, with any port or none, as a browser on the same machine sends it, whatever local port it reaches the page through; anything else gets a bare 421, so that a page elsewhere can't read it, contacts and all, by pointing a name of its own at the address (DNS rebinding). `/` is the page, `/status.json` the numbers, `/feedback` what players sent, the open feedback or that of one status (`?status=`), of every kind or of one (`?kind=`), each with its status and trail, its name for the acknowledgments, its link, its account, whether the name is another account's username and whether it may be published as an issue, and in the trash with the days it has left; `/reports` their reports of each other ([Public rooms](#public-rooms)); of accounts, the page shows only how many there are and how many are new in the last 7 days. The pages are read-only: GET alone, no script, no form, nothing loaded from elsewhere, `Cache-Control: no-store`, English only; what became of the feedback is changed with `admin.cjs` ([Feedback](#feedback)). Countries come from Cloudflare's `CF-IPCountry` header, read only with `TRUST_PROXY` on; any other proxy must drop it ([development.md](development.md#running-in-production)).

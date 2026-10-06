# Architecture

How the app is put together. The hard constraints behind it are in [rules/constraints.md](rules/constraints.md), and the rules of the first game are in [games/keywords.md](games/keywords.md).

## One process, one port

A single Node process serves everything on one port: the built front end, `/healthz`, and Socket.IO under `/socket.io/`. There is no database. Rooms live in the server's memory and end when the process restarts.

| Layer | Where | What it does |
|---|---|---|
| Shared | `shared/src/` | Types and the rules that both sides run, such as the checks of a nickname and of a clue. `schemas.ts` holds the message schemas, for the server alone |
| Server core | `server/src/core/` | Rooms, players, connections, the chair's controls, limits, the word library |
| Server games | `server/src/games/<game>/` | One module per game: its seats, its rules and what each player sees |
| Client core | `client/src/core/` | Connection, rooms, lobby, language, storage |
| Client games | `client/src/games/<game>/` | Each game's screens |

Adding a game means adding a module on each side, without changing the core.

## Rooms

- **Codes.** A room has a 4-character code in Crockford's base32 (digits and capital letters without I, L, O and U), which gives about a million codes. Links look like `/room/K7QX`, and the interface shows the code as a manuscript number, `R2-K7QX`. The server reads a typed code in any case, with or without the `R2-` prefix, and takes I and L for 1 and O for 0.
- **Room IDs.** Each room also has a random `roomId`. Codes are reused after a room closes, so every snapshot carries the `roomId`, and a client that has been in a room gives it whenever it asks to be let back in: in the handshake, in `room:join` and in `room:watch`. When the code has gone to another room since, the server answers that the room is gone, and nobody ends up in a stranger's room.
- **Language.** A room's language is set when it is created and never changes. It decides both the interface language inside the room and the words on the cards.
- **Phases.** A room moves from `lobby` to `playing` to `ended`, and back to `lobby` for another game.
- **The chair.** The first member chairs the room. Only the chair can change the fields, start, withdraw or replay a game, shuffle the groups, move someone to the spectators, remove someone, or hand the chair over. When the chair leaves, or has been offline for 3 minutes while someone else is online, the chair passes to the member who joined first among those online.
- **Removal.** A member the chair removes can't come back for 2 minutes.
- **Revisions.** Every change bumps the room's `rev`.

## Players and identity

- **Tokens.** The first time a browser connects, the server gives it a random 32-byte token, which the browser keeps in local storage. The server accepts any well-formed token it is given, so identities survive a server restart. It issues a new token only when the browser has none.
- **Member keys.** The server never stores tokens. It keeps the token's SHA-256 hash, the member key, and only inside each room's list of members.
- **Player IDs.** Players know each other by a separate random player ID. So no token ever leaves the browser that holds it, and nothing anyone else sees can be used to impersonate a player.
- **Tabs.** Two tabs with the same token are the same player. Both can act, and the player is online while either is connected.
- **Nicknames.** A nickname has 1 to 16 characters, with full-width forms folded and spaces collapsed. An emoji counts as one character, however many code points it is built from. Whatever a reader can't see is refused: control and format characters, the characters that Unicode says to ignore (zero-width spaces, soft hyphens, the Hangul fillers and the like), private-use characters, a name that shows nothing at all, and runs of more than four combining marks. The joiner and the selectors that emoji are built with stay. Names must be unique within a room, ignoring case and those joiners and selectors. The rules are in `shared/src/names.ts`, so that the client can apply the very same ones.
- **Storage.** The client reads and writes local storage only through `client/src/core/storage.ts`, which never throws. When storage is unavailable, values live in memory, and the game still works: the player just can't get back to their seat after a refresh.

## Messages

Everything after the page load goes over Socket.IO. `shared/src/protocol.ts` describes the room messages, and each game defines its own, named `<game>:<action>`.

- **Answers.** Every message from the client gets an acknowledgement: `{ ok: true, ... }` or `{ ok: false, error }`. Error codes are shared, and the client shows each one with the text under `errors.<code>` in the locale files. The server never sends interface text, only the words on the cards.
- **Validation.** The server checks every payload against a zod schema before it looks at it. The schemas are in `shared/src/schemas.ts`, which the server imports as `@reviewer2/shared/schemas`. The client never imports that module, and ESLint refuses it if it tries: zod would add half again to the page's script, and it probes `new Function`, which the Content Security Policy below refuses.
- **Snapshots.** After every change, the server sends each connection in the room its own complete snapshot, `room:state`. The client keeps the snapshot with the highest `rev` for its `roomId`. The server sends the snapshots before it answers the message that caused them, so an answer never arrives before the state it refers to.
- **No interleaving.** Handlers never await anything between reading a room and writing it, so two messages can't interleave.
- **Closing.** `room:closed` tells a connection that its room is gone for it. The reason is `removed`, `expired`, `left` (from another tab) or `restart`.

| Message | Payload | Who |
|---|---|---|
| `sys:ping` | | Anyone; checks that a connection is really alive |
| `meta:fields` | | Anyone; returns the fields of the word library with their word counts |
| `room:create` | `game`, `language`, `fields`, `name` | Anyone; the creator becomes the chair |
| `room:join` | `code`, `name` (for newcomers), `roomId` (for whoever has been in the room) | Anyone; a member who comes back needs no name, and a newcomer without one gets `name_required` with the room's language |
| `room:watch` | `code`, `roomId` (for a screen that has shown the room) | A screen |
| `room:leave`, `room:rename` | `name` for renaming | Members |
| `room:settings` | `fields` | The chair, in the waiting room |
| `room:start`, `room:again`, `room:shuffle` | | The chair |
| `room:end` | `gameId` | The chair; refused as `stale` when it names another game |
| `room:spectate`, `room:remove`, `room:chair` | `playerId` | The chair |

## The handshake and reconnecting

Phones drop their connection whenever the screen locks or the browser goes to the background, so reconnecting is routine:

- **Sooner detection.** The server pings every 10 seconds and gives up after 8 more, sooner than Socket.IO's defaults, so dead connections are noticed quickly.
- **The handshake.** The client sends `{ token, code, roomId }`. A connection whose token belongs to a member of that room is put back into it before any of its messages run, so a message that waited out the disconnect lands in the right room. A screen sends `{ watch: code, roomId }` instead and is put back to watching. The server checks the handshake against a schema like any payload, and takes a field that isn't what it should be for a missing one.
- **The handshake only brings back.** It lets nobody into a room for the first time: a token that isn't a member's, or a screen that gives no `roomId`, gets no answer from it. Its one answer is `room:closed` with the reason `expired`, to a `roomId` that is no longer the code's. So a client always follows the handshake with `room:join` or `room:watch`, which are answered: that is where a newcomer is asked for a name, and where a player learns that the room is full, that they were removed or that the code belongs to no room.
- **Stale actions.** Every game action carries the game and turn it was meant for, and the chair's withdrawal carries the game, so a late one is refused instead of landing in a later turn or the next game.
- **On the client** (with the lobby UI): it checks the connection with `sys:ping` when the page becomes visible again, when the browser restores it from its cache, and when the network comes back, and reconnects at once if the ping goes unanswered. It drops anything that was queued while offline, and sends nothing while disconnected. It stops trying to rejoin a room that no longer exists.

## Games

A game is a module that implements `GameModule` (`server/src/core/game.ts`). The core owns the room, its members and the chair; the module owns its data and decides:

- the seats, and what the chair's bench and shuffle do to them;
- what keeps a game from starting;
- how a game starts, how many words it needs and what happens on each of its messages;
- what each viewer sees.

A module's data is immutable: every call returns new data. `view()` is the only way a game's data leaves the server. It is called for each member and for screens, so a game can show each player only what that player may know. `server/test/fakeGame.ts` is a minimal module that the core's tests use.

## Screens

A screen, such as a projector in a lab meeting, watches a room without a token and without a seat. It starts with `room:watch`, and comes back after a dropped connection through the handshake, by the `roomId` it was sent. The server gives it the view that a spectator would get, so even a chair who is also a captain can put the board on the wall without showing the key. A room can have up to 5 screens.

## Limits and housekeeping

- **Message rate.** Each connection may send about 10 messages a second, in bursts of up to 20.
- **Per address.** Each address may create 5 rooms a minute and send 20 codes a minute that belong to no room, which keeps anyone from trying codes until one fits. Past that, the address is refused whether or not its next code is right. Joining and watching count alike, and the handshake gives a bare code no answer at all, so there is no way around the count.
- **Never for those who have been there.** An address is rarely one person: a lab shares one. So the limit never holds up someone who is in the room already, by their token or on the same connection, or who gives its `roomId`. A wrong `roomId` finds nothing whatever the code, so it can't be used to try codes. A member always gets back in; only newcomers at that address wait out the minute.
- **Behind a reverse proxy,** every connection comes from the proxy, so set `TRUST_PROXY` to take the address from `X-Forwarded-For` instead; [development.md](development.md) has the settings. Otherwise all players share the limits of one address. IPv6 addresses count per /64 network.
- **Sizes.** A message may be up to 16 KB. A room holds up to 30 players and 5 screens, and the server up to 2000 rooms.
- **The sweep.** Once a minute, the server closes rooms in which nobody has been online for 30 minutes, and rooms in which nothing has happened for 6 hours. It also drops members who have been offline for 10 minutes from waiting rooms, and passes on the chair of anyone who has been away for 3 minutes. Those 10 minutes count only time in the waiting room: a player whose phone was locked during a game still has their seat when the room goes back to the waiting room, and 10 minutes from then to return to it.
- **Restarts.** When the process is asked to stop, it first tells every connection `room:closed` with the reason `restart`.

## HTTP

- **Caching.** Files under `/assets/` have a content hash in their name and are cached for good. Everything else, `index.html` included, is sent with `no-cache`, so that a browser never keeps an old page that asks for assets the new build no longer has. A missing asset is a 404 rather than the page.
- **Bundles.** The front end is one bundle without lazily loaded chunks, for the same reason.
- **Security headers.** Every response carries a Content Security Policy (`script-src 'self'`, no framing, and the `ws://` and `wss://` origins spelled out for older iOS browsers), `nosniff` and a referrer policy.

## Logging

The server writes one JSON object per line to stdout: room creation, game starts and ends, rooms closing, skipped word lists and terms, errors, and a warning when it ignores the address that a reverse proxy passed on. It never logs tokens.

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

- **Codes.** A room has a 4-character code in Crockford's base32 (digits and capital letters without I, L, O and U), which gives about a million codes. Links look like `/room/K7QX`, and the interface shows the code as a manuscript number, `R2-K7QX`. A typed code is read in any case, with or without the `R2` prefix, with spaces or dashes anywhere in it, and with I and L for 1 and O for 0. `parseCode()` in `shared/src/codes.ts` does the reading for both sides, so the client never refuses a code that the server would take.
- **Room IDs.** Each room also has a random `roomId`. Codes are reused after a room closes, so every snapshot carries the `roomId`, and a client that has been in a room gives it whenever it asks to be let back in: in the handshake, in `room:join` and in `room:watch`. When the code has gone to another room since, the server answers that the room is gone, and nobody ends up in a stranger's room.
- **Language.** A room's language is set when it is created and never changes. It decides both the interface language inside the room and the words on the cards.
- **Phases.** A room moves from `lobby` to `playing` to `ended`, and back to `lobby` for another game.
- **Games.** The room gives each game a random `gameId`, which its view shows while the game is being played and after it has ended, and counts the games it has started in `round`. The chair's messages about a game say which game they mean.
- **The chair.** The first member chairs the room. Only the chair can change the fields, start, withdraw or replay a game, shuffle the groups, move someone to the spectators, remove someone, or hand the chair over. The chair can be handed only to a member who is online. When the chair leaves, or has been offline for 3 minutes while someone else is online, the chair passes to the member who joined first among those online.
- **Removal.** A member the chair removes can't come back from the same browser for 2 minutes, and for those 2 minutes nobody else can take the name they had. A player is known only by the token in their browser, so this doesn't keep out someone who opens another browser and picks another name: it gives the room a pause, and the chair can remove them again.
- **Revisions.** Every change bumps the room's `rev`.

## Players and identity

- **Tokens.** The first time a browser connects, the server gives it a random 32-byte token, which the browser keeps in local storage. The server accepts any well-formed token it is given, so identities survive a server restart. It issues a new token only when the browser has none.
- **The session.** The first thing the server sends on every connection is `session`, with its `version` and, when it has just issued one, the `token`. A page that was loaded from an older version of the server learns from it that it should reload.
- **Member keys.** The server never stores tokens. It works with the token's SHA-256 hash, the member key, which never leaves the server. The key is kept with each connection, in each room's list of members, for 2 minutes in a room's list of those the chair removed, and by a game module for whatever it has to remember about a player who leaves and comes back, such as which group they played for. A token itself is only held by Socket.IO, in the handshake of its connection for as long as the connection lasts.
- **Player IDs.** Players know each other by a separate random player ID. So no token ever leaves the browser that holds it, and nothing anyone else sees can be used to impersonate a player.
- **Tabs.** Two tabs with the same token are the same player. Both can act, and the player is online while either is connected.
- **Nicknames.** A nickname has 1 to 16 characters, with full-width forms folded and spaces collapsed. An emoji counts as one character, however many code points it is built from, and the message schema lets through every name that these rules would take. Whatever a reader can't see is refused: control and format characters, the characters that Unicode says to ignore (zero-width spaces, soft hyphens, the Hangul fillers and the like), private-use characters, a name that shows nothing at all, and runs of more than four combining marks. The joiner and the selectors that emoji are built with stay. Names must be unique within a room, ignoring case and those joiners and selectors. The rules are in `shared/src/names.ts`, so that the client can apply the very same ones.
- **Storage.** The client reads and writes local storage only through `client/src/core/storage.ts`, which never throws. When storage is unavailable, values live in memory, and the game still works: the player just can't get back to their seat after a refresh.

## Messages

Everything after the page load goes over Socket.IO. `shared/src/protocol.ts` describes the room messages, and each game defines its own, named `<game>:<action>`.

- **Answers.** Every message from the client gets an acknowledgement: `{ ok: true, ... }` or `{ ok: false, error }`. Error codes are shared, and the client shows each one with the text under `errors.<code>` in the locale files. The server never sends interface text, only the words on the cards.
- **Validation.** The server checks every payload against a zod schema before it looks at it. The schemas are in `shared/src/schemas.ts`, which the server imports as `@reviewer2/shared/schemas`. The client never imports that module, and ESLint refuses it if it tries: zod would add half again to the page's script, and it probes `new Function`, which the Content Security Policy below refuses.
- **Snapshots.** After every change, the server sends each connection in the room its own complete snapshot, `room:state`. The client keeps the snapshot with the highest `rev` for its `roomId`. The server sends the snapshots before it answers the message that caused them, so an answer never arrives before the state it refers to.
- **No interleaving.** Handlers never await anything between reading a room and writing it, so two messages can't interleave.
- **Closing.** `room:closed` tells a connection that its room is gone for it. The reason is `removed`, `expired`, `left` (from another tab) or `restart`. It goes to the connections that are open at that moment. Whoever is offline when the chair removes them, or when the sweep drops them, has no connection to tell, and finds out from the answer to `room:join` when they come back.

| Message | Payload | Who |
|---|---|---|
| `sys:ping` | | Anyone; checks that a connection is really alive |
| `meta:fields` | | Anyone; returns the fields of the word library with their word counts |
| `room:create` | `game`, `language`, `fields`, `name` | Anyone; the creator becomes the chair |
| `room:join` | `code`, `name` (for newcomers), `roomId` (for whoever has been in the room) | Anyone; a member who comes back needs no name. A newcomer first hears what keeps them out, `removed_recently` or `room_full`, and only then, without a name, gets `name_required` with the room's language |
| `room:watch` | `code`, `roomId` (for a screen that has shown the room) | A screen |
| `room:leave`, `room:rename` | `name` for renaming | Members |
| `room:settings` | `fields` | The chair, in the waiting room |
| `room:start` | `round` | The chair; `round` is how many games the room had started when the chair pressed start, and the start is refused as `stale` when that is no longer so |
| `room:end`, `room:again` | `gameId` | The chair; refused as `stale` when it names another game than the room's |
| `room:shuffle` | | The chair |
| `room:spectate`, `room:remove`, `room:chair` | `playerId` | The chair |
| `room:dismiss` | | The chair; sends every screen away |

## The handshake and reconnecting

Phones drop their connection whenever the screen locks or the browser goes to the background, so reconnecting is routine:

- **Sooner detection.** The server pings every 10 seconds and gives up after 8 more, sooner than Socket.IO's defaults, so dead connections are noticed quickly.
- **The handshake.** The client sends `{ token, code, roomId }`. A connection whose token belongs to a member of that room is put back into it before any of its messages run, so a message that waited out the disconnect lands in the right room. A screen sends `{ watch: code, roomId }` instead and is put back to watching. The server checks the handshake against a schema like any payload, and takes a field that isn't what it should be for a missing one.
- **The handshake only brings back.** It lets nobody into a room for the first time: a token that isn't a member's, or a screen that gives no `roomId`, gets no answer from it. Its one answer is `room:closed` with the reason `expired`, to a `roomId` that is no longer the code's. So a client always follows the handshake with `room:join` or `room:watch`, which are answered: that is where a newcomer is asked for a name, and where a player learns that the room is full, that they were removed or that the code belongs to no room.
- **Stale actions.** Every game action carries the game and turn it was meant for, and the chair's start, withdrawal and "play again" say which game they mean. A late or repeated one is refused as `stale` instead of landing in a later turn or in another game: a second tab whose connection had stalled can't start a game that nobody asked for, or clear away the result of the next one.
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

A screen has no name, so all that anyone sees of the screens is how many there are, in the room's view. Whoever has the code can put one up, which could fill all five places or let someone watch who should not. So the chair can send every screen away at once with `room:dismiss`: they get `room:closed` with the reason `removed`, and the ones that belong there are put up again. A player whom the chair has just removed can't watch from the same browser for the same 2 minutes.

## Limits and housekeeping

- **Message rate.** Each connection may send about 10 messages a second, in bursts of up to 20.
- **Per address.** Each address may try to create 5 rooms a minute, counting the attempts whose fields turned out not to do, because checking them means going through their words. It may send 20 codes a minute that belong to no room, which keeps anyone from trying codes until one fits. Past that, the address is refused whether or not its next code is right. Joining and watching count alike, and the handshake gives a bare code no answer at all, so there is no way around the count.
- **Never for those who have been there.** An address is rarely one person: a lab shares one. So the limit never holds up someone who is in the room already, by their token or on the same connection, or who gives its `roomId`. A wrong `roomId` finds nothing whatever the code, so it can't be used to try codes. A member always gets back in; only newcomers at that address wait out the minute.
- **Behind a reverse proxy,** every connection comes from the proxy, so set `TRUST_PROXY` to take the address from `X-Forwarded-For` instead; [development.md](development.md) has the settings. Otherwise all players share the limits of one address. IPv6 addresses count per /64 network.
- **The clock.** Every limit and every wait here is a length of time, so the server measures them all with a clock that only runs forward and that a correction of the system's clock doesn't move.
- **Sizes.** A message may be up to 16 KB. A room holds up to 30 players and 5 screens, and the server up to 2000 rooms.
- **The sweep.** Once a minute, the server closes rooms in which nobody has been online for 30 minutes, and rooms in which nothing has happened for 6 hours. It also drops members who have been offline for 10 minutes from waiting rooms, closes a waiting room that this leaves empty, and passes on the chair of anyone who has been away for 3 minutes. Those 10 minutes count only time in the waiting room: a player whose phone was locked during a game still has their seat when the room goes back to the waiting room, and 10 minutes from then to return to it.
- **Restarts.** When the process is asked to stop, it first tells every connection `room:closed` with the reason `restart`. It then ends each connection in the way that sends what is still waiting to go out, and gives that up to 2 seconds before it closes, so that the notice also reaches a connection on a long poll or a slow network.

## HTTP

- **Caching.** Files under `/assets/` have a content hash in their name and are cached for good. Everything else, `index.html` included, is sent with `no-cache`, so that a browser never keeps an old page that asks for assets the new build no longer has. A missing asset is a 404 rather than the page.
- **Bundles.** The front end is one bundle without lazily loaded chunks, for the same reason.
- **Security headers.** Every response carries a Content Security Policy (`script-src 'self'`, no framing, and the `ws://` and `wss://` origins spelled out for older iOS browsers), `nosniff` and a referrer policy.

## Logging

The server writes one JSON object per line to stdout: room creation, game starts and ends, rooms closing, skipped word lists and terms, errors, and a warning when it ignores the address that a reverse proxy passed on. It never logs tokens.

Every room that was created is logged once more when it closes, with the reason: `empty` when its last member has gone, `idle` or `stale` when the sweep closed it, `restart` when the server stopped. Every game that started is logged once more when it ends, whether it ended by itself or the chair withdrew it; a game is logged as started only, when its room closes in the middle of it. So the log can be counted.

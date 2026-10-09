# 0002: Accounts, logins and mail

- Status: accepted
- Date: 2026-10-09

## Context

Players asked for a record of their games and a name of their own, and the matches that come next award titles that must be kept somewhere. Accounts had to stay optional: a guest plays exactly as before. The constraints of the project held throughout: no Google services or public CDNs, one Node process for the players on one port, and a game server that runs in a sandbox without a network (`PrivateNetwork=yes`), so that it can't send mail itself. The maintainer settled what an account is: a username and a password, an avatar that the player uploads and the browser crops, and an optional email address that is only for resetting a password and is never kept, with the mail sent by a separate program that alone holds the key of the mail service.

## Decision

| Area | Choice |
|---|---|
| Transport | The account API is JSON over HTTP under `/api/`, on the game's port. Socket.IO only reads the login in the handshake |
| Logins | A random secret of 32 bytes in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie with the `__Host-` prefix; the database keeps its SHA-256. 30 days without use, a year in all |
| Passwords | scrypt from Node's `crypto`, N = 2^15, r = 8, p = 3, with the parameters kept beside each hash |
| Identity in rooms | A connection that is logged in takes its member key from the account, so an account is one player on every device |
| Email | An HMAC-SHA256 of the normalized address, with a key from the server's secret, which is not in the database |
| Mail | A separate program, `mailer/`, reached over a Unix socket with a fixed request of five fields; Resend's API through `fetch` |
| Avatars | Encoded in the browser; the server reads only the header, and keeps files named after their SHA-256 |
| Data | Migration 2 in the same SQLite database, with every row of an account deleted with it through foreign keys |

## Consequences

- **HTTP, not Socket.IO, for accounts.** Only an HTTP response can set a cookie that the page's scripts can't read, and a login that scripts can't read is the main defense against a script that steals it. All of the account API is on HTTP, so that there is one way of being logged in to check. Every request that changes something must come from the site's own pages, which is checked by `Origin` and `Sec-Fetch-Site` on top of `SameSite`.
- **A cookie, not a token in local storage.** A token in local storage is what guests have, and a script in the page could read it. A login is worth more than a guest's seat.
- **No JSON Web Tokens.** A login that the server looks up can end at once, as when a password is reset, which a signed token can't without a list of the ones that ended, and that list is the same lookup.
- **scrypt from Node.** It needs no dependency, and its memory makes guessing on graphics cards expensive. Argon2 would need a native module, which production avoids. The cost was measured on the server, and two hashes at a time keep a flood of logins within its memory limit.
- **An account is one player.** Taking the member key from the account lets every rule of rooms, which go by member keys, hold for accounts as they are: coming back after a reconnect, the chair's removal, the groups a player played for. Logging in or out in the middle of a game makes the browser someone else, which is why rooms have no way to do it.
- **A mailer of its own.** The game server keeps its sandbox. The mailer can only write two fixed mails, builds their links itself, and sends at most 50 a day, so even a game server that has been taken over can do little with it. A Unix socket rather than a directory of files to send keeps the secrets of the links off the disk, and lets systemd set who may use it.
- **An address that isn't kept.** The database can't leak the addresses, and they can't be found from a list without the secret, which therefore must never be lost: a new secret unbinds every address.
- **Avatars without a decoder.** Decoding images on the server would need a native library and would run code on what strangers upload; checking the header alone is enough to keep the files small and of the right kind, and the headers they are served with keep a browser from reading them as anything but images.

## Alternatives considered

- **Sign-in with WeChat or by codes mailed for each login**: more for players to set up and for the server to trust; left for later, if at all.
- **A spool directory for the mailer**: no `AF_UNIX` for the game server, but live secrets of links in files, and a directory that both sandboxed services must share.
- **The game server sending mail through a proxy**: it would need a way out of its sandbox, which the maintainer ruled out.
- **Avatars in the database**: one place for everything, but the database would grow by the avatars and count them against its limit; files beside it are counted on their own.

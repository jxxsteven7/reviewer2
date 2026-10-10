# 0002: Accounts, logins and mail

- Status: accepted
- Date: 2026-10-09

## Context

Players asked for a record of their games and a name of their own. Accounts stay optional. The game server should run without internet access and never hold the mail service's key, so a program of its own, the mailer, sends the mails. An account is a username and a password, an avatar, and an optional email address only for resetting a password, never kept.

## Decision

| Area | Choice |
|---|---|
| Transport | JSON over HTTP under `/api/`, on the game's port; Socket.IO only reads the login in the handshake |
| Logins | A random 32-byte secret in an `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` cookie; the database keeps its SHA-256 |
| Passwords | scrypt from Node's `crypto`, N = 2^15, r = 8, p = 3, parameters beside each hash |
| Identity in rooms | A logged-in connection takes its member key from the account: one player on every device |
| Email | HMAC-SHA256 of the normalized address, keyed from the server's secret, which is not in the database |
| Mail | A separate program, `mailer/`, over a Unix socket with a fixed five-field request; Resend's API through `fetch` |
| Avatars | Encoded in the browser; the server reads only the header and keeps files named by SHA-256 |
| Data | Migration 2 in the same SQLite database; every row of an account deleted with it through foreign keys |

## Why

- **HTTP, not Socket.IO:** only an HTTP response can set a cookie that scripts can't read.
- **A cookie, not local storage:** a script in the page could read a token.
- **scrypt from Node:** no dependency, memory-hard; Argon2 would need a native module.
- **An account is one player:** every room rule goes by member key, so reconnecting, removal and groups hold for accounts as they are.
- **A mailer of its own:** the game server still needs no internet, and the mailer can only write two fixed mails.
- **An address that isn't kept:** the database can't leak addresses, and they can't be found from a list without the secret, which must therefore never be lost.
- **Avatars without a decoder:** decoding on the server would run native code on strangers' uploads.

Alternatives: sign-in with WeChat or mailed codes (later, if at all); a spool directory for the mailer; avatars in the database.

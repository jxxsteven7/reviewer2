# Hard constraints

Follow these in every line of code. Reviewers check them item by item.

## Access from mainland China

- Don't use any Google services, such as Firebase, Google Fonts, Google Analytics, Google Sign-In or reCAPTCHA.
- Don't load anything from public CDNs such as unpkg, jsDelivr or cdnjs. Bundle fonts, scripts and icons into the project and serve them from our own server.
- Keep the architecture simple: one Node process serves both the static front end and WebSocket, on one domain and one port.
- Before adding an external dependency or third-party service, confirm that it is available and reliable in mainland China.

## Intellectual property

- The first game borrows its mechanics from a commercial board game. **The name of that game must not appear anywhere**: not in the UI, copy, code identifiers, docs, commit messages or PR titles, in English or in Chinese.
- All word lists are original. Don't use the official word list of any commercial board game.
- Art, icons and color schemes are original and don't imitate the original game's visual design.

## Game state

- The server is authoritative. Clients only send actions to the server and never change game state themselves.
- State is filtered by role. The colors of unrevealed cards are sent only to captains. The data that guessers and spectators receive must not contain them, so they can't be found even with developer tools.
- Reads and writes to browser local storage are wrapped in error handling, and the game still works when storage is unavailable.

## UI

- All UI text lives in the locale files (`zh.json` and `en.json`), never hard-coded in components, and every string exists in both languages.
- The UI is mobile-first and works in WeChat's built-in browser.
- Don't break reconnection. After a refresh or a locked screen, players return to their room, team and role.

## Secrets

- Never commit passwords, keys or tokens. Use environment variables. `.env` is already ignored by `.gitignore`.

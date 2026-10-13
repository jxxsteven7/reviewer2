# Double Blind: team word guessing

The first game. Its module is `keywords`; the name players see lives in the locale files. Rules: `server/src/games/keywords/`; shared types and the clue check: `shared/src/games/keywords/`.

## Names

| In the code | In the interface | What it is |
|---|---|---|
| `red`, `blue` | Red group, Blue group | The two teams |
| `captain` | PI | Gives the clues and sees the key |
| `guesser` | Student | Reveals cards |
| `spectator` | Spectator | Watches |
| `neutral` | Irrelevant paper | Nobody's card |
| `reviewer2` | Reviewer 2 | Loses the game for the group that reveals it |

## Setting up

- The room's language, chosen at creation, is the cards' language.
- To start, each group needs an online captain and guesser.
- The server draws 25 different words with the crypto module and a random starting group: 9 cards for it, 8 for the other, 7 irrelevant papers, 1 Reviewer 2. The words come from the chair's fields and the chair's own words ([Custom words](#custom-words)), unused ones first.
- No word on a board gives another away. Two words clash when one lies inside the other: it is the other or its plain plural, each of its pieces is a piece of the other or of one of its forms, or it is the other's term in another language. Pieces are the parts the strict clue rule counts ([The clue](#the-clue)) plus lone letters and numbers. "Gene" and "Gene editing" clash; "Data science" and "Data cleaning" don't. `cardsClash()` in `shared/src/games/keywords/clue.ts` decides; the draw is described in [../architecture.md](../architecture.md#games).
- A card carries its term in the other language, its `forms` and, for a Chinese word, its `pinyin` (worked out by the server with [pinyin-pro](https://github.com/zh-lx/pinyin-pro), MIT), in every view.

## Settings

Set by the chair, locked during a game.

| Setting | Choices | Default |
|---|---|---|
| Guess rule | `free` or `standard` ([Turns](#turns)) | `free` |
| Clue rule | `strict` or `loose` ([The clue](#the-clue)) | `strict` |
| Clue length | Chinese room: 1 to 10 characters, two letters or digits counting as one; English room: 1 to 3 words | 4; 1 |
| Time for the first clue, later clues, the guesses of a turn | 0 for no limit, or 10 to 600 seconds | 120, 90, 120 |
| Extensions | `true` or `false` ([Pauses and extensions](#pauses-and-extensions)) | `false` |

`settingsProblems()` in `shared/src/games/keywords/settings.ts` checks them on both sides; the server refuses with `bad_settings`.

## Turns

Turns are numbered from 1; the starting group plays the odd ones.

1. **Clue.** The captain gives a clue and a number.
2. **Guesses.** The guessers reveal cards one at a time. Under **free**, the number is 1 to the cards the group has left and only a hint: they go on while they reveal their own cards. Under **standard**, it is 0 to 9 or "unlimited": with 1 to 9 they may reveal that many plus one, which ends the turn; 0 and "unlimited" set no limit. An irrelevant paper or the other group's card ends the turn; after one reveal, the guessers may end it themselves.
3. The other group's turn.

## The clue

The captain's screen runs the check while typing, and the server again. A clue is made of **words**: letters, digits, hyphens and apostrophes, each with a letter or digit; "Self-attention" is one word. An **English room** allows up to the clue length in words, each up to 24 characters, and a clue with Chinese characters in it of up to 10 characters in all. A **Chinese room** allows one word, without spaces, of up to the clue length as `clueLength()` counts: a Chinese character is one, and two letters or digits are one, rounded up, as Weibo counts, so that GPU is 2, Python 3 and Transformer 6, and the default of 4 allows 8 letters. An English word or abbreviation such as GPU is fine, but not a card's English term. Errors: `clue_too_many_words`, `clue_not_one_word`, `clue_too_long`. The clue is checked against every word still on the board, whatever its color.

**Refused under either rule** (`clue_on_board`), after NFKC, trimming, lowercasing, dropping accents and folding traditional to simplified Chinese:

- the same as a board word or its plain plural, counting only letters and digits: "co-author" for "coauthor";
- a part the same as a part of a board word, or its plain plural. Parts are runs of letters between spaces, hyphens, apostrophes and digits, Latin and Chinese apart; lone letters, digits and small words of compounds ("of", "the") don't count: "self-attention" for "attention";
- a run of Chinese characters containing or contained in a board word's; Latin parts are never searched inside words, so "email" is fine beside "AI";
- the card's term in another language, or its plain plural;
- the pinyin of a Chinese card (`pinyin`, without tones), written solid, with hyphens or, where the room takes several words, with spaces, and with "v" or "ü" alike; "jiyin" for the Chinese word for "gene". Only the whole pinyin counts: homophones are not checked.

A plain plural ends in "-s", or "-es" after s, x, z, ch or sh.

**Strict refuses, loose only warns:** a listed form of a card (`forms`), in any of the ways above, forms of both languages counting in either room; a Chinese character in common with a board word; and, in a Chinese room, where a Latin word on the board stands out, a board word or part of four Latin letters or more inside the clue ("dockerfile" beside "Docker", "Pythonic" beside "Python"), unless the clue may be another form of the word by its ending.

**Warned under either rule**, where the check can only guess: another ending of a board word ("-ing", "-ed", "-ion", an irregular plural); in an English room, a board word or part of four letters or more inside the clue ("support" beside "Port"), which would be refused too often there; and a card's term in another language, or a part of it, inside the clue.

Revealed words no longer count.

**The cards it is meant for.** With the clue, the PI may mark the group's cards that are still to be found as the ones the clue is meant for, in the order they choose, as many as they like; their screen offers it above the clue and sets the number to how many are marked, until the PI picks a number themselves. The rules don't tie the number to the marks. Each mark must be one of the group's own cards that is still face down, and none may come twice (`bad_targets`). The marks are the PI's secret until the game is over: no view carries them before then, the PI's own included. Then every view has them, and the clue log and the replay show them, with how many the group found.

**Preparing ahead.** Whenever it isn't their turn to give a clue, while the game is on and not paused, a PI may prepare the next one: the word, the number and the marks, in the same panel, which opens from a button under the status line and folds away again so that the PI can watch the other group guess. The draft stays in the PI's browser alone, in local storage under `r2.clueDraft` with the ID of the game, and nothing of it reaches the server until the clue is given: nobody else, their own group included, can tell that a PI is preparing or what. It comes back after a reload, unless the clue went meanwhile, and goes once the clue is given, when the game ends and when another game starts; without working storage it lasts as long as the page. The draft follows the board: a marked card that is revealed meanwhile loses its mark, and the panel says so, and a number picked that the rule no longer offers the group, as under the free rule once a card of theirs was found, goes back to following the marks. When the PI's turn comes the panel opens with the draft in it, and the PI gives the clue themselves: nothing is sent on its own.

The traditional-simplified table, `shared/src/han-variants.ts`, is built by `scripts/build-han-variants.mjs` from [OpenCC](https://github.com/BYVoid/OpenCC) (Apache License 2.0).

## Time limits

The server keeps the time. A captain who gives no clue in time loses the turn, recorded with `word` and `count` null and `timedOut` true; guessers out of time end their turn, the clue marked `timedOut`. Time runs whether or not players are online. A timer ends the phase and sends a snapshot; an action arriving after the deadline, even before the timer fired, is `stale`. Every view carries `clock`, the time left and given, in milliseconds; the client only counts down.

## Pauses and extensions

**The chair** may pause the game at any point while it is on (`keywords:pause`) and resume it (`keywords:resume`), whoever chairs the room by then: the room hands the chair on after 3 minutes offline. While paused, the clock stands still with the time the phase had left, and goes on from there; every action but the group chat is refused with `paused`; and **no view carries the board**: `cards` is empty for everyone, the captains and the screens included, and `paused` is true. The room's rules go on: reconnecting works as usual, and a room with nobody online for 30 minutes closes. The record notes the pause and its end in `events`, with the turn; a game keeps the last `EVENTS_KEPT` events, 50, so that no number of pauses can grow its snapshots. The end of the game ends a pause too.

**Extensions**, a setting that is off by default, let each group once a game add 30 seconds (`EXTENSION_SECONDS`) to the phase it is in, where the phase has a time limit: the captain in the clue phase, a guesser in the guess phase, with `keywords:extend`. Everyone is told, `events` notes it with the group, and `extended` says which groups have used theirs. Errors: `no_extension` (the setting is off, or the phase has no limit), `extension_used`.

## Custom words

In a **private room**, the chair pastes words of their own in the waiting room (`room:settings` with `words`, the text as pasted): one per line, or separated by commas or the Chinese enumeration comma; cleaned as a clue is, the same word twice counted once; each fitting on a card, 5 Chinese characters or 14 other characters; at most 200 (`parseCustomWords()` in `shared/src/games/keywords/custom.ts`, run on both sides; the server refuses with `bad_words`). They are drawn from the same pool as the chosen fields, unused words first and kept apart as the fields' words are, and with 25 or more the chair may choose no field at all. A Chinese word gets its `pinyin`; custom words have no translations or forms. The words are the chair's alone: everyone else's view carries only `customWordCount`, and the settings summary shows the number. A room with custom words can't be made public, and a public room takes none (`custom_words_private`). They live with the room, in memory, and go when it closes; a room with them keeps no [replay](#replays) of its games, which would carry the words that were on the board.

## Talking it over

Each group has two things the other never sees.

**Choosing a card.** In their group's guess phase, a guesser may choose a card, or take it back; the group's guessers and captain see who chose which. Choices clear at every reveal and when the turn or game ends; a guesser who leaves takes theirs along.

**The group chat.** A guesser may write to their group at any time during a game. Captains read but can't write: the clue is all they say. Spectators and screens see none. A message is one line of up to 200 characters, cleaned as `shared/src/text.ts` says. Each group keeps its latest 20 messages; it goes with every snapshot, lasts one game and stays readable after the end.

## Winning

Revealing **Reviewer 2** ends the game at once: that group loses. Otherwise a group wins as soon as all its cards are revealed, whoever revealed the last. The chair may **withdraw** a game, which ends without a winner; a withdrawal names its game, so a late one can't end the next. At the end everyone sees every color.

## Replays

Once a game is over, the results page offers a **review**: the page builds a replay from the view, which now carries every color, and `ReplayViewer` plays it step by step, a step for each clue and each guess, with the board as it stood, who revealed what, and whether it was right. The replay object (`KeywordsReplay` in `shared/src/games/keywords/replay.ts`) holds the board with its colors, the record, the result and the names of those who revealed a card, by player ID; `replaySteps()` turns it into the steps. The record says who gave each clue (`captain`), the cards they meant (`targets`), which the replay marks with their numbers through the clue's turn, and when each clue and guess came, in milliseconds from the start (`at`); replays from before have none of these. The server builds the same object at the end of a game (`GameModule.replay()`) and keeps it for the players with accounts ([../architecture.md](../architecture.md#replays)); a withdrawn game has none, and neither has a game of a room with [custom words](#custom-words).

The record of a game ([../architecture.md](../architecture.md#game-records)) logs every message of this game but the group chat, as its schema reads it, without the game's ID and with the clue's word cleaned as the record keeps it; choosing a card is minor, and nothing else. It says where each player is, by group and role (`GameModule.seated`), and everyone who has sat in a group during the game has played in it.

## What each player sees

| Seat | Cards | Of the groups | Can do |
|---|---|---|---|
| Captain | All words and colors | Their group's chat and choices | Give the clue |
| Guesser | All words; revealed colors | The same | Choose, reveal, end the turn, write |
| Spectator, screen | Like a guesser | Nothing | Watch |
| While paused | No cards at all | As before | Write to the group |
| After the game | Every color | As before | Review the game |

`view.ts` is the only way game state leaves the server to players, by the seat the viewer is in right now. Outside a captain's view an unrevealed card has no `color` key at all; there is no `chat` key outside the groups and no `selections` key outside the group whose turn it is; and before the game is over, no clue on record has `targets`, in any view. Translations, forms and pinyin go to everyone.

## Seats

- A newcomer who comes to play is a guesser: in the group they played for in this game, else in the smaller group, or at random. Whoever comes to watch, or doesn't say, is a spectator.
- In the waiting room, anyone may take a free captain's seat, join either group as a guesser, or watch. The chair's shuffle deals everyone seated into the two groups at random, with random captains.
- During a game, spectators may join either group and anyone may step out to watch.
- Whoever sits in a group during a game belongs to it until the next game: the other group is `other_team`, also after the game has ended, since the chat is still there.
- A captain in this game has seen the key and may not be a guesser until the next game (`key_viewer`); an empty captain's seat is open to that group's players and to spectators who haven't played.

## Messages

On top of the room messages ([../architecture.md](../architecture.md#messages)); schemas in `shared/src/schemas.ts`.

| Message | Payload | Who |
|---|---|---|
| `keywords:seat` | `team` (`red`, `blue`, `null`), `role` (`captain`, `guesser`, `spectator`) | Any member, within the seat rules |
| `keywords:clue` | `gameId`, `turn`, `word`, `count` (1 to the cards left under `free`; 0 to 9 or `"unlimited"` under `standard`), `targets`? (the cards meant) | The current captain |
| `keywords:select` | `gameId`, `turn`, `card` (0 to 24, or `null`) | The current guessers |
| `keywords:reveal` | `gameId`, `turn`, `card` | The current guessers |
| `keywords:pass` | `gameId`, `turn` | The current guessers |
| `keywords:say` | `gameId`, `text` | Either group's guessers, in any turn |
| `keywords:pause`, `keywords:resume` | `gameId` | The chair; `not_chair`, `paused`, `not_paused` |
| `keywords:extend` | `gameId`, `turn` | The current captain in the clue phase, a current guesser in the guess phase; `no_extension`, `extension_used` |

The settings travel in `room:create` and `room:settings` as `guessRule`, `clueRule`, `clueLength`, `firstClueTime`, `clueTime`, `guessTime`, `extensions` (`KEYWORDS_SETTINGS`); the chair's own words in `room:settings` as `words`.

## Order of the checks

Before a game action, the server ends a phase whose time has run out. Then:

1. `stale`: an earlier game or turn, or no game.
2. `game_over`.
3. `paused`, for everything but a chat message and a withdrawal. A pause and a resumption need the chair first (`not_chair`), and then a game that isn't paused, or is (`paused`, `not_paused`).
4. `not_your_turn`, `not_captain`, `not_guesser`; a chat message only needs a guesser.
5. `wrong_phase`, such as revealing before the clue.
6. The content: `bad_count`, `clue_empty`, `clue_not_one_word`, `clue_too_many_words`, `clue_too_long`, `clue_on_board`, `bad_targets`; `no_such_card`, `card_revealed`; `must_guess_first`; `chat_empty`, `chat_too_long`; `no_extension`, `extension_used`.

Content comes last, so nothing a player can't see changes the answer. Two reveals at once are handled one at a time; if the first ends the turn, the second is `stale`.

## Matches

In a match ([../architecture.md](../architecture.md#matches)), `server/src/games/keywords/match.ts` makes the groups and `shared/src/games/keywords/score.ts` scores, in every game that ends by itself:

| What happened | Who | Points |
|---|---|---|
| A student reveals one of the group's own cards | Everyone who played for the group, PI included | +1 each |
| The group wins | The same | +3 each |
| A student reveals an irrelevant paper | That student | -1 |
| A student reveals the other group's card | That student | -2 |
| A student reveals Reviewer 2 | That student | -3 |

A withdrawn game counts for nothing. `KeywordsScoreDetail` says where each player's points came from, in the match's table between the games; the records keep the points alone, so a game already on them keeps the points it was scored with.

**The groups.** Drawn **at random**: the server deals the players as the shuffle does, the first dealt to each group its PI; four online players can start. **Chosen** by the players: as in an ordinary room. **Fixed**, once a game has been scored: everyone keeps their group; after each game all go back as students, and the PI is whoever has been PI the fewest times; a newcomer goes to the smaller group. During a match game, only those who played for a group may sit in one.

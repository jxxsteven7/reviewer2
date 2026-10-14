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
- To start, each group needs an online captain and guesser. With [AI players](#ai-players), every time limit must be on and a person must sit in a group.
- The server draws 25 different words with the crypto module and a random starting group: 9 cards for it, 8 for the other, 7 irrelevant papers, 1 Reviewer 2. The words come from the chair's fields and the chair's own words ([Custom words](#custom-words)), unused ones first.
- No word on a board gives another away. Two words clash when one lies inside the other: it is the other or its plain plural, each of its pieces is a piece of the other or of one of its forms, or it is the other's term in another language. Pieces are the parts the strict clue rule counts ([The clue](#the-clue)) plus lone letters and numbers. "Gene" and "Gene editing" clash; "Data science" and "Data cleaning" don't. `cardsClash()` in `shared/src/games/keywords/clue.ts` decides; the draw is described in [../architecture.md](../architecture.md#games).
- A card carries its term in the other language, its `forms` and, for a Chinese word, its `pinyin` (worked out by the server with [pinyin-pro](https://github.com/zh-lx/pinyin-pro), MIT), in every view. A Chinese word also carries the English meanings of its characters (`glosses`, from the dictionary in `words/dictionary/`), for the captains alone, while the game is on, and only on the cards still face down ([The clue](#the-clue)).

## Settings

Set by the chair, locked during a game.

| Setting | Choices | Default |
|---|---|---|
| Guess rule | `free` or `standard` ([Turns](#turns)) | `free` |
| Clue rule | `strict` or `loose` ([The clue](#the-clue)) | `strict` |
| Clue length | Chinese room: 1 to 10 characters, two letters or digits counting as one; English room: 1 to 3 words | 2; 1 |
| Time for the first clue, later clues, the guesses of a turn | 0 for no limit, or 10 to 600 seconds | 120, 90, 120 |
| Extensions | `true` or `false` ([Pauses and extensions](#pauses-and-extensions)) | `false` |

`settingsProblems()` in `shared/src/games/keywords/settings.ts` checks them on both sides; the server refuses with `bad_settings`.

## Turns

Turns are numbered from 1; the starting group plays the odd ones.

1. **Clue.** The captain gives a clue and a number.
2. **Guesses.** The guessers reveal cards one at a time. Under **free**, the number is 1 to the cards the group has left and only a hint: they go on while they reveal their own cards. Under **standard**, it is 0 to 9 or "unlimited": with 1 to 9 they may reveal that many plus one, which ends the turn; 0 and "unlimited" set no limit. An irrelevant paper or the other group's card ends the turn; after one reveal, the guessers may end it themselves.
3. The other group's turn.

## The clue

The captain's screen runs the check while typing, and the server again. A clue is made of **words**: letters, digits, hyphens and apostrophes, each with a letter or digit; "Self-attention" is one word. An **English room** allows up to the clue length in words, each up to 24 characters, and a clue with Chinese characters in it of up to 10 characters in all. A **Chinese room** allows one word, without spaces, of up to the clue length as `clueLength()` counts: a Chinese character is one, and two letters or digits are one, rounded up, as Weibo counts, so that GPU is 2, Python 3 and Transformer 6, and the default of 2 allows 4 letters. An English word or abbreviation such as GPU is fine, but not a card's English term. Errors: `clue_too_many_words`, `clue_not_one_word`, `clue_too_long`. The clue is checked against every word still on the board, whatever its color.

**Refused under either rule** (`clue_on_board`), after NFKC, trimming, lowercasing, dropping accents and folding traditional to simplified Chinese:

- the same as a board word or its plain plural, counting only letters and digits: "co-author" for "coauthor";
- a part the same as a part of a board word, or its plain plural. Parts are runs of letters between spaces, hyphens, apostrophes and digits, Latin and Chinese apart; lone letters, digits and small words of compounds ("of", "the") don't count: "self-attention" for "attention";
- a run of Chinese characters containing or contained in a board word's; Latin parts are never searched inside words, so "email" is fine beside "AI";
- the card's term in another language, or its plain plural;
- the pinyin of a Chinese card (`pinyin`, without tones), written solid, with hyphens or, where the room takes several words, with spaces, and with "v" or "ü" alike; "jiyin" for the Chinese word for "gene". Only the whole pinyin counts: homophones are not checked.

A plain plural ends in "-s", or "-es" after s, x, z, ch or sh.

**Strict refuses, loose only warns:** a listed form of a card (`forms`), in any of the ways above, forms of both languages counting in either room; a character in common with a board word; and, in a Chinese room, where a Latin word on the board stands out, a board word or part of four Latin letters or more inside the clue ("dockerfile" beside "Docker", "Pythonic" beside "Python"), unless the clue may be another form of the word by its ending.

**A character in common** is more than the same Chinese character:

- **Numbers** are the same character however they are written: a digit, a Chinese numeral (the characters for zero to ten, a hundred, a thousand and ten thousand) and an English number word (zero to ten, hundred, thousand), on either side. "6", the numeral for six and "six" all have a character in common with a card that has the numeral for six in it, and "five" with the card "5G"; in an English room, "6" with "Six Sigma". A run of digits counts digit by digit, and as a whole too when it is ten, a hundred, a thousand or ten thousand. The capital numerals of cheques don't count: the one for six is also the first character of the Chinese word for "land".
- **The English of a character:** a word of the clue of three letters or more that is one of the English meanings of a Chinese character of the card (its `glosses`), or a plain plural of one: "ball" for the last character of the Chinese word for "rebound", "web" for the last one of the word for "road network". With the character for "big" on the board, "big" and "great" count too.
- **The pinyin of a character:** a word of the clue of three letters or more that is the pinyin of one of the card's characters, without tones, with "v" or "ü" alike: "qiu" for the ball of "rebound". Two letters are too often an English word ("he", "an") to count.

Element symbols ("K" for potassium), other characters that sound alike and riddles are left to the players. Letters, digits and Chinese characters may be mixed in a clue as before.

The meanings come from [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) (CC BY-SA 4.0): `scripts/build-han-glosses.mjs` keeps the entries of one character for the characters of the word lists, cleans each meaning to single English words, and writes `words/dictionary/han-glosses.json`, with a few meanings added by hand.

**Warned under either rule**, where the check can only guess: another ending of a board word ("-ing", "-ed", "-ion", an irregular plural); in an English room, a board word or part of four letters or more inside the clue ("support" beside "Port"), which would be refused too often there; and a card's term in another language, or a part of it, inside the clue.

Revealed words no longer count.

**Homophones** are left to the players: in a Chinese room, the rules ask for no clue that sounds like a word on the board, such as other characters read jīyīn for the Chinese word for "gene", and nothing checks it. The rules sheet says so in a Chinese room alone, in either language of the interface. The home page shows the rules too, as a new room in the page's language has them, from the small word "Rules" beside the game's name, with a word that each room may change its settings.

**The cards it is meant for.** With the clue, the PI may mark the group's cards that are still to be found as the ones the clue is meant for, in the order they choose, as many as they like; their screen asks for them above the clue, loudly, on a sticker in the group's tint with the badge of a marked card, until one is marked, then counts and names them, and sets the number to how many are marked, until the PI picks a number themselves. A clue without marks goes at the first tap all the same. The rules don't tie the number to the marks. Each mark must be one of the group's own cards that is still face down, and none may come twice (`bad_targets`). The marks are the PI's secret until the game is over: no view carries them before then, the PI's own included. Then every view has them, and the clue log and the replay show them, with how many the group found.

**Preparing ahead.** Whenever it isn't their turn to give a clue, while the game is on and not paused, a PI prepares the next one: the word, the number and the marks, in the same panel, which stays open under the status line, below the board, so that the PI watches the other group guess above it; there is nothing to open or fold. A pause hides it with the board, and the draft waits. The draft stays in the PI's browser alone, in local storage under `r2.clueDraft` with the ID of the game, and nothing of it reaches the server until the clue is given: nobody else, their own group included, can tell that a PI is preparing or what. It comes back after a reload, unless the clue went meanwhile, and goes once the clue is given, when the game ends and when another game starts; without working storage it lasts as long as the page. The draft follows the board: a marked card that is revealed meanwhile loses its mark, and the panel says so, and a number picked that the rule no longer offers the group, as under the free rule once a card of theirs was found, goes back to following the marks. When the PI's turn comes it is the same panel, with the draft in it, and the PI gives the clue themselves: nothing is sent on its own.

The traditional-simplified table, `shared/src/han-variants.ts`, is built by `scripts/build-han-variants.mjs` from [OpenCC](https://github.com/BYVoid/OpenCC) (Apache License 2.0); the English meanings of the characters by `scripts/build-han-glosses.mjs` from CC-CEDICT.

## Time limits

The server keeps the time. A captain who gives no clue in time loses the turn, recorded with `word` and `count` null, `timedOut` true and the `captain` who was in the seat, if any, and the room hears of it at once ([Titles](#titles)); guessers out of time end their turn, the clue marked `timedOut`. Time runs whether or not players are online. A timer ends the phase and sends a snapshot; an action arriving after the deadline, even before the timer fired, is `stale`. Every view carries `clock`, the time left and given, in milliseconds; the client only counts down.

## Pauses and extensions

**The chair** may pause the game at any point while it is on (`keywords:pause`) and resume it (`keywords:resume`), whoever chairs the room by then: the room hands the chair on after 3 minutes offline. While paused, the clock stands still with the time the phase had left, and goes on from there; every action but the group chat is refused with `paused`; and **no view carries the board**: `cards` is empty for everyone, the captains and the screens included, and `paused` is true. The room's rules go on: reconnecting works as usual, and a room with nobody online for 30 minutes closes. The record notes the pause and its end in `events`, with the turn; a game keeps the last `EVENTS_KEPT` events, 50, so that no number of pauses can grow its snapshots. The end of the game ends a pause too.

**Extensions**, a setting that is off by default, let each group once a game add 30 seconds (`EXTENSION_SECONDS`) to the phase it is in, where the phase has a time limit: the captain in the clue phase, a guesser in the guess phase, with `keywords:extend`. Everyone is told, `events` notes it with the group, and `extended` says which groups have used theirs. Errors: `no_extension` (the setting is off, or the phase has no limit), `extension_used`.

## Custom words

In a **private room**, the chair pastes words of their own in the waiting room (`room:settings` with `words`, the text as pasted): one per line, or separated by commas or the Chinese enumeration comma; cleaned as a clue is, the same word twice counted once; each fitting on a card, 5 Chinese characters or 14 other characters; at most 200 (`parseCustomWords()` in `shared/src/games/keywords/custom.ts`, run on both sides; the server refuses with `bad_words`). They are drawn from the same pool as the chosen fields, unused words first and kept apart as the fields' words are, and with 25 or more the chair may choose no field at all. A Chinese word gets its `pinyin`; custom words have no translations or forms. The words are the chair's alone: everyone else's view carries only `customWordCount`, and the settings summary shows the number. A room with custom words can't be made public, and a public room takes none (`custom_words_private`). They live with the room, in memory, and go when it closes; a room with them keeps no [replay](#replays) of its games, which would carry the words that were on the board. A room with [AI players](#ai-players) sends its board, these words included, to the agent and to the language model it asks ([../architecture.md](../architecture.md#the-agent)); the agent keeps nothing of it.

## Talking it over

Each group has three things the other never sees.

**Choosing a card.** In their group's guess phase, a guesser may choose a card, or take it back; the group's guessers and captain see who chose which. Choices clear at every reveal and when the turn or game ends; a guesser who leaves takes theirs along.

**Marking cards.** At any time during a game but a pause, in either group's turn, a guesser may mark a hidden card for their group (`keywords:mark`): as `ours`, one of the group's own, `theirs`, one of the other group's, or `r2`, maybe Reviewer 2; or clear its mark with `null`. A card has one mark for each group, the last one standing, whoever set it, and the marks don't say who did. The group's guessers and its captain get them (`marks`), the captain to read them and so see what the students make of the board, without setting any; the other group, spectators and screens don't. A card's marks, both groups', go when it is revealed, and nobody gets any once the game is over.

A student marks with taps, without tools to pick first (`useCardGestures.ts`): one tap chooses a card, in the group's own guess phase, and does nothing otherwise; two taps mark it `ours`, three `theirs`, and holding it down for half a second `r2`; the same again clears the mark, and another puts that one in its place. One tap waits a quarter of a second for the next before it counts. From the keyboard, 1, 2 and 3 mark the card that has the focus. A long press selects no text and opens no menu. The line under the board says which tap does what. A student's card that is marked takes the tint of the color the mark stands for, with the mark's sticker hanging on its bottom left corner; the captain's keeps the tint of its color, with a small sticker inside its bottom right corner, clear of the numbers of the cards a clue is meant for.

**The group chat.** A guesser may write to their group at any time during a game. Captains read but can't write: the clue is all they say. Spectators and screens see none. A message is one line of up to 200 characters, cleaned as `shared/src/text.ts` says. Each group keeps its latest 20 messages; it goes with every snapshot, lasts one game and stays readable after the end.

**After the game** the groups talk it over, each in its own chat, until the next game starts or the room closes: everyone who played for the group in the game may write to it from a seat in it, its PI too; whoever only sat down after the end reads, and the other group still sees nothing (`game_over` for anyone else). A message written then is marked as written after the game (`after`), and the chat shows those under a heading of their own after the turns, as the review does at its end. The record of the game keeps them, after its end ([Replays](#replays)).

On a phone the chat opens as a sheet: with the keyboard up at once while there is nothing to read, and without it once there is, since the player may only want to read. Once the keyboard is up, the sheet keeps above it, as tall as the screen that the keyboard leaves, with the line at its foot and the messages scrolling above it, at the newest.

## Quick reactions

Anyone in the room may send a quick reaction ([../architecture.md](../architecture.md#messages)), except whoever has seen the key, while a group's students are guessing, paused or not: the PIs of both groups, and anyone who has been a PI in this game and has stepped out to watch (`keyViewers` in `seats.ts`, by member key, so that leaving the room and coming back changes nothing). They see every color, and a reaction then could point the students to a card. The server refuses with `emote_not_now` (`GameModule.mayEmote`), and each member's view says whether they may react now (`mayEmote`), so that the button is greyed out meanwhile.

## Points as they come

A game's points, as a match scores them ([Matches](#matches)), show as they come, as numbers that rise from where they were won and fade, handwritten in the color of the group they are for, with no ground but a white ring that keeps them readable on a card of their own color, and fading where they are for those who ask their devices for less motion. Nothing else shows a score during a game; a match's progress stays folded under the board.

- **A card revealed** in front of the viewer rises from the card with what it did to the viewer's own points, as the group they play for in the game and their role price it: +1 for a card of the group's that its students revealed, the PI too; for an irrelevant paper, the other group's card and Reviewer 2 that they revealed, -1, -2 and -3 for a student and -2, -3 and -5 for the PI. A card that the other group reveals changes nothing for the viewer's group, and a spectator's or a screen's card shows nothing. On a wide screen, where the groups stand beside the board, each player in a group's seat whose points it changed has their own number rise from their avatar at the same time; on a phone, where the groups are a sheet, only the card's.
- **The end of the game** rises big in the middle of the screen with what the end added to the viewer's points: the win and the bonuses together (+3 for a winning student, +4 for the PI, and the big clues, the opening record and the heavenly hand), and nothing for whoever has none. On a wide screen each player's rises from their avatar too. The decision letter above says the result; the number says no word of it.
- The numbers come from what everyone sees, the colors of the revealed cards, the group that revealed each and the seats, priced by the same table as the server's score (`revealPoints()` and `bonusPoints()` in `shared/src/games/keywords/score.ts`); what the end added comes from the points that the snapshot ending the game carries for each player (`RoomView.points`), as the records keep them.
- Only what happens in front of the viewer rises: nothing for the snapshot that catches a page up after a reload or a locked screen, for several cards revealed at once, or across a pause; nothing in a game withdrawn by the chair, and nothing at all in a game that an AI has played in (`RoomView.agentsPlayed`), which brings nobody points.

## Winning

Revealing **Reviewer 2** ends the game at once: that group loses. Otherwise a group wins as soon as all its cards are revealed, whoever revealed the last. The chair may **withdraw** a game, which ends without a winner; a withdrawal names its game, so a late one can't end the next. At the end everyone sees every color.

## Replays

Once a game is over, the results page offers a **review**: the page builds a replay from the view, which now carries every color, and `ReplayViewer` plays it step by step, a step for each clue and each guess, with the board as it stood, who revealed what, and whether it was right. The replay object (`KeywordsReplay` in `shared/src/games/keywords/replay.ts`) holds the board with its colors, the record, the result and the names of those who revealed a card, by player ID; `replaySteps()` turns it into the steps. It names the AI players who played (`agents`), by their persona. The record says who gave each clue (`captain`), the cards they meant (`targets`), which the replay marks with their numbers through the clue's turn, and when each clue and guess came, in milliseconds from the start (`at`); replays from before have none of these. The server builds the same object at the end of a game (`GameModule.replay()`) and keeps it for the players with accounts ([../architecture.md](../architecture.md#replays)); a withdrawn game has none, and neither has a game of a room with [custom words](#custom-words).

The record of a game ([../architecture.md](../architecture.md#game-records)) logs every message of this game but choosing a card, as its schema reads it, without the game's ID and with the clue's word cleaned as the record keeps it; a line of the group chat is kept as what the player said, as the chat shows it, and what the groups say after the end comes after its `end`. The review on the results page ends with what the viewer's group has said since the game ended, under a heading of its own; the replay that the server keeps, which goes to the players of both groups, has none of the chat. Choosing a card is left out because students choose and choose again before they reveal, as much for the fun of it as to decide. The record says how the game began (`GameModule.setup`): the language, the settings, the group that started and the board with every color; and how it came out, once it is over (`GameModule.outcome`): the group that won, and whether it found every card of its own (`found`) or the other group revealed Reviewer 2 (`reviewer2`). Of the marks, it keeps no single one but how they stood: those of the group that reveals a card, as they were when it did, and both groups' when a turn ends and when the game ends, by itself or withdrawn by the chair (`keywords:marks`, by nobody, with the group and its marks; `GameModule.logChanges`), unless a group has none; a game cut short when its room closes has no last note, since nothing in the game changed. Replays carry no marks. It says where each player is, by group and role (`GameModule.seated`), and everyone who has sat in a group during the game has played in it. The game waits for the PI of the group on turn while the clue is due, and for its students while they guess (`GameModule.due`), so a timer that ends a phase names those of them who were offline. The rules are at version 3 (`RULES_VERSION`), which goes up with every change to the rules or the scoring: version 2 brought the marks, the homophone rule and the hold on the quick reactions of whoever has seen the key; version 3 the numbers, the English and the pinyin of a character as a character in common, and the groups' talk after the game.

## What each player sees

| Seat | Cards | Of the groups | Can do |
|---|---|---|---|
| Captain | All words and colors; the English of the characters of the cards still face down | Their group's chat, choices and marks | Give the clue |
| Guesser | All words; revealed colors | Their group's chat, choices and marks | Choose, mark, reveal, end the turn, write |
| Spectator, screen | Like a guesser | Nothing | Watch |
| While paused | No cards at all | As before | Write to the group |
| After the game | Every color | As before, no marks | Review the game; write to the group, PI included, for whoever played for it |

`view.ts` is the only way game state leaves the server to players, by the seat the viewer is in right now. Outside a captain's view an unrevealed card has no `color` key at all; there is no `chat` key outside the groups, no `selections` key outside the group whose turn it is, and no `marks` key outside a group's guessers and captain, or after the game; and before the game is over, no clue on record has `targets`, in any view. Translations, forms and pinyin go to everyone; the `glosses` of a card to the captains alone, while the game is on and the card is face down.

## Seats

- A newcomer who comes to play is a guesser: in the group they played for in this game, else in the smaller group, or at random. Whoever comes to watch, or doesn't say, is a spectator.
- In the waiting room, anyone may take a free captain's seat, join either group as a guesser, or watch. The chair's shuffle deals everyone seated into the two groups at random, with random captains, around the [AI players](#ai-players), who keep their seats. A deal that puts the same people together as before, whatever the colors and the captains, is dealt again once, and the second deal stands: four players then keep their groups one time in nine rather than one in three.
- During a game, spectators may join either group and anyone may step out to watch.
- Whoever sits in a group during a game belongs to it until the next game: the other group is `other_team`, also after the game has ended, since the chat is still there.
- A captain in this game has seen the key and may not be a guesser until the next game (`key_viewer`); an empty captain's seat is open to that group's players and to spectators who haven't played.

## AI players

Where the chair may have them ([../architecture.md](../architecture.md#ai-players)), the chair invites Reviewer 1 in the waiting room as a group's PI or as one of its students, once a person sits in a group (`needs_human`) and one of each a group at most (`agent_limit`), and removes it from its panel, which a tap on its avatar opens. A game with AI players needs every time limit on (`needs_timers`), so that the clock moves the game on when the AI is slow or gone, and a person in a group (`needs_human`). It brings nobody points, a streak, a title or a friend title.

- **As the PI**, it gives its clue no sooner than 3 seconds into its turn, with the cards it is meant for (`targets`), as anyone may; it doesn't talk.
- **As a student, with no person of its group there,** it reveals its cards 2 seconds after the clue and 1.5 seconds apart, the surest first and never the extra guess of the standard rule, and ends the turn once it has revealed them.
- **As a student beside people,** it advises: it chooses its surest card for the group to see and says in the group's chat why, once, and leaves the revealing to them; when they reveal that card, it chooses the next. A person who has been offline for less than 20 seconds is there still, so that nobody's reload turns advice into play.
- **For a player who is offline** for 20 seconds in their turn, an AI plays as they would, the PI's clue or the student's guesses, unless a person of the group is there to play it or the group has an AI student, who plays the guesses alone; of several students offline, one is played for. It stops when they are back. The others see whom it plays for, from the moment an AI is set to play for them.

It knows what the seat it plays sees, no more: a student never the colors of the cards still face down. It reads no chat. What it says and does goes through the same rules and checks as anyone's.

## Messages

On top of the room messages ([../architecture.md](../architecture.md#messages)); schemas in `shared/src/schemas.ts`.

| Message | Payload | Who |
|---|---|---|
| `keywords:seat` | `team` (`red`, `blue`, `null`), `role` (`captain`, `guesser`, `spectator`) | Any member, within the seat rules |
| `keywords:clue` | `gameId`, `turn`, `word`, `count` (1 to the cards left under `free`; 0 to 9 or `"unlimited"` under `standard`), `targets`? (the cards meant) | The current captain |
| `keywords:select` | `gameId`, `turn`, `card` (0 to 24, or `null`) | The current guessers |
| `keywords:mark` | `gameId`, `card` (0 to 24), `mark` (`ours`, `theirs`, `r2`, or `null`) | Either group's guessers, in any turn; at most about 10 messages a second, as for every message; the captains read the marks but can't set them |
| `keywords:reveal` | `gameId`, `turn`, `card` | The current guessers |
| `keywords:pass` | `gameId`, `turn` | The current guessers |
| `keywords:say` | `gameId`, `text` | Either group's guessers, in any turn; after the game, whoever played for the group, its PI too (`game_over` for anyone else) |
| `keywords:pause`, `keywords:resume` | `gameId` | The chair; `not_chair`, `paused`, `not_paused` |
| `keywords:extend` | `gameId`, `turn` | The current captain in the clue phase, a current guesser in the guess phase; `no_extension`, `extension_used` |

The settings travel in `room:create` and `room:settings` as `guessRule`, `clueRule`, `clueLength`, `firstClueTime`, `clueTime`, `guessTime`, `extensions` (`KEYWORDS_SETTINGS`); the chair's own words in `room:settings` as `words`.

## Order of the checks

Before a game action, the server ends a phase whose time has run out. Then:

1. `stale`: an earlier game or turn, or no game.
2. `game_over`, but for a chat message from someone who played for the group in their seat.
3. `paused`, for everything but a chat message and a withdrawal. A pause and a resumption need the chair first (`not_chair`), and then a game that isn't paused, or is (`paused`, `not_paused`).
4. `not_your_turn`, `not_captain`, `not_guesser`; a chat message and a mark only need a guesser.
5. `wrong_phase`, such as revealing before the clue.
6. The content: `bad_count`, `clue_empty`, `clue_not_one_word`, `clue_too_many_words`, `clue_too_long`, `clue_on_board`, `bad_targets`; `no_such_card`, `card_revealed`; `must_guess_first`; `chat_empty`, `chat_too_long`; `no_extension`, `extension_used`.

Content comes last, so nothing a player can't see changes the answer. Two reveals at once are handled one at a time; if the first ends the turn, the second is `stale`.

## Matches

In a match ([../architecture.md](../architecture.md#matches)), `server/src/games/keywords/match.ts` makes the groups and `shared/src/games/keywords/score.ts` scores, in every game that ends by itself. The PI, who gives the clues, plays for higher stakes. A group's students are everyone who played for it as a student in the game, those who sat down during it too, and each of them scores the same, whoever revealed the card; its PI is whoever was its captain in the game:

| What happened | Each student | The PI |
|---|---|---|
| A student of the group reveals one of its own cards | +1 | +1 |
| The group wins | +3 | +4 |
| A student of the group reveals an irrelevant paper | -1 | -2 |
| A student of the group reveals the other group's card | -2 | -3 |
| A student of the group reveals Reviewer 2 | -3 | -5 |
| **A big clue**: the students find 4 of the group's cards or more with one clue | | +1 for each from the fourth on, to the PI who gave it |
| **The opening record**: the group's first clue has a number of 3 or more, and the students find that many of its cards with it before revealing anything else | +1 | +1 |
| **A heavenly hand**: the group wins in the turn of its first clue | +1 | +3 |

The first clue is the first that the group's PI gave: a turn whose time ran out before the clue doesn't count. 0 and "unlimited" name no number, and under the free rule the number counts as it does under the standard rule. A big clue counts the cards found, whether or not they were marked. A card that the other group reveals for a group gives it nothing. The bonuses add up: a heavenly hand comes with the win, and usually with a big clue and the opening record too.

A withdrawn game counts for nothing. `KeywordsScoreDetail` says where each player's points came from, in the match's table between the games, with the PI's role and the bonuses; a detail from before the PI's stakes reads as a student's, without them. The records keep the points alone, so a game already on them keeps the points it was scored with.

**The groups.** Drawn **at random**: the server deals the players as the shuffle does, the first dealt to each group its PI, and deals again once if the groups are those of the game before; four online players can start. **Chosen** by the players: as in an ordinary room. **Fixed**, once a game has been scored: everyone keeps their group; after each game all go back as students, and the PI is whoever has been PI the fewest times; a newcomer goes to the smaller group. During a match game, only those who played for a group may sit in one.

## Titles

A game brings titles to the players with accounts whose game goes on the record ([../architecture.md](../architecture.md#titles)): by the seat they were in when they earned it, and only in a game that ends by itself. A withdrawn game brings none, and a guest keeps none.

| Title | Who | When |
|---|---|---|
| `missed_deadline`, Forgot to Submit | The PI | Each turn in which their time for the clue ran out |
| `deadline_hero`, Deadline Hero | The PI, and each student | Each turn in which the PI gave the clue in the last 3 seconds of their time and it found at least one of the group's cards, or the student revealed one of the group's cards in the last 3 seconds of the guesses |
| `opening_record`, Opened the Scoring | Everyone in the group | The group's [opening record](#matches) |
| `heavenly_hand`, Heavenly Hand | Everyone in the group | The group's [heavenly hand](#matches) |

**Missed deadlines are called out.** The moment a PI's time for the clue runs out, everyone in the room, the PI, both groups, the spectators and the screens, sees a teasing line with the PI's name, to the sound of the "deadline" reaction, for a few seconds, letting every tap through. The line is drawn from a few by the game and the turn, so everyone reads the same. The call is for that moment alone: a page that comes back after a while, from a locked phone, say, hears nothing of the misses it slept through, and nothing of a miss on record when it opened. For a PI with an account it adds how many times they have missed the deadline, this time included: the titles on their record, and the misses of this game so far, whose titles come with its end. The game's `events` note the miss (`missed`), with the PI's player ID and the count; the clue log has the turn without a clue already, and shows no more. A game withdrawn later has been called out all the same.

**Deadline heroes are called out too.** A clue or a guess that comes in the last 3 seconds of a phase's time limit (`DEADLINE_HERO_MS`), with the time that extensions and pauses moved, is noted on the record (`lastSeconds`); a phase without a limit has no last seconds. When a student reveals one of the group's cards, whoever it makes a deadline hero (`heroesOf` in `rules.ts`) is called out to the whole room as a missed deadline is, with a cheering line drawn by the game, the turn and the player, to the sound of the "accept" reaction: the PI, with the first of the group's cards that their last-second clue finds, and the student who reveals one in the last seconds of the guesses. Each is a hero once a turn. For an account, the line adds how many times they have been one, this time included. The game's `events` note it (`hero`), with the player ID and the count. Only the page that sees the card revealed calls it out, as it sees the points rise ([Points as they come](#points-as-they-come)); a page that catches up hears nothing of it.


# Double Blind: team word guessing

The first game in Reviewer 2. Its module in the code is called `keywords`. The name players see, Double Blind, lives in the locale files like every other piece of interface text, so it can change without touching the code.

This document describes the rules as the server enforces them. The pure rules are in `server/src/games/keywords/`, and the types and the clue check that the client shares are in `shared/src/games/keywords/`.

## Names

The game wraps its mechanics in academic life. The code uses plain names, and the interface uses themed ones from the locale files:

| In the code | In the interface (English) | What it is |
|---|---|---|
| `red`, `blue` | Red group, Blue group | The two teams, which are research groups |
| `captain` | PI | Gives the clues and sees the key |
| `guesser` | Student | Reveals cards |
| `spectator` | Spectator | Watches |
| chair | Chair | Runs the room: starts games, manages seats |
| `neutral` | Irrelevant paper | A card that belongs to nobody |
| `reviewer2` | Reviewer 2 | The card that loses the game for the group that reveals it |

## Setting up

- A room has one language, chosen when it is created, and the words on the cards are in that language.
- To start, each group needs exactly one captain, who must be online, and at least one guesser who is online. Until then, the chair's start button stays disabled and says what is missing.
- The server draws 25 different words and picks the starting group at random. That group gets 9 cards and the other group 8. There are 7 irrelevant papers and 1 Reviewer 2, all in random places. The server uses the crypto module for randomness, so the key can't be predicted.
- The 25 words must really differ: two spellings of one word, such as "Attention" and "attention" or "Coauthor" and "Co-author", can't share a board, because the clue check couldn't tell their cards apart.
- A word may bring its term in the other languages of the word library, and the other forms of the term that the library lists in its `forms` field (see [The clue](#the-clue)). Both stay with the card, and every player's view carries them, so that the clue check can run on the captain's screen as well. They are no secret.
- Each game gets a new random `gameId`.

## Settings

A room has settings of its own, which the chair chooses when creating the room and may change in the waiting room, where the word lists are chosen too. Once a game has started they are locked: the game plays with the settings that the room had when it started. Everyone sees them, in the waiting room and in the rules during a game.

| Setting | Choices | Default |
|---|---|---|
| Guess rule | `free` or `standard`; see [Turns](#turns) | `free` |
| Clue rule | `strict` or `loose`; see [The clue](#the-clue) | `strict` |
| Clue length | In a Chinese room, the most Chinese characters a clue may have, 1 to 10. In an English room, the most words, 1 to 3 | 4 in a Chinese room, 1 in an English room |
| Time for the first clue of a game | 0 for no limit, or 10 to 600 seconds | 90 |
| Time for every later clue | The same | 60 |
| Time for the guesses of a turn | The same | 90 |

Every number is a whole number. The room setup checks the settings as the chair types them, says what is wrong with each, and sends them only when they will do; the server checks them again with the same function, `settingsProblems()` in `shared/src/games/keywords/settings.ts`, and refuses them with `bad_settings`. The settings are the game's own, so they live in the game module's data on the server, not in the room.

## Turns

Turns are numbered from 1, and the groups alternate: the starting group plays the odd turns.

1. **Clue.** The current group's captain gives a clue and a number. Which numbers they may give depends on the room's guess rule.
2. **Guesses.** The group's guessers reveal cards one at a time.
   - Under the **free** rule, the number is from 1 to the cards the group still has to find, and it is only a hint: the guessers may go on for as long as they reveal their own cards. There is no 0 and no "unlimited".
   - Under the **standard** rule, the number is from 0 to 9, or "unlimited". With a number from 1 to 9, the guessers may reveal up to that number plus one, and revealing as many as that ends the turn. With 0 or "unlimited", there is no limit.
   - Revealing one of their own cards lets them go on.
   - Revealing an irrelevant paper or a card of the other group ends the turn at once. A card of the other group counts for that group.
   - Once they have revealed at least one card, they may end the turn themselves.
   - Before revealing a card, a guesser may choose it, which shows the choice to the rest of the group. See [Talking it over](#talking-it-over).
3. The turn passes to the other group.

Each phase may have a time limit; see [Time limits](#time-limits).

## The clue

The clue check is shared: the captain's screen runs it while they type, and the server runs it again before it accepts a clue. It takes the room's clue rule and clue length into account.

A clue is made of **words**: letters, digits, hyphens and apostrophes, with no other punctuation, and each with at least one letter or digit. "Self-attention" is one word. A letter may carry accents, but no more than two combining marks once the text is normalized. How many words a clue may have, and how many Chinese characters, depends on the room:

- In an **English room**, a clue may have as many words as the room's clue length, 1 to 3, with spaces between them. Each word may be up to 24 characters long. Spaces in a row count as one, and the clue is recorded with one plain space between its words.
- In a **Chinese room**, a clue is one word, and it may have as many Chinese characters as the room's clue length, 1 to 10. A Chinese room may use English abbreviations such as GPU; an English clue there is still one word.
- In either room, a clue with Chinese characters in it is at most 10 characters long.

A clue with more words than the room allows is refused with `clue_too_many_words`, or with `clue_not_one_word` when the room allows one; punctuation is refused with `clue_not_one_word` as well. A clue that is too long is refused with `clue_too_long`.

Two things are done before anything else:

- A text of more than 128 UTF-16 units is refused as too long without being looked at. Normalizing text is the expensive step of the check, and a text can be built to make it slow.
- Invisible characters, such as zero-width spaces, soft hyphens and variation selectors, are dropped. Inside a clue they could make a word on the board look like a new word.

The clue is then held against every word that is still on the board, whatever its color, so the check gives nothing away about the key. A clue of several words is held against the board as a whole and word by word: each of its words must pass as if it were the clue.

### What is refused under either rule

The server **refuses** a clue that repeats a word still on the board. The two are compared in a common form: full-width and compatibility forms are folded (NFKC), spaces at the ends are trimmed, Latin letters are lowercased, accents are dropped, and traditional Chinese characters are turned into simplified ones. Then the clue is refused when:

- it is the same as a word on the board or a plain plural of it, once everything but letters and digits is taken out of both. So "co-author" is refused for "coauthor", "jetlag" for "jet lag" and "phd" for "Ph.D.";
- a part of the clue is the same as a part of the word, or a plain plural of it. The parts are the runs of letters between spaces, hyphens, apostrophes and digits, with Latin and Chinese characters apart. So "models" is refused for "model", "review" for "peer review", "self-attention" for "attention" and "model2" for "model". Three things are not parts. A single letter: "Occam's" is fine while "Master's" is on the board. Digits. And the small words that hold a compound together, such as "of", "the", "to" and "and": "state-of-the-art" is fine while "out-of-distribution" is on the board;
- a run of Chinese characters in the clue contains a run in the word, or is contained in one. Latin parts are never searched inside other words, so "email" is fine while "AI" is on the board;
- it is the card's term in another language of the word library, or a plain plural of it. In a Chinese room, "journal" is refused while the card for that term is on the board.

A plain plural ends in "-s", or in "-es" after s, x, z, ch or sh: "classes" is a plural of "class", but "grades" is not one of "grad".

### The strict and the loose rule

Two more conflicts depend on the room's clue rule. The **strict** rule refuses them; the **loose** rule only warns the captain and lets them decide:

- **A form that the word library lists.** A term in the library may have a `forms` field, `{ "zh": [...], "en": [...] }`, with the other forms of the term: inflections and derived words beyond the plain plural ("modeling" and "modelled" for "Model", "simulate" for "Simulation"), common compounds that contain it ("dataset" and "database" for "Data"), and its standard abbreviation or full name ("CV" for "Computer vision"). Synonyms are not forms: a synonym is a good clue. A clue that repeats one of a card's forms, in any of the ways listed above in which it would repeat the word on the board, is a conflict: the form itself or a plain plural of it, a part of either, or a run of Chinese characters that contains one of the form's or lies inside one. So "dataset-scale" is a conflict while "Data" with the form "dataset" is on the board, "vision" while "CV" with the form "Computer vision" is, and two characters out of a Chinese form of six. The forms of both languages count in either room. When two word lists have the same word, its card gets the forms of both.
- **A Chinese character in common.** A clue that has a Chinese character in common with the word on a card is a conflict, with traditional and simplified characters folded as above. A character in common with a card's term in another language only brings a warning, under either rule, as other near misses with a translation do.

### What only brings a warning

The captain is **warned, but not refused**, under either rule, when the check can only guess:

- The clue may be another form of a word on the board: one with an ending such as "-ing", "-ed", "-er", "-ion" or "-ies", or a Latin, Greek or irregular plural. "Modeling" for "model", "simulate" for "simulation" and "hypotheses" for "hypothesis" are examples. The same warning comes up for a part or a form of a card's term in another language. The standard rules forbid any form of a word on the board, but endings are too ambiguous for a machine to judge, so the captain decides. A form that the word library lists is no guess, and falls under the clue rule above.
- The clue contains a word on the board, or a part of one, of four Latin letters or more: "datacenter" while "Data" is on the board, or "metadata" while "Big data" is. The same goes for a card's term in another language.

The captain's screen shows one line for each kind of warning, naming the cards. When a clue runs into several cards, a conflict that every rule refuses is named before one that only the strict rule refuses.

Words that have been revealed no longer count, and may be used as clues again. The clue is recorded as the captain typed it, without invisible characters, without the spaces at its ends, and with one plain space between its words.

The table of traditional and simplified characters is `shared/src/han-variants.ts`. `scripts/build-han-variants.mjs` builds it from the character table of the [OpenCC](https://github.com/BYVoid/OpenCC) project, which is used under the Apache License 2.0.

The check doesn't know letters of different alphabets that look alike, such as a Cyrillic "o" inside a Latin word. Whoever writes a clue that way has made a new word as far as the server can tell.

## Time limits

Each phase of a turn may have a time limit, from the room's settings: the first clue of a game, every later clue, and the guesses of each turn. The server keeps the time and ends a phase whose time has run out:

- **A captain who gives no clue in time** loses the turn: it passes to the other group, and the record of the game gets an entry for the turn without a clue (`word` and `count` are null, and `timedOut` is true).
- **Guessers who run out of time** end their turn, whether or not they have revealed a card. The turn's clue is marked `timedOut` in the record.

The next phase's time counts from the moment the server ended the last one. Time runs whether or not the players are online: a captain who has gone offline loses the turn like any other. Revealing a card gives the guessers no more time.

The state holds the moment at which the current phase ends, on the server's clock, which only runs forward. When that moment comes, a timer ends the phase and everyone gets a snapshot. An action that arrives after it, even before the timer has fired, finds the turn over: the server applies whatever was due before it looks at any game action, so the action is `stale` like any other that is meant for a turn that has ended. An action that the server handles before that moment stands, and the time of the phase it starts counts from it. A game that ends, is withdrawn or goes back to the waiting room has no time running, and its timer is cleared, as is the timer of a room that closes. Time running out is not something happening in the room: a room in which nobody does anything still closes when the sweep finds that nothing has happened in it for six hours ([../architecture.md](../architecture.md#limits-and-housekeeping)).

Every view of the game carries `clock`, with how much time the phase had left when the view was sent and how much it was given, in milliseconds, or null when the phase has no limit. A client draws its countdown from that, counting down from when the view arrived, and starts again from every new view. It never ends a phase itself. The bar turns red for the last 10 seconds.

## Talking it over

Players in one room can simply talk. Players who are apart need to see what the others in their group are thinking, so the game gives each group two things that the other group never sees.

**Choosing a card.** In their group's guess phase, a guesser may choose a card before revealing it, or take the choice back.

- The group's guessers and its captain see who has chosen which card. Each guesser has one choice at a time, and several may choose the same card.
- Choosing reveals nothing and doesn't count as a guess. Revealing a card doesn't need a choice first.
- Every choice is cleared when a card is revealed, because the board has changed, and when the turn or the game ends. A guesser who leaves their seat or the room takes their choice with them.

**The group chat.** A guesser may write to their group at any time during a game, in either group's turn.

- Only guessers write. Captains read their own group's chat, as they would hear their group at a table, but can't write: the clue is all a captain may say. Spectators and screens see no chat, since they can see both groups and could carry a message across.
- A message is one line of up to 200 characters, as a reader counts them: an emoji is one, however many code points it is built from. Line breaks become spaces, and hidden characters are dropped: zero-width spaces, soft hyphens, the characters that turn the direction of text around, tag characters and the like. The silent characters that emoji and the letters of some scripts are built with stay, that is the joiners, the variation selectors and the direction marks, and so do the tags of the flags of England, Scotland and Wales. A character keeps at most four marks of each kind, four that sit on it and four that stand beside it, which is what the scripts that stack their letters, such as Tibetan and Burmese, need, and keeps a pile of accents short. A message can't start with a mark, which would settle on the name before it. The check is shared, like the clue check: the player's screen runs it while they type, and the server runs it again. What shows and what doesn't is decided in `shared/src/text.ts`, which nicknames share.
- Each group keeps its latest 20 messages. Every message has an ID that counts up from 1 within its group, and carries the turn in which it was written. The chat goes out with every snapshot, and a snapshot goes to everyone after every change, so a group's chat is kept short to keep the snapshots small.
- The chat lasts for one game. It stays in its group after the game is over, even though every color is shown then, and the next game starts with an empty one.

## Winning

- Revealing **Reviewer 2** ends the game at once: the group that revealed it loses.
- Otherwise, a group wins as soon as all its cards are revealed, even if the other group revealed the last one.
- The chair may also **withdraw** a game. It ends without a winner. A withdrawal names the game it is meant for, so that one that arrives late, for instance from a tab that was offline, can't end the next game.

At the end, everyone sees the colors of all the cards. "Play again" takes the room back to the waiting room with everyone in their seats, and the next game deals a new board.

## What each player sees

| Seat | Cards | Of the groups | Can do |
|---|---|---|---|
| Captain | All 25 words and all their colors | Their group's chat, and its guessers' choices in its turn | Give the clue in their group's clue phase |
| Guesser | All 25 words; colors only of revealed cards | Their group's chat, and its guessers' choices in its turn | Choose and reveal cards and end the turn in their group's guess phase; write to their group |
| Spectator, screen | Like a guesser | Nothing | Watch |
| After the game, everyone | Every color | As before | |

`view.ts` is the only way game state leaves the server. It decides by the seat a viewer is in right now, so a captain who steps down to watch gets a spectator's view. In every view but a captain's, an unrevealed card has no `color` key at all, rather than an empty one, so the key can't be found even with the browser's developer tools. In the same way, a view has no `chat` key for a viewer outside the two groups, and no `selections` key for anyone but the group whose turn it is. The server never sends its random seed or its own order of the words.

Everyone sees the public facts: the room's settings, whose turn it is and in which phase, the current clue, how many more cards may be revealed under the standard rule, how much time the phase has left, how many cards each group has left, and every earlier clue with the cards revealed after it. Every card carries its translations and its forms, which are no secret.

## Seats

- A newcomer chooses to play or to watch, when they create the room or join it. Whoever comes to play is seated as a guesser: in the group they have played for in the current game, if any, or else in the group with fewer players, its captain and those who are offline counted, or in either at random when both have as many. The rules below hold as for any other seat, so someone who has seen the key in this game watches instead. Nobody is made a captain this way: the chair's shuffle picks the captains, or players take the seats themselves. Whoever comes to watch is a spectator, and so is a newcomer whose client doesn't say.
- In the waiting room, anyone may take a free captain's seat, become a guesser in either group, or watch. The chair can shuffle the groups: everyone seated in a group is dealt into the two groups at random, as evenly as possible, with a random captain for each. Players who are online are dealt first, so the captains and a guesser in each group are online whenever at least four seated players are. Spectators stay where they are.
- During a game, spectators may join either group, so latecomers can play, and anyone may step out to watch.
- Whoever sits in a group during a game belongs to it until the next game. They may step out and come back, but a seat in the other group is refused with `other_team`. Otherwise a guesser could change groups in the middle of a turn and reveal cards or end the turn for the other group. This holds after the game has ended as well, until the chair plays again, because each group's chat is still there to read. Sitting down only after the game has ended, for the next one, makes nobody a player of this one: they read both decision letters, as a spectator does, and may still move to the other group.
- A group's empty captain's seat is open to that group's players and to spectators who haven't played in this game. Whoever has been a captain in the current game has seen the key, and may not be a guesser again until the next game (`key_viewer`). A captain may step down to watch.
- Both lists, the key viewers and each player's group, are kept by a key that stays the same when a player leaves the room and comes back.

## Messages

The game's messages, on top of the room messages in [../architecture.md](../architecture.md). Their schemas are in `shared/src/schemas.ts`, and `server/src/games/keywords/index.ts` connects them to the rules.

| Message | Payload | Who |
|---|---|---|
| `keywords:seat` | `team` (`red`, `blue` or `null`) and `role` (`captain`, `guesser` or `spectator`) | Any member, within the seat rules |
| `keywords:clue` | `gameId`, `turn`, `word`, `count`: 1 to the cards the group has left under the free rule; 0 to 9, or `"unlimited"`, under the standard rule | The current group's captain |
| `keywords:select` | `gameId`, `turn`, `card` (0 to 24, or `null` to take the choice back) | The current group's guessers |
| `keywords:reveal` | `gameId`, `turn`, `card` (0 to 24) | The current group's guessers |
| `keywords:pass` | `gameId`, `turn` | The current group's guessers |
| `keywords:say` | `gameId`, `text` (one line, up to 200 characters once cleaned) | The guessers of either group, in either group's turn |

A guesser who leaves their seat in any of these ways, or leaves the room, takes their choice of a card with them; see [Talking it over](#talking-it-over).

The room's settings come with `room:create` and `room:settings` ([../architecture.md](../architecture.md#messages)), as an object with the fields `guessRule`, `clueRule`, `clueLength`, `firstClueTime`, `clueTime` and `guessTime`. Its schema, `KEYWORDS_SETTINGS`, is in `shared/src/schemas.ts`.

In every snapshot, the game's part (`RoomView.data`) holds:

- the room's settings;
- the seats of everyone in the room;
- the players who have seen the key in the current game;
- the group that the viewer plays for in the current game, if any, so that the interface offers only the seats they may take;
- in the waiting room, what still keeps the game from starting;
- the game itself, from `view.ts`. A player sees the key only while sitting as a captain, so a captain who steps down to watch gets the public view again. In the same way, a player gets their group's chat, and its choices of cards in its turn, only while sitting in it; spectators and screens get neither.

## Order of the checks

Every action carries the `gameId` and the `turn` it was meant for. A withdrawal and a chat message carry only the `gameId`, because they are meant for the game, whatever the turn. Before it checks a game action, the server ends the phase whose time has run out, if any; see [Time limits](#time-limits). It then checks the action in this order:

1. `stale`: the action is for an earlier game or turn, or arrives in the waiting room, where there is no game. This stops an action that a phone sends late, for instance after reconnecting, from landing in the wrong turn.
2. `game_over`: the game has ended.
3. `not_your_turn`, `not_captain` or `not_guesser`: the action isn't this player's to make. A chat message is never out of turn: it only needs a guesser.
4. `wrong_phase`: it isn't the moment, such as revealing or choosing a card before the clue.
5. The content: `bad_count`, `clue_empty`, `clue_not_one_word`, `clue_too_many_words`, `clue_too_long` and `clue_on_board` for clues; `no_such_card` and `card_revealed` for reveals and choices; `must_guess_first` for ending a turn before revealing anything; and `chat_empty` and `chat_too_long` for chat messages. Which numbers `bad_count` allows depends on the guess rule, and the clue checks depend on the clue rule and the clue length.

Because the content comes last, nothing a player can't see changes the answer they get. A guesser of the wrong group gets `not_your_turn` whichever card they try.

## Edge cases

- **Two guessers reveal at once.** The server handles actions one at a time, and never pauses between reading the state and writing it. If the first reveal ends the turn, the second is `stale`.
- **Repeated clicks.** Revealing a revealed card again is `card_revealed`. A second "start" or a second clue fails the phase check.
- **A guesser chooses a card while another reveals one.** If the choice arrives second, it stands for the new board, unless the turn has ended (`stale`) or it was the very card that was revealed (`card_revealed`).
- **A captain or all guessers go offline.** The game shows them as offline. Without a time limit, it waits for them; with one, their time runs out as it would anyway. The chair can make an offline player a spectator so that someone else can take over, or withdraw the game.
- **An action and the end of the time arrive together.** Whichever the server handles first wins. An action that comes after the time is up is `stale`, even if the timer that ends the phase hasn't fired yet.

## Matches

A room can be a match, which plays a set number of games and ranks the players by their scores ([../architecture.md](../architecture.md#matches)). The game decides how each player scores and how the groups are made from one game to the next (`server/src/games/keywords/match.ts`).

### Scoring

Each player scores in every game of the match that ends by itself, as the server counts it (`shared/src/games/keywords/score.ts`):

| What happened | Who | Points |
|---|---|---|
| A student of a group reveals one of the group's own cards | Everyone who played for the group in that game, its PI included | +1 each |
| The group wins | The same | +3 each |
| A student reveals a card of the other group | That student | -1 |
| A student reveals Reviewer 2 | That student | -3 |
| A student reveals an irrelevant paper | | 0 |

A card that the other group reveals for a group doesn't count as found: the group gets nothing for it, and the student who revealed it loses a point. Everyone who sat in a group during the game played for it, also if they stepped out to watch or left the room before its end, and what a student revealed counts for them after they have left. A game that the chair withdrew counts for nothing. The table shows where each player's points came from.

### The groups

How the waiting room seats the players for each game of a match depends on its rules:

- **Drawn at random** (groups that may change, before every game, and fixed groups, before the first): the players only say that they play, and the waiting room lists them together. When the chair starts the game, the server deals them into the groups as the chair's shuffle does, those who are online first, and the first one dealt to each group is its PI. The game can start once four players in a seat are online. A first game that the chair withdrew is drawn again.
- **Chosen by the players** (groups that may change, before every game, and fixed groups, before the first): as in a room that isn't a match.
- **Fixed,** once a game of the match has been scored: everyone who played for a group in it plays for that group for the rest of the match, and is offered seats in it alone. After each scored game, everyone goes back to their group as a student, and each group's PI is the one who has been a PI the fewest times in the match, someone online before someone who isn't, and one of them at random when several have been as often. The players may still swap the PI's seat within their group. A newcomer, who hasn't played for a group yet, goes to the group with fewer players, or to either when both have as many, and stays in it once they have played a game. Nobody else may change groups, whoever leaves: a group that has too few players left to play ends the match early, or waits for newcomers. A guest who logs in keeps their seat, and their account plays for its group from then on, also when the account played for the other group earlier in the match and left.

While a game of the match is on, only those who have played for a group in it may sit in one. A newcomer who comes to play watches the game and plays from the next one, from 0 points, and the chair's shuffle has nothing to do in a waiting room whose groups are drawn or fixed.

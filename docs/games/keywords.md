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
- The 25 words must really differ: two spellings of one word, such as "Attention" and "attention", can't share a board, because the clue check couldn't tell their cards apart.
- A word may bring its term in the other languages of the word library. The translations stay with the card, and every player's view carries them, so that the clue check can refuse them on the captain's screen as well. They are no secret.
- Each game gets a new random `gameId`.

## Turns

Turns are numbered from 1, and the groups alternate: the starting group plays the odd turns.

1. **Clue.** The current group's captain gives one word and a number from 0 to 9, or "unlimited".
2. **Guesses.** The group's guessers reveal cards one at a time.
   - With a number from 1 to 9, they may reveal up to that number plus one.
   - With 0 or "unlimited", there is no limit.
   - Revealing one of their own cards lets them go on. Revealing as many as the limit allows ends the turn.
   - Revealing an irrelevant paper or a card of the other group ends the turn at once. A card of the other group counts for that group.
   - Once they have revealed at least one card, they may end the turn themselves.
   - Before revealing a card, a guesser may choose it, which shows the choice to the rest of the group. See [Talking it over](#talking-it-over).
3. The turn passes to the other group.

## The clue

The clue check is shared: the captain's screen runs it while they type, and the server runs it again before it accepts a clue.

A clue must be **one word**: letters, digits, hyphens and apostrophes, with no spaces or other punctuation, and with at least one letter or digit. "Self-attention" is one word. A letter may carry accents, but no more than two combining marks. A clue may be up to 24 characters long, or 10 when it contains Chinese characters. A Chinese room may use English abbreviations such as GPU.

Two things are done before anything else:

- A text of more than 64 UTF-16 units is refused as too long without being looked at. Normalizing text is the expensive step of the check, and a text can be built to make it slow.
- Invisible characters, such as zero-width spaces, soft hyphens and variation selectors, are dropped. Inside a clue they could make a word on the board look like a new word.

The server **refuses** a clue that repeats a word still on the board. The two are compared in a common form: full-width and compatibility forms are folded (NFKC), spaces at the ends are trimmed, Latin letters are lowercased, accents are dropped, and traditional Chinese characters are turned into simplified ones. Then the clue is refused when:

- it is the same as a word on the board or a plain plural of it, also once hyphens, spaces and apostrophes are taken out of both. So "co-author" is refused for "coauthor", and "jetlag" for "jet lag";
- a part of the clue is the same as a part of the word, or a plain plural of it. The parts are the runs of letters between spaces, hyphens, apostrophes and digits, with Latin and Chinese characters apart. So "models" is refused for "model", "review" for "peer review", "self-attention" for "attention" and "model2" for "model". A single letter is not a part, so "Occam's" is fine while "Master's" is on the board, and neither are digits;
- a run of Chinese characters in the clue contains a run in the word, or is contained in one. Latin parts are never searched inside other words, so "email" is fine while "AI" is on the board;
- it is the card's term in another language of the word library, or a plain plural of it. In a Chinese room, "journal" is refused while the card for that term is on the board.

A plain plural ends in "-s", or in "-es" after s, x, z, ch or sh: "classes" is a plural of "class", but "grades" is not one of "grad".

The captain is **warned, but not refused**, when the clue may be another form of a word on the board: one with an ending such as "-ing", "-ed", "-er", "-ion" or "-ies", or a Latin, Greek or irregular plural. "Modeling" for "model", "simulate" for "simulation" and "hypotheses" for "hypothesis" are examples. The same warning comes up for a part or a form of a card's term in another language. The standard rules forbid any form of a word on the board, but endings are too ambiguous for a machine to judge, so the captain decides.

Words that have been revealed no longer count, and may be used as clues again. The clue is recorded as the captain typed it, without invisible characters and without the spaces at its ends.

The table of traditional and simplified characters is `shared/src/han-variants.ts`. `scripts/build-han-variants.mjs` builds it from the Unicode Han Database.

## Talking it over

Players in one room can simply talk. Players who are apart need to see what the others in their group are thinking, so the game gives each group two things that the other group never sees.

**Choosing a card.** In their group's guess phase, a guesser may choose a card before revealing it, or take the choice back.

- The group's guessers and its captain see who has chosen which card. Each guesser has one choice at a time, and several may choose the same card.
- Choosing reveals nothing and doesn't count as a guess. Revealing a card doesn't need a choice first.
- Every choice is cleared when a card is revealed, because the board has changed, and when the turn or the game ends. A guesser who leaves their seat or the room takes their choice with them.

**The group chat.** A guesser may write to their group at any time during a game, in either group's turn.

- Only guessers write. Captains read their own group's chat, as they would hear their group at a table, but can't write: the clue is all a captain may say. Spectators and screens see no chat, since they can see both groups and could carry a message across.
- A message is one line of up to 200 characters. Line breaks become spaces, and invisible characters and piles of combining marks are dropped. The check is shared, like the clue check: the player's screen runs it while they type, and the server runs it again.
- Each group keeps its latest 50 messages. Every message has an ID that counts up from 1 within its group, and carries the turn in which it was written.
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

Everyone sees the public facts: whose turn it is and in which phase, the current clue, how many more cards may be revealed, how many cards each group has left, and every earlier clue with the cards revealed after it.

## Seats

- Everyone joins as a spectator.
- In the waiting room, anyone may take a free captain's seat, become a guesser in either group, or watch. The chair can shuffle the groups: everyone seated in a group is dealt into the two groups at random, as evenly as possible, with a random captain for each. Players who are online are dealt first, so the captains and a guesser in each group are online whenever at least four seated players are. Spectators stay where they are.
- During a game, spectators may join either group, so latecomers can play, and anyone may step out to watch.
- Whoever sits in a group during a game belongs to it until the next game. They may step out and come back, but a seat in the other group is refused with `other_team`. Otherwise a guesser could change groups in the middle of a turn and reveal cards or end the turn for the other group.
- A group's empty captain's seat is open to that group's players and to spectators who haven't played in this game. Whoever has been a captain in the current game has seen the key, and may not be a guesser again until the next game (`key_viewer`). A captain may step down to watch.
- Both lists, the key viewers and each player's group, are kept by a key that stays the same when a player leaves the room and comes back.

## Order of the checks

Every action carries the `gameId` and the `turn` it was meant for. A withdrawal and a chat message carry only the `gameId`, because they are meant for the game, whatever the turn. The server checks an action in this order:

1. `stale`: the action is for an earlier game or turn. This stops an action that a phone sends late, for instance after reconnecting, from landing in the wrong turn.
2. `game_over`: the game has ended.
3. `not_your_turn`, `not_captain` or `not_guesser`: the action isn't this player's to make. A chat message is never out of turn: it only needs a guesser.
4. `wrong_phase`: it isn't the moment, such as revealing or choosing a card before the clue.
5. The content: `bad_count`, `clue_empty`, `clue_not_one_word`, `clue_too_long` and `clue_on_board` for clues; `no_such_card` and `card_revealed` for reveals and choices; `must_guess_first` for ending a turn before revealing anything; and `chat_empty` and `chat_too_long` for chat messages.

Because the content comes last, nothing a player can't see changes the answer they get. A guesser of the wrong group gets `not_your_turn` whichever card they try.

## Edge cases

- **Two guessers reveal at once.** The server handles actions one at a time, and never pauses between reading the state and writing it. If the first reveal ends the turn, the second is `stale`.
- **Repeated clicks.** Revealing a revealed card again is `card_revealed`. A second "start" or a second clue fails the phase check.
- **A guesser chooses a card while another reveals one.** If the choice arrives second, it stands for the new board, unless the turn has ended (`stale`) or it was the very card that was revealed (`card_revealed`).
- **A captain or all guessers go offline.** The game waits and shows them as offline. The chair can make an offline player a spectator so that someone else can take over, or withdraw the game.

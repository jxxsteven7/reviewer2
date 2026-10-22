# Who's Reviewer 2?: hidden word voting

The second game, in beta ([Beta](#beta)). Its module is `impostor`; the name players see lives in the locale files. Rules: `server/src/games/impostor/`; shared types, settings, the checks of what players write and the scoring: `shared/src/games/impostor/`.

## Names

| In the code | In the interface | What it is |
|---|---|---|
| `student` | Student | Has the students' term, which most players share |
| `reviewer2` | Reviewer 2 | Has the other term of the pair, and doesn't know that it is the odd one |
| `pi` | PI | Has no term, knows it, and has to bluff |
| `word`, `words.student`, `words.reviewer2` | Term, the students' term, Reviewer 2's term | The two terms of a pair |
| `number` | #3 | A player's number in the game, dealt at random |
| `setter` | Setter | The chair, who sets the two terms instead of the word library, and watches |
| `offField`, `talk` | Sidelines, After the game | The chat of those who don't play now, and everyone's talk after the game |
| `report` | Report | A player's charge that another broke the rules, which the others judge |
| `comeback` | Comeback guess | One guess of the students' term by a Reviewer 2 or a PI just voted out |
| `alive`, `voted_out`, `violation`, `left` | Lasted, Voted out, Broke the rules, Left | How a player's game went (`Fate`) |

## Roles

4 to 12 play (`MIN_PLAYERS`, `MAX_PLAYERS`). `roleCounts()` in `shared/src/games/impostor/types.ts` decides how many of each there are:

| Players | Reviewer 2s | PI | Students |
|---|---|---|---|
| 4 or 5 | 1 | none | the others |
| 6 to 8 | 1 | 1, if the room has the PI | the others |
| 9 to 12 | 2 | 1, if the room has the PI | the others |

The students and the Reviewer 2s get a term each and nobody is told their role; the PI gets none, and so knows. A player learns their role once they are out, and everyone at the end.

## Setting up

- The room's language, chosen at creation, is the terms' language, and sets the range of the description's length ([Settings](#settings)).
- **Places at the table.** A newcomer who comes to play (`play: true`) takes a place for the next game, if one of the 12 is free; whoever comes to watch, or doesn't say, watches. In the waiting room, and once a game is over, anyone may take a place or give it up and watch, with one button (`impostor:seat`; `table_full`). The places keep the order in which their players came. The chair may move a player to watch (`room:spectate`) in the waiting room and once a game is over; the shuffle does nothing, since there are no groups. The setter plays no game, even with a place ([The setter](#the-setter)).
- **Starting.** The chair starts with `room:start` once nothing is in the way, and the room view lists what is (`startProblems`): fewer than 4 players online at the table (`needs_players`, with how many more are needed) or more than 12 (`too_many_players`, with how many too many), the setter not counted; a setter who hasn't set the terms (`needs_words`); and, with [AI players](#ai-players), a time limit off (`needs_timers`) or no person playing (`needs_human`). Otherwise the room refuses with `cannot_start`. A player at the table who is offline as the game starts watches that game and keeps the place for the next.
- **The deal** (`newGame()` in `rules.ts`): everyone who plays gets a number from 1 up, at random ([Numbers](#numbers)), and a role at random; the server draws the terms ([The words](#the-words)), or takes the setter's, and gives one of the two to the students at random and the other to the Reviewer 2s.
- Whoever comes during a game watches it, and one who comes to play takes a place for the next. After the game, `room:again` brings everyone back to the waiting room at their places.

## Settings

Set by the chair when the room is created and in the waiting room; a game plays with the settings the room had when it started.

| Setting | Choices | Default |
|---|---|---|
| Time to describe (`describeTime`), time to vote (`voteTime`) | 0 for no limit, for a game played around one table, or 10 to 600 seconds | 60, 30 |
| Line length (`length`) | Chinese room: 5 to 50 characters; English room: 20 to 150 | 20; 60 |
| PI (`pi`) | `true` or `false`: a PI in a game of 6 or more | `true` |
| Comeback guess (`comeback`) | `true` or `false` ([Coming back](#coming-back)) | `false` |
| Anonymous seats (`anonymous`) | `true` or `false` ([Numbers](#numbers)) | `true` |
| God view (`godView`) | `true` or `false`: spectators see every role and both terms; a private room only | `false` |
| Setter (`setter`) | `true` or `false`: the terms come from a setter instead of the word library; a private room only ([The setter](#the-setter)) | `false` |

A description's length is counted in the characters that a reader sees, the same way in both languages (`textLength()` in `shared/src/text.ts`). `settingsProblems()` in `shared/src/games/impostor/settings.ts` checks the settings on both sides; the server refuses with `bad_settings`. A public room takes neither the god view nor the setter, and a room with either can't be made public (`private_only`, `mayBePublic()`). The room setup asks where the terms come from before the word lists (`SourceChoice.vue`), and offers the setter to an account alone. Settings kept from an earlier room setup are taken where they still will do (`restoreSettings()`), and a length from a room in the other language starts from the default.

Two times don't depend on the settings: a report is judged within 20 seconds (`REPORT_SECONDS`) and a comeback guess takes 30 (`COMEBACK_SECONDS`). There is no pause and no extension: only a report stops the clock.

## The words

Unless the room has a setter, each game draws one pair of related terms from the word library (`words: { pair: true }` in `GameModule`): two terms of the same list, the first naming the second in its `related` ([../../words/README.md](../../words/README.md#related-terms)), from the chair's fields, or from fields drawn anew for the game ([../architecture.md](../architecture.md#games)). A list serves the game when it has a pair. `drawPair()` in `server/src/core/words.ts` draws it:

1. It leaves out every pair that 2 people or more rated "Something's wrong" (`problem`, `PAIR_PROBLEMS`; [The end](#the-end)): an account counts once, however many games with the pair it rated, and a guest once a game.
2. It prefers, in turn, a pair that the room hasn't played and that no two of the players with accounts have had in one kept game together; then a pair that the room hasn't played; then any: the preferences are in that order, and a pair that two have had together is still drawn when no other is left.
3. Of those, it keeps the ones that the players with accounts have had the fewest times in all, and takes one of them at random, each as likely as 1 and the number of people who rated it "Good". With no pair to draw, the start is refused with `no_words`.

The players are those who play the game about to start (`GameModule.players`), not whoever only watches.

Each term comes with its term in the other language, its forms in both languages and, for a Chinese term, its pinyin, which the checks of the lines hold lines against ([Describing](#describing)). The record of the game keeps where the pair came from: the field, the pair's key (`pairKey()`, the field and the IDs of the two terms) and which term went to whom ([Replays](#replays)). The records of the pairs (`RatingStore.pairRecords()` in `server/src/store/ratings.ts`) are counted from the kept games and the ratings whenever a room draws.

## The setter

With `setter` on, the terms come from a person instead of the word library: the **setter**, who is whoever chairs the room, and who watches the game.

- **Private rooms alone** (`private_only`), and setting the terms takes an account (`account_required`), to which a pair adopted into the word library is credited.
- **Setting the terms.** In the waiting room the setter sends them with `impostor:words`: term A, term B, the field they belong to, which must be one of the word library's (`bad_field`), and whether to be named if the pair is adopted (`named`, ticked by default; unticked, the credit is anonymous). Both must be there (`words_missing`), each must fit on a card, 5 Chinese characters or 14 other characters (`words_too_long`), and they must differ, counting only letters and digits, and not be plain plurals of each other (`words_same`); `checkSetterWords()` in `shared/src/games/impostor/lines.ts` runs on both sides. The setter may change them until the game starts. They go to the setter alone (`setterWords` in the room's data); the others see who sets them and whether it is done.
- The terms count only while the one who set them chairs the room: when the chair passes to someone else, as after 3 minutes offline, the new chair sets them again (`needs_words`), and turning the setter off forgets them. Each game takes a pair of its own: once one is played, the setter sets the terms of the next anew. In a [match](#matches), a pair that the match has had is refused (`words_played`), and the match ends once its setter no longer chairs the room.
- As the game starts, one of the two goes to the students at random. A Chinese term gets its pinyin, which the line check holds lines against; a setter's terms have no forms or translations.
- **During the game** the setter doesn't play or score, even with a place at the table: the strip shows both terms, sorted so that their order tells nothing, and not which is whose; everything else is as a spectator sees it, and the setter talks off the field ([Off-field](#off-field)), never writing either term.
- **Afterwards.** The record keeps the setter (`source` with `setter`, `field` and `named`), who took part in the game without playing in it (`GameModule.contributors`): the setter may watch it again and send feedback about it. The pair may be adopted into the word library ([../architecture.md](../architecture.md#content-contributions), `GameModule.content`). An account's records page counts the games whose terms it set that finished, and how many players rated them "Good".

## Numbers

As the game starts, every player gets a number from 1 to the number of players, at random, and is shown by it for the whole game: "#3", an avatar with the number in ink on a color that the number chooses, as a guest's default avatar is drawn, so that a number has one color wherever it shows (`SeatAvatar.vue`, [../rules/display.md](../rules/display.md#the-second-game)). The waiting room shows everyone's own avatar until then. The numbers give the order in which the players describe.

In an **anonymous** game, the default, nobody but the player knows whose number is whose until the game is over, the chair included, nor which numbers the AI players have. With anonymity off, every seat shows its player's name beside the number. Either way the data knows players by their player IDs (`by` in the log and the records); the numbers are in the setup, beside the player IDs and the roles.

Every number's avatar opens its panel ([The board](#the-board)). The chair removes a player by their number (`room:remove` with `seat`, which is `gameId` and `number`; `GameModule.playerAt`), which is all the chair knows of them in an anonymous game ([Leaving](#leaving)).

## Rounds

Rounds are numbered from 1. Each goes through the phases of `PHASES`:

1. **Describe** (`describe`). Everyone still in the game writes one line about their term, one at a time, in the order of their numbers, the lowest first, each with the time to describe ([Describing](#describing)).
2. **Vote** (`vote`). Everyone still in the game votes at once ([Voting](#voting)).
3. **Tie** and **revote** (`tie`, `revote`), when the vote is tied for the most votes: the tied players add a line each, and the others vote again among them.
4. **Comeback** (`comeback`), when a Reviewer 2 or the PI has been voted out and the room allows a guess ([Coming back](#coming-back)).
5. The next round, unless the game is over (`over`, [Winning](#winning)).

A report may come in any phase but the comeback guess, and holds the clock while it is judged ([Reports](#reports)). Every action names its game and, where it matters, the round, so that a late one can't land in a later round.

The server keeps the time. Every view carries `clock`, the time left and given, in milliseconds, or null for a phase without a limit; while a report is judged, it is the report's. Time runs whether or not players are online. Before every message of the game the server does what is due by then (`tick()`, `expire()` in `rules.ts`): a report whose time is up is settled, a line whose time ran out is missed, a vote whose time ran out is revealed, and a guess whose time ran out is none. In this game no AI plays for a person who is offline: their turns run out as anyone's.

## Describing

In their turn, a player writes one line about their term (`impostor:describe`, with the round). Only a typed line counts: there is nothing to send without one (`line_empty`). The PI, who has no term, writes about what they make of the students'. `checkDescription()` in `shared/src/games/impostor/lines.ts` checks the line, on the player's screen as they type and on the server again:

- **Its length**: cleaned as a line is kept, on one line, without hidden characters or spaces at its ends (`cleanLine()` in `shared/src/text.ts`), it may have up to the room's length in the characters that a reader sees, an emoji or a letter with its marks counting as one (`line_too_long`). A line of more than 1,000 UTF-16 units as it arrives is too long whatever it holds (`MAX_LINE_INPUT`).
- **Nothing of the writer's own term** (`line_has_word`), compared after NFKC, lowercasing, dropping accents and folding traditional to simplified Chinese (`givesAway()`):
  - any Chinese character of the term, anywhere in the line;
  - the term, one of its forms or its term in the other language, whole: as its Chinese characters in a row, spaces ignored, or as its Latin words in a row, with spaces or solid, of 4 letters or more in all ("machinelearning" for "Machine learning");
  - a Latin word of the line that is a Latin word of any of them, or its plain plural, either way, but for lone letters and small words ("a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"); a plain plural ends in "-s", or "-es" after s, x, z, ch or sh;
  - for a Chinese term, its pinyin without tones, written solid, with "u" or "v" for "ü", or one of its syllables of 3 letters or more: "jiyin" and "yin" for the Chinese word for "gene", but not "ji".

  The refusal on the screen names what the line gave away (`match`), as the term has it, so that the player sees what to avoid. The PI's line has no term to give away.
- **Not all but the same as a line already written in the game**, by anyone, in any round, tie lines included (`line_repeated`, `repeatsLine()`): counting only letters and digits, two lines are the same when they differ in at most one character in eight of the longer, rounded down, as an edit distance counts them: two lines of up to 7 only when they are equal, of 8 to 15 when they differ in one, of 16 to 23 in two. A line without a letter or a digit repeats nothing.

The screen checks the line as the server does, against the term, its forms, its translation and its pinyin, which the viewer's view carries with their term ([Who sees what](#who-sees-what)), and names what the line gave away; the server's check decides. A line that passes goes to everyone with the writer's number and the round (`lines`, with `tie` for a tie line), on the writer's card and in the record. A player whose time runs out has a line with no text (`text: null`, "Ran out of time"), which costs them 3 points ([Points](#points)).

## Voting

- After the last line of the round, everyone still in the game votes at once (`impostor:vote`, with the round): for the number of anyone else still in the game, or to abstain (`number: null`). A vote is cast once and stands (`voted_already`); one for oneself, for someone out or for a number nobody has is `bad_vote`.
- While the vote is on, everyone sees who has voted (`voted`), never for whom; the viewer sees their own (`myVote`). The votes are revealed together once all are in or the time to vote has run out. A vote not cast in time is kept as `timeout`, -1 in the views, and an abstention as null, 0 in the views.
- **The one with the most votes, alone, is out** (`voted_out`), and everyone learns their role, never their term. A vote that names nobody, everyone abstaining or out of time, puts nobody out, and the next round begins.
- **A tie** for the most votes: the tied players, in the order of their numbers, add a line each, under the same checks and the same time (`tie`), and then everyone else still in the game votes again, for one of the tied or to abstain (`revote`); the tied don't vote. The most votes alone put that player out. A revote that is tied again, or that names nobody, puts nobody out that round. When everyone still in the game is tied, nobody is left to vote again, and nobody goes out.
- Each vote, as it is revealed, is a toast for everyone: who is out and what they were, a tie, or nobody out. The record shows it as rows (`voteRows()` in `client/src/games/impostor/seats.ts`): a beige row for each number voted for, the most votes first and, among as many, the lower number first, with its avatar, the count and, after an arrow, the small avatars of those who voted for it, the row of the one voted out ending in "Out"; then a row of those who abstained, and one of those whose time ran out, which says that it cost them a point.

A vote for a Reviewer 2 or the PI brings the voter a point, and one that puts a student out costs one ([Points](#points)).

## Reports

A player still in the game may report another for breaking the rules, such as naming their term, from the other's panel ([The board](#the-board)).

- **Making one** (`impostor:report`): the number reported, one of their lines, by its index among the game's lines (`line`), or none, and a reason of up to 60 characters (`MAX_REASON_LENGTH`), which may not give the reporter's own term away any more than a line may (`checkReason()`: `line_empty`, `line_too_long`, `line_has_word`). In any phase but the comeback guess (`wrong_phase`); one report at a time (`report_open`) and one a round for each player (`reported_already`), a report that was dropped counting as the reporter's; never of oneself, of someone out, or with a line that isn't one of the reported player's (`bad_report`).
- **While it is judged**, a sheet opens for the whole room with who reported whom, the line and the reason (`JudgeSheet.vue`). The phase's clock stands still with the time it had left, the report has 20 seconds, and nobody describes or votes meanwhile (`report_open`).
- **Judging** (`impostor:judge`): everyone who was in the game when the report was made and still is, but the reported player, may judge it, the reporter and AI players too, so that not judging gives nobody away: `agree`, `disagree` or `abstain`, once (`judged_already`; `cannot_judge` for the reported player and whoever is out). The sheet offers agree and disagree, which lean neither way; closing it is not judging. Nobody sees a verdict until the report is over, only how many have judged (`judged` of `eligible`) and, for the viewer, their own (`mine`).
- **The outcome.** Once everyone who may judge it and is still in the game has, or its time is up, every verdict shows, those not given counted as abstentions. The report passes with more agreements than half of those who may judge it and are still in the game when it is settled (`needed()` on the screen: 3 of 4, 3 of 5); the verdict of one who has left counts no more. Passed, the reported player is out for breaking the rules (`violation`), everyone learns their role, and they lose 3 points. Rejected, the reporter loses a point. The same sheet shows the outcome, the verdicts as the record shows votes, the row that decided ending in "Upheld".
- **Then the game goes on**, unless it is over ([Winning](#winning)). In the describe phase, the clock goes on from where it stood, or, when the player who went out was the one describing, the next player describes, with a clock of their own. In the tie, the vote or the revote, after a report that passed, the round's vote begins again, from a first vote, without the player who went out; the votes cast are dropped, and a tie line already written this round stands: should that vote tie again, a tied player who added a line before the report adds none again, and only those who haven't yet do. After one that was rejected, the phase goes on with the time it had left.

Settled reports are in the record under their round. The site's own report of a player to the operators (`room:report`, [../architecture.md](../architecture.md#public-rooms)) is another thing, and changes nothing in the game.

## Coming back

In a room with the comeback guess on, a Reviewer 2 or the PI who is voted out, not one out for breaking the rules, has one guess at the students' term (`impostor:comeback`, with `word`, or `null` to make none), with 30 seconds whatever the room's time limits. Meanwhile the game waits in the `comeback` phase: nobody describes, votes or reports (`wrong_phase`), and the guesser doesn't yet see the off-field chat.

A guess is right when it is the students' term or its plain plural, one of its forms or its term in the other language, counting only letters and digits after folding as the line check does (`guessesWord()`). A right guess wins the game at once for the guesser's side (`comeback`): every Reviewer 2 for a Reviewer 2's guess, the PI for the PI's. A wrong guess, none, or none in time, and the game goes on as the vote left it, or ends ([Winning](#winning)): the guess comes before the win, so that the students who have voted out the last Reviewer 2 win only once the guess has failed. A right guess brings 2 points and a wrong one costs 1; making none costs nothing ([Points](#points)).

The views carry each guess with whether it was right (`guesses`), never the word, which the record of the game keeps; the decision letter names the guesser of a right one.

## Winning

After a player goes out, by a vote, a report or leaving the room, and after the comeback guess where there is one, the server looks at who is left in the game (`winnerOf()` in `rules.ts`):

1. **No Reviewer 2 left:** the PI wins if still in the game (`pi_survived`), and the students otherwise (`caught`). The students have to find the PI before the last Reviewer 2.
2. **Otherwise, few left:** with no more than 2 players left in a game that began with up to 6, or 3 in one that began with 7 or more (`survivors()`), the Reviewer 2s win (`survived`).

Besides, a right comeback guess wins for the guesser's side (`comeback`), and a Reviewer 2 still in the game who leaves the room ends it with no winner (`reviewer2_left`, [Leaving](#leaving)). The chair may **withdraw** a game (`room:end`), which ends it with no winner and no reason; a withdrawal names its game, so a late one can't end the next.

A side wins together: every student, every Reviewer 2 or the PI, those of the side who went out included, but not those who left the room. The decision letter says how the game ended ("Reviewer 2 caught", "The PI got away with it", "Reviewer 2 survived", "A comeback", "Reviewer 2 left", "Withdrawn"), who had which term and who won; a game that nobody won has a grey decision.

## Leaving

A player who leaves the room during the game (`room:leave`), or whom the chair removes (`room:remove`), is out of it (`left`), in the round they went; their role shows at the end. The chair has no other way to take a player out of a game: moving one to watch (`room:spectate`) changes nothing during a game. Going offline isn't leaving: the player's turns run out, and cost them points, as anyone's.

- **A Reviewer 2** still in the game who goes takes the game along: it ends at once with no winner (`reviewer2_left`), and every role shows. It counts for nobody's record and brings no rating, whether the Reviewer 2 left or was removed and however many were left, and it is kept in full, to be watched again ([Replays](#replays)).
- **Anyone else** is out, and the game goes on without them (`leave()` in `rules.ts`): if they were describing, the next player describes; their vote is dropped, and the vote is revealed if everyone else has voted; a report of them is dropped, and the clock goes on; a report still open is settled if everyone else who may judge it has; their comeback guess, if it was due, counts as none; votes for them count for nobody, so that they are neither voted out nor tied; and a tie, in its lines or its revote, that is down to one of its players ends the round with nobody out, while one with two or more left goes on among them. Their going may end the game, as when few enough are left for a Reviewer 2 to win; but while someone else's comeback guess is due, the game waits for it as before, since the guess comes before the win ([The comeback](#the-comeback)).
- Whoever left has no record of the game and doesn't win with their side.
- **A removal.** A game in which the chair removed a player, still in it or out, brings nobody points (`removed`, `GameModule.scoresNothing`), so that a chair can't win by removing others; it is kept in full, and its log marks the removal (`impostor:removed`). The panel says so before the chair removes anyone. The removed player stays out of the room as anyone removed does ([../architecture.md](../architecture.md#rooms)).

## Off-field

While the game is on, the off-field chat ("Sidelines") is for whoever doesn't play now: the players who are out, but a Reviewer 2 or a PI whose comeback guess is due, who joins once they have guessed; the spectators; and the setter (`offField()` in `view.ts`). Players still in the game never get it (`offField` is null in their view, and `cannot_talk` if they write), nor do screens. Everyone who may read it reads its latest 30 lines (`TALK_KEPT`), also what was said before they came or went out; the record of the game keeps every line.

- **A line** (`impostor:say`) is one line of up to 200 characters, cleaned as `shared/src/chat.ts` says (`chat_empty`, `chat_too_long`), that names no term that the writer knows ([Who sees what](#who-sees-what)), nor a form or a translation of one, whole (`checkTalk()` in `lines.ts`, `chat_has_word`): a Chinese one as its characters in a row, spaces ignored, a Latin one as its words in a row, alone or with "-s" or "-es". The server and the screen hold a line against the same terms (`knownWords()` in `view.ts`, which every view carries as `known`, each term with its forms, translation and pinyin): the writer's own for a player who is out, both for the setter and with the god view, none for the PI or a spectator without it. A term the writer doesn't know gives nothing away, and refusing it would tell them it was one; whoever reads the chat is out of the game or never in it. Each line has an ID, which goes up from 1 in the game, so that the page knows a new line from the last one kept.
- Whoever played is shown by their number, with how their game went, and their name where the reader may know it: in a game that isn't anonymous, with the god view, and once the game is over and revealed to them; whoever only watched or set the terms by name, as a spectator or the setter.
- **After the game** the same chat is everyone's: anyone in the room who has seen how the game ended, once they have guessed the AI players where there is a guess (`guess_first` before, [Guessing the AI](#guessing-the-ai)), reads and writes, without the check of the terms, which everyone knows by then. Those lines are marked as written after the game (`after`) and shown under a heading of their own, "After the game", until the chair plays again, which takes the room back to the waiting room, or the room closes.

The record of the game keeps every line as what the player said (`said`), and those of the talk after the game after its `end` ([../architecture.md](../architecture.md#game-records)); the replay has none of them.

## Quick reactions

Players still in the game send no quick reaction while it is on: a reaction could tell the others who someone is. Those who are out may, the spectators and the setter too, but not those out of an anonymous game, since a reaction shows its sender's name, which would tell the others whose number went out; once the game is over, everyone may. The server refuses with `emote_not_now` (`GameModule.mayEmote`), and the view's `mayEmote` says, for each viewer, whether they may, so that the reaction button is in the bar with the clock only then; in the waiting room it is in the masthead ([../architecture.md](../architecture.md#messages)).

## The board

The room is built as every game's is ([../rules/display.md](../rules/display.md#a-games-room)), and the board is the second game's own ([../rules/display.md](../rules/display.md#the-second-game)). On a phone, the strip, the bar with the clock, the board and what the viewer can do now come first, then the bar of buttons: "Record", how to play and, for whoever may read it, "Sidelines", each a sheet. From 64 rem, the record, the off-field chat and how to play stand in a column beside the board.

- **The strip** says who the viewer is ("You are #3", with what they were once they are out, "You set the terms", "You are watching") and what happens now: whose turn it is to describe, the vote, the revote among the tied, a comeback guess, or a report that holds the clock; the round on the right. Under it, the viewer's term on a yellow sticker that only they see; for the PI, that they have none; for the setter, both terms; for a spectator with the god view, both terms and whose they are. A game with AI players says how many, not at which numbers, and that it brings nobody points. On the viewer's move the tab's title says so too. The clock is red while the viewer has to act: describe, vote, guess the students' term or judge a report.
- **The seat cards**, one for each number, the same in every phase (`SeatCard.vue`): the number's avatar, which opens its panel; how the seat stands, as a tag ("Writing", "Said", "Waiting", "Voting", "Voted", "Out", "Left"); the name of whoever sits there, where the viewer may know it; and the line the number wrote this round, its tie line after a tie. A seat out of the game is grey and says how it went out. During a vote the cards that the viewer may vote for are the choices, the chosen one yellow, with a card of its own to abstain ("Abstain", "0 points"), the count of the votes cast and the button that casts the viewer's.
- **Under the board**, in the viewer's turn, the field for their line, with the count of characters and what is wrong with the line in red; when their comeback guess is due, the field for the guess and "Don't guess".
- **The record** ("Record", `RoundLog.vue`): a fold for each round, which says on its right whom the round voted out and what they were, or that it is still on, and holds the round's lines, a beige row each with the number's avatar, the viewer's own yellow and a tie line marked; its votes as rows ([Voting](#voting)); and its reports once judged. The newest round that has been voted on is open to begin with. The small avatars in it open nothing.
- **A number's panel** (`SeatPanel.vue`), a sheet over the game, which goes on meanwhile: titled with the number, and the name where the viewer may know it; under the big avatar, every line the number wrote, by round. For a player still in the game, "Report", while no report is being judged, no comeback guess is due and they haven't reported anyone this round, which leads to a sheet of its own for the line and the reason ([Reports](#reports)); for the chair, the way to remove whoever sits there from the room, which warns first ([Leaving](#leaving)).
- **The chair** has "End game" under the board, which asks first ([Winning](#winning)).
- **A screen** (`ImpostorScreen.vue`) shows how to join and who plays in the waiting room, then the strip, the seat cards and the record, and at the end the letter and who was who. In a [match](#matches), it shows the match's table as the room does, with where each player's points came from once the game is over and without the points of the game or who is offline or gone while an anonymous game is on, and the final ranking once the match is over. Its avatars open nothing.

## Who sees what

| Seat | Terms | Roles | Who is behind each number | Off-field | Can do |
|---|---|---|---|---|---|
| A player still in the game | Their own; none for the PI | Of those voted out or out for breaking the rules | Their own; everyone's in a game that isn't anonymous | Nothing | Describe, vote, report, judge |
| A player who is out | Their own | Their own, and as above | As above | Read and write, but while their comeback guess is due | Guess the students' term, where it is due |
| Spectator | None | As above | Everyone's in a game that isn't anonymous | Read and write | Watch |
| Spectator with the god view | Both, and whose | Every role | Everyone's, and which are AI players | Read and write | Watch |
| Setter | Both, not whose | As a spectator | As a spectator | Read and write | Watch |
| Screen | None | As a spectator | As a spectator | Nothing | Watch |
| After the game | Both | Every role | Everyone's, and which were AI players, once the viewer has guessed them where there is a guess | The talk after the game, for everyone in the room who has seen it all, but screens | Rate the pair, guess the AI players, talk |

Every avatar with a shadow opens something: a number's panel during the game, a player's panel in the waiting room ([../rules/display.md](../rules/display.md#avatars)).

`view.ts` is the only way game state leaves the server to players, by who the viewer is to the game right now (`watcherOf()`). Only the server knows the roles while the game is on: a seat's `role` is null but for a player voted out or out for breaking the rules, and for the viewer's own seat once they are out; the role of one who left shows at the end. A player's view carries their own term (`you.word`), with its forms, its terms in the other languages and its pinyin, so that the page holds a line against it as the server does and names what the line gave away ([Describing](#describing)), never the other; both terms are in the setter's view (`setterWords`, in an order that tells nothing), in a spectator's with the god view (`words`), and in everyone's once the game is over. No view carries anyone's vote before it is revealed but the viewer's own (`myVote`), a verdict before the report is over but the viewer's own (`report.mine`), or the word of a comeback guess (`guesses` has whether it was right). In an anonymous game, every seat but the viewer's has `playerId` null and every seat `agent` null until the end, and the off-field lines of players have their number and no player ID. The god view is for those who only watch: not for a player, out or not, the setter or a screen. The [AI players](#ai-players) are told what their seat sees.

## The end

Once the game is over, everyone sees the decision letter, one for everyone, its pill naming the viewer's role if they played ([Winning](#winning)); the chair gets "Play again" and the others a line that the chair decides. Under it:

- for a person who played in a game with an AI guess, the sheet that asks for it ([Guessing the AI](#guessing-the-ai));
- the streaks that the game brought;
- **who was who** (`RevealList.vue`): both terms, and a beige row for each number, the viewer's own yellow, with its avatar, which opens the number's panel, the name, the AI's mark, the role, how their game went ("Lasted to the end", "Voted out in round 2", "Out for breaking the rules", "Left the game") and the points it brought them ([Points](#points));
- for a player of a game that a side won, the question of how the pair was ("How was this pair of terms?", with the pair): "Good", "Too hard", "Too easy" or "Something's wrong", or dismissed with the ×; the ratings steer the draws of later games ([The words](#the-words), [../architecture.md](../architecture.md#ratings)), and "Say something" opens the feedback with the game attached;
- the record of the rounds, whose button is now "Review", and the talk after the game.

**The records.** A game that a side won counts for the record of everyone who played in it and didn't leave (`results()`, `resultsFrom()` in `results.ts`): the side is the role, the players of the winning side have won, in place 1, and the others lost, in place 2; the verdict is how their game went (`alive`, `voted_out`, `violation`), and the detail what they did (`ImpostorDetail` in `shared/src/games/impostor/score.ts`): the round they went out in, the rounds they began, their votes for someone and how many of those were for a Reviewer 2 or the PI (`hits`) or put a student out (`wrong`), their abstentions, the votes and lines whose time ran out, how often they were reported, the reports they made and how many failed, and their comeback guess. A game that nobody won, withdrawn or left by a Reviewer 2, counts for no record. An account's records page shows the game's own: the games and the share won; the share of the account's votes that went to a Reviewer 2 or the PI; the share won as a student, as a Reviewer 2 and as the PI; the rounds lasted on average; the times out for breaking the rules; and the pairs set and liked ([The setter](#the-setter)).

## Guessing the AI

After an anonymous game with AI players that finished, not withdrawn, in which at least 3 people played (`AGENT_GUESS_PEOPLE`, `agentGuessOpen()` in `rules.ts`), each person who played in it and is still in the room may guess which numbers the AI players had (`room:guessAgents`, with `guess`: at least one number and no more than there were AI players, each a number of the game, none twice and never the player's own, or `null` to skip; `bad_request` otherwise). Once each, and with no time limit (`cannot_guess` after it, for an AI player or whoever didn't play, and in a game without a guess). A game that showed everyone's name has nothing to guess.

The sheet opens as the game ends and says that a right guess brings a reward, to get the player to guess; the player may close it and come back to it from a line on the page. Each number but the player's own is a choice, with its avatar and its role. Once they have guessed or skipped, a toast owns up that there is no reward and names the AI players' numbers. Until then the viewer's view keeps from them who sat at which number, which numbers were AI players and the talk after the game (`revealed` is false), while the roles and the terms show. The game keeps the guesses (`agentGuesses`), and the server keeps them with the record of the game ([../architecture.md](../architecture.md#guessing-the-ai)). The replay of the game waits for the guess too: while the room shows the game, a person who still has to guess gets no replay of it (`GameModule.guessing`, `Room.guessing`), since the replay shows who everyone was ([Replays](#replays)).

## Points

The points of a game, as the maintainers set them for the beta (`WIN_POINTS` and `POINTS` in `shared/src/games/impostor/score.ts`, counted by `pointsOf()` from each player's detail):

| What happened | Points |
|---|---|
| The player's side wins: a student, a Reviewer 2, the PI | +3, +5, +6 |
| The side wins, and the player is still in the game at the end | +1 more |
| Each vote for a Reviewer 2 or the PI, in a vote or a revote, whatever came of it | +1 |
| A right comeback guess | +2 |
| Each vote for a student whom that vote put out | -1 |
| A student voted out | -1 |
| A Reviewer 2 or the PI out in the first round, voted out or for breaking the rules | -2 |
| Each vote whose time ran out | -1 |
| Each line whose time ran out | -3 |
| A wrong comeback guess | -1 |
| Out for breaking the rules | -3 |
| Each report of the player's that was rejected | -1 |

An abstention scores 0, and so does making no comeback guess. The rules count every player's votes alike, whatever their role. So the PI who wins still in the game, with one vote for a Reviewer 2, one vote that put a student out and one vote not cast in time, has 6 + 1 + 1 - 1 - 1 = 6. A player who left the room doesn't win with their side.

A game that nobody won counts for no points. A game with AI players brings nobody points ([../architecture.md](../architecture.md#ai-players)), nor does one in which the chair removed a player ([Leaving](#leaving)); both are kept in full all the same. There are no rising numbers during the game: the points show at the end, beside each number, from what the snapshot that ends the game carries (`ImpostorView.points`). A match adds up the points of its games ([Matches](#matches)); the game brings no titles yet ([Beta](#beta)).

## Matches

A room may be a match ([../architecture.md](../architecture.md#matches)) of 3, 5 or 7 games (`IMPOSTOR_MATCH_GAMES` in `shared/src/games/impostor/types.ts`), which the room setup offers as three choices, 3 by default. Everyone who plays a game of it is in the match (`GameModule.match` in `server/src/games/impostor/index.ts`), each game scores as any game does ([Points](#points)), and the players are ranked by their total. The settings are the whole match's: the chair may change them only until a game has counted.

- **Every game anew.** Each game deals the numbers and the roles anew, so in an anonymous game a number says nothing of who had it in the game before. The table lists the players in the order they came to the table (`MatchHooks.lineup`), never by their numbers, which would give them away in the first game. No pair of terms comes twice in a match (`matchPairs` in the room's data): two pairs are the same when they have the same two terms, in either order, counting only letters and digits and taking a plain plural as its singular (`samePair()` in `shared/src/games/impostor/lines.ts`). The room draws from the pairs the match hasn't had (`MatchHooks.fresh`), and can't start when none is left (`no_words`); a setter's pair that the match has had is refused (`words_played`). The pair of every game that started counts, also of one that didn't count.
- **No AI players**, as in any match ([../architecture.md](../architecture.md#ai-players)).
- **During a game**, the match's table, which a button in the bar opens, has each player's total and not their points in the game, which come only at its end and would tell who voted for a Reviewer 2 (`MatchHooks.live`). In an anonymous game it shows nobody as offline or gone, and ranks everyone who has played a game that counted, so that nobody can put a name to a number by whose time runs out.
- **Between games**, the table follows the result, with each player's points in the game and where they came from (`ImpostorScoreDetail` in `shared/src/games/impostor/score.ts`): their role, whether they won and lasted, how they went out, their hits and wrong votes, their comeback guess, and what ran out of time or was rejected. The roles of earlier games aren't listed.
- **A game that doesn't count.** A withdrawn game, one that a Reviewer 2 left and one in which the chair removed a player ([Leaving](#leaving)) bring nobody points: the match plays it again, and the table says why it didn't count. A Reviewer 2 who leaves and comes back finds their total as it was, so in a match leaving costs them nothing; the maintainers may change this once the beta has shown how often it happens. A game in which the chair removed a player stays on its players' records, with no points, as a game outside the match (`Room.matchGame()` names only the games the match scored); a withdrawn game and one that a Reviewer 2 left go on nobody's record, as ever.
- **The setter.** In a room with a [setter](#the-setter), the setter, who is the chair, sets the terms of every game anew and plays in none, so is neither in the match's table nor ranked. The match is bound to its setter (`MatchHooks.chairBound`): once its first game has started, when the chair passes to someone else, as after 3 minutes offline, when the setter leaves or when they hand the chair on, the match ends early, at once in the waiting room, or after the game in progress, which counts. The room tells the client while this is so (`MatchView.chairBound`), and the setter is asked first before handing the chair on or leaving the room. Nobody takes over as the setter. Before the first game, the new chair is the setter, and the match goes on.
- **Ending early.** The chair may end the match early, from the table in the waiting room or beside the game; it is ranked by the games that counted.
- **No titles in the beta.** A match ranks its players, and each account keeps its place and total on its record, but awards no title, neither the Best Paper Award nor Academic Trash, and the room says nothing of titles (`MatchHooks.titles`, `GameInfo.matchTitles`). They come once the game leaves its beta ([Beta](#beta)).

An account's records count the matches of the game that it finished, and how many of them it finished first, as the first game's do ([../architecture.md](../architecture.md#accounts)).

## Replays

**In the room**, once the game is over, the record's "Review" opens every round as the record shows it.

**The record of the game** ([../architecture.md](../architecture.md#game-records)) says how it began (`GameModule.setup`, `setupOf()` in `results.ts`): the settings, every player by player ID with their number, their role and whether an AI played the seat (`agent`), the two terms as the students and the Reviewer 2s had them, and where they came from (`source`: from the library, the field, the pair's key and the IDs of the students' term and of the Reviewer 2s'; from a setter, the setter's player ID, the field and `named`). Its log keeps every message of the game that changed it, as its schema reads it, without the game's ID and with what the player wrote cleaned as the game keeps it (`cleanLine()`): the lines, the votes, the reports, the verdicts and the comeback guesses; a line of the off-field chat as what the player said ([Off-field](#off-field)). Taking a place and setting the terms happen in the waiting room, which the log doesn't keep. It also keeps what the game made of the moves (`GameModule.logChanges`, `LOGGED` in `results.ts`):

- `impostor:votes`: each vote as it was revealed, with the round, `vote` or `revote`, every voter's choice by player ID (null for an abstention, `timeout` for a vote not cast in time), who went out and who was tied;
- `impostor:missed`: a line whose time ran out, with the player, the round and whether it was a tie line;
- `impostor:judged`: a report settled, with every verdict, those not given as abstentions, and whether it passed;
- `impostor:out`: a player who went out, how, in which round and with which role;
- `impostor:removed`: a player whom the chair removed, in which round, whether they were still in the game or not;
- `impostor:guessed`: a comeback guess, with the word, or none, and whether it was right;
- `impostor:over`: how the game ended, with the winner, the reason and the round.

The log says of each member whether they were at the table (`player`), set the terms (`setter`) or watched (`watcher`; `GameModule.seated`). The game waits for the player describing, for those who haven't voted or judged, and for the player guessing the students' term (`GameModule.due`), so a timer that ends a phase names those of them who were offline. A game's log may be larger than the first game's, since every player writes a line a round (`LOG_LIMITS`): 512 KB in all, crowded from 256 KB, 128 KB of what the players said, and 600 entries for each member. The rules are at version 1 (`RULES_VERSION`), which goes up with every change to the rules or the scoring, on which the server counts every kept game again from its log, by the same functions as at its end (`GameModule.recount`, `recountOf()` in `replay.ts`).

**Watching it again.** For a game that finished, whether a side won or a Reviewer 2 left, an account that played in it or set its terms may watch it again ([../architecture.md](../architecture.md#replays)): the server works the replay out from how the game began and its log (`shownReplay()` in `replay.ts`) and sends it as it is shown (`ImpostorReplay` in `shared/src/games/impostor/types.ts`): the settings, the two terms and where they came from, the kind and the field; every player by number, with their role, how their game went and whether an AI player; every line, vote, report and guess; the result; everyone's points; who everyone was, an account by its username, avatar and handle, a guest by their number in the room and an AI player by its persona; the player ID that the account watching had, if it played; and the setter's. `ReplayViewer.vue` plays it a step for each round, with the round's lines, votes and reports as the record shows them, and a last step with the result and who was who; the account's own number is yellow. The results page may add what was said after the game; the replay has none of the off-field chat. A game that was withdrawn has no replay.

## Beta

The game is in beta (`beta: true` in `client/src/games/info.ts`): its rules, points and pairs of terms will change as people play it, and a big update may clear its records so far, while accounts, friends and the records of the first game stay. The records of the two games are never added up: an account's records page shows one game at a time.

- A "Beta" pill beside the game's name on the home page opens a sheet that says what the beta means and where to send a word about it (`BetaPill.vue`); a line with the pill says so where a room is set up, in the practice sheet and under the game's tab of an account's records (`BetaNote.vue`). The rules sheet calls the points "Points (beta)".
- While in beta, the game brings no titles (`titles` is empty in `info.ts`): the pages show the titles, the streak titles and the friend duos of the first game alone (`TITLES_GAME` in `client/src/core/records.ts`). Its [matches](#matches) rank the players and award no titles either, until a later change ends the beta. It has no tutorial: its rules sheet is all there is.

## AI players

Where the chair may have them ([../architecture.md](../architecture.md#ai-players)), the chair invites Reviewer 1 to a place at the table from the chip under the players (`room:addAgent`, whose seat the game ignores), once a person has a place there (`needs_human`), as long as one of the 12 is free (`table_full`); while the AI players are offline, the chip is held back, and a tap says why (`agents_offline`). There is no limit of one for each role, since the roles are dealt as the game starts. The chair removes it from its panel, as in any room. A game with AI players needs both time limits on (`needs_timers`), so that the clock carries the game on when the agent is slow or gone, and a person playing (`needs_human`), and brings nobody points.

An AI player gets a number as anyone does, and nobody knows which until the end; the room's list of members names the AI players, so everyone knows how many there are, as the strip says. It describes its term no sooner than 2.5 seconds into its turn (`DESCRIBE_PACE_MS`), and votes, judges every report it may and, where the room allows it and it has been voted out, guesses the students' term, each no sooner than 2 seconds after it may (`VOTE_PACE_MS`). It never reports anyone, never talks off the field and never sets the terms (`agentTask()` and `agentMove()` in `agents.ts`). In this game no AI plays for a person who is offline.

It knows what its seat sees, no more: the room's language and the description's length, its own number and term, with the term's translation, forms and pinyin for the checks, or none as the PI; the round; every seat as everyone sees it, with the role of those voted out or out for breaking the rules; and the lines, votes and reports so far, from the newest round back, as many whole rounds as fit in a request (`HISTORY_BYTES` in `agents.ts`), which is every round of any ordinary game. A report it judges carries the line it points at, whatever round it is of. It reads no chat and is never told its role: a Reviewer 2 doesn't know that it is one. What it does goes through the same rules and checks as anyone's.

The agent (`agent/src/impostor.ts`, `impostorPrompts.ts`) asks the model for 3 lines at a time, up to 3 times, holds each against the same check as the server (`checkDescription()`), against the rounds it was told, so that in a game too long to be told whole it may write a line all but the same as one of an earlier round, which the server refuses, and the AI player's time runs out; and tells the model why the refused ones were refused; with none that will do, it answers `no_legal_move`, and the server asks again later ([../architecture.md](../architecture.md#ai-players)). A vote for a number it may not vote for is an abstention, a verdict that is none of the three is an abstention, and a guess of its own term is no guess. The model thinks at the game's reasoning level, the first game's unless set apart, for the first 3 lines of a turn, a vote, a verdict and a guess, until 6 seconds before the agent's wait ends, and is asked again without thinking past that ([../architecture.md](../architecture.md#the-agent)). The prompts are in English, the answers in the room's language, and every answer notes the version of the prompts, `impostor-2`. A player with a term writes first the other term closest to its own and, once there are lines to go by, which of the two the others' lines fit, and describes or votes by that; the judgment stays in the AI log ([../architecture.md](../architecture.md#the-agent)). The game may have a model of its own, set apart from the first game's ([../development.md](../development.md#environment-variables)). It is not a strong player yet, which the footnotes in the waiting room of a room that may have AI players say.

## Practice rooms

In a [practice room](../architecture.md#practice-rooms) for its creator alone, the only role is `player`: the creator takes a place at the table and Reviewer 1 the five others (`PRACTICE_AGENTS`), so that the game has six players, a Reviewer 2 and a PI, with the room's default settings, whose time limits are on as a game with AI players needs; the numbers are dealt at random, and the game starts once the creator is in the room. A game of one person has no AI guess. In one with friends, the creator sits in the waiting room as in any room, and invites Reviewer 1 to the places nobody takes ([AI players](#ai-players)).

## Messages

On top of the room messages ([../architecture.md](../architecture.md#messages)); schemas in `shared/src/games/impostor/schemas.ts`.

| Message | Payload | Who |
|---|---|---|
| `impostor:seat` | `play` (`true` to play the next game, `false` to watch) | Any member, in the waiting room or once the game is over; `table_full` |
| `impostor:words` | `a`, `b` (the two terms), `field` (a field of the word library, up to 64 characters), `named` | The setter, in the waiting room, with an account |
| `impostor:describe` | `gameId`, `round`, `text` | The player describing now |
| `impostor:vote` | `gameId`, `round`, `number` (1 to 12, or `null` to abstain) | Everyone still in the game, once a vote; in a revote, those who aren't tied |
| `impostor:report` | `gameId`, `round`, `number`, `line` (an index among the game's lines, or `null`), `reason` | A player still in the game, once a round, one report at a time |
| `impostor:judge` | `gameId`, `verdict` (`agree`, `disagree`, `abstain`) | Those still in the game who may judge the open report, once |
| `impostor:comeback` | `gameId`, `word` (or `null` for no guess) | The Reviewer 2 or the PI just voted out, in the comeback phase |
| `impostor:say` | `gameId`, `text` | While the game is on, whoever is out, but a player whose comeback guess is due, watches or set the terms; after it, anyone in the room |

The room messages that the game takes besides: `room:remove` with `seat`, `{ gameId, number }`, for the chair to remove the player at a number ([Numbers](#numbers)); `room:addAgent` with `persona` `reviewer1` and any `seat`; `room:rate` and `room:guessAgents` after a game ([The end](#the-end), [Guessing the AI](#guessing-the-ai)). The settings travel in `room:create` and `room:settings` as `describeTime`, `voteTime`, `length`, `pi`, `comeback`, `anonymous`, `godView` and `setter` (`IMPOSTOR_SETTINGS`).

## Order of the checks

A payload that its schema refuses is `bad_request`. Before a game action, the server does what is due by then ([Rounds](#rounds)). Then:

1. `stale`: no game, as in the waiting room, or another game; for a message that names a round, another round.
2. `game_over`, for everything but a line of chat, which after the end is the talk about the game.
3. Each action's own, in order:
   - describing: `report_open`; `wrong_phase` outside the describe and tie phases; `not_playing` for whoever isn't in the game; `not_speaker`; then the line, `line_empty`, `line_too_long`, `line_has_word`, `line_repeated`;
   - voting: `report_open`; `wrong_phase` outside a vote; `not_playing` for whoever has no vote in it, as a player out or tied in a revote; `voted_already`; `bad_vote`;
   - reporting: `wrong_phase` during the comeback guess; `report_open`; `not_playing`; `reported_already`; `bad_report`; then the reason, `line_empty`, `line_too_long`, `line_has_word`;
   - judging: `wrong_phase` with no report open; `cannot_judge`; `judged_already`;
   - guessing the students' term: `no_comeback` for anyone but the player whose guess is due;
   - talking: `cannot_talk` for a player still in the game, and after it `guess_first` for a player who has yet to guess the AI players; then the line, `chat_empty`, `chat_too_long`, `chat_has_word`.

The actions of the waiting room name no game: taking a place is `wrong_phase` during a game, then `table_full`; setting the terms is `wrong_phase` during a game, then `not_setter`, `account_required`, `bad_field`, and `words_missing`, `words_too_long`, `words_same`, `words_played`.

The game's own codes are `IMPOSTOR_ERRORS` in `shared/src/games/impostor/types.ts`. What a player writes is checked last, so nothing that a player can't see changes the answer. Two votes at once are handled one at a time, and the last one that was missing reveals the vote; a vote that comes after the votes were revealed is `stale` in a round that has moved on, or `wrong_phase` in a tie.

import type { Language } from '@reviewer2/shared';
import {
  FITS,
  POINTS,
  roleCounts,
  WIN_POINTS,
  type ImpostorAgentGame,
  type ImpostorRole,
} from '@reviewer2/shared/impostor';
import type { Persona } from './personas';

// What the agent tells the model and asks it, for the hidden word game (docs/games/impostor.md).
// As for the first game, the prompts are in English, the language the models follow best, and the
// model answers in the language of the room. The model is told what everyone at the table knows,
// its own number and its own word, and nothing else: a Reviewer 2 is never told that it is one. So
// a model with a word is taught one way to play, which holds whichever word it has: hold the word
// against the others' lines, and play as the odd one when most of them fit another word better.

// The version of the prompts, which every answer notes (AgentNote), so that the record of a game
// says which prompts played it. Change it with any change to what the model is told.
export const PROMPT_VERSION = 'impostor-2';

const LANGUAGE_NAMES: Record<Language, string> = { zh: 'Chinese', en: 'English' };

const ROLE_NAMES: Record<ImpostorRole, string> = { student: 'a student', reviewer2: 'a Reviewer 2', pi: 'the PI' };

// The rules, as every question tells them.
function rules(game: ImpostorAgentGame): string {
  const players = game.seats.length;
  return [
    `You are playing a hidden word party game for academics, as player ${game.number} of ${players}, each known ` +
      'only by a number.',
    'Most players, the students, were all given the same word. One or two others, the Reviewer 2s, were given a ' +
      'different but related word, and nobody told them that theirs is the odd one. In a larger game one more ' +
      'player, the PI, was given no word at all. Nobody is told who is who.',
    'Each round, everyone still in the game describes their word in turn in one short line, and then everyone ' +
      'votes for a player they think is not a student. The player with the most votes is out, and their role is ' +
      'shown, but not their word.',
    'The students win once every Reviewer 2 and the PI are out. The PI wins if every Reviewer 2 is out while the ' +
      'PI is still in. The Reviewer 2s win if one of them lasts until only a few players are left.',
  ].join(' ');
}

// What the model knows of its own word. It doesn't know whether its word is the students' one, and
// is told to name the word closest to its own and hold the others' lines against both, rather
// than take it that they share its word, as a Reviewer 2 otherwise does.
function yourWord(game: ImpostorAgentGame): string {
  if (game.word === null) {
    return (
      "You are the PI: you have no word. Work out the students' word from what the others say, and describe " +
      'it so that you blend in with them.'
    );
  }
  return (
    `Your word: ${game.word.word}. Nobody is told whether their word is the students' one or the odd one, and ` +
    'that goes for you too: you may be a Reviewer 2 without knowing it. So never take it that the others share ' +
    'your word: name the other word closest to yours first, the one most likely paired with it, and hold their ' +
    'lines against both. When they clearly fit that word better than yours, yours is probably the odd one, and ' +
    'you are probably a Reviewer 2.'
  );
}

// The table as everyone sees it: who is in, and the role of each player who is out.
function table(game: ImpostorAgentGame): string {
  const seats = game.seats.map(({ number, fate, role }) => {
    const you = number === game.number ? ' (you)' : '';
    if (fate === 'alive') return `- Player ${number}${you}: in the game`;
    const how = fate === 'voted_out' ? 'voted out' : fate === 'violation' ? 'out for breaking the rules' : 'left';
    return `- Player ${number}${you}: ${how}${role === null ? '' : `, was ${ROLE_NAMES[role]}`}`;
  });
  return `Players:\n${seats.join('\n')}`;
}

// Everything said and done so far, round by round: the lines, the votes and the reports.
function history(game: ImpostorAgentGame): string {
  const rounds: string[] = [];
  for (let round = 1; round <= game.round; round += 1) {
    const parts = [`Round ${round}:`];
    for (const { number, text, tie } of game.lines.filter((line) => line.round === round)) {
      const said = text === null ? '(said nothing in time)' : `"${text}"`;
      parts.push(`  Player ${number}${tie ? ' (tied, one more line)' : ''}: ${said}`);
    }
    for (const { ballot, votes, out } of game.ballots.filter((one) => one.round === round)) {
      const cast = Object.entries(votes).map(([voter, target]) => {
        if (target === 0) return `${voter} abstained`;
        if (target === -1) return `${voter} ran out of time`;
        return `${voter} voted for ${target}`;
      });
      const name = ballot === 'revote' ? 'Revote' : 'Vote';
      parts.push(`  ${name}: ${cast.join(', ')}; ${out === null ? 'nobody went out' : `player ${out} went out`}.`);
    }
    for (const { by, target, reason, passed } of game.reports.filter((report) => report.round === round)) {
      const outcome = passed === null ? 'being judged now' : passed ? 'it passed' : 'it failed';
      parts.push(`  Player ${by} reported player ${target}: "${reason}" (${outcome}).`);
    }
    if (parts.length > 1) rounds.push(parts.join('\n'));
  }
  return rounds.length === 0 ? 'Nothing has been said yet.' : rounds.join('\n');
}

const state = (game: ImpostorAgentGame) => [table(game), history(game)].join('\n\n');

// Whether there are lines enough to judge which word they fit: after the first round there are;
// in it, a line that breaks a tie comes after everyone's, and any other line has too few before
// it, perhaps a Reviewer 2's, to go by.
const linesToGoBy = (game: ImpostorAgentGame, tie: boolean): boolean => tie || game.round > 1;

// The judgment that a player with a word writes before its lines or its vote (describeSchema,
// voteSchema): `closest`, the other word closest to its own, a specific word rather than a
// category, which its first-round line goes by, and, once there are lines to go by, `fit` too,
// which of the two the others' lines fit, its own, the closest, or unclear. The model writes the
// fields in the order of the schema, so the judgment is made before it answers by it; with its
// reasoning off, it otherwise doesn't stop to, and takes its word for everyone's. The PI, who has
// no word, judges nothing.
export function judges(game: ImpostorAgentGame, linesToGoBy: boolean): 'none' | 'closest' | 'fit' {
  if (game.word === null) return 'none';
  return linesToGoBy ? 'fit' : 'closest';
}

// What makes a good line. The PI, who has no word, is told what it always was. A player with a word
// says, in the first round, where there is little to hold its word against, only what its word and
// the closest one share, a field or a property, never what tells them apart; after that, it
// describes by `fit`: the closest word, vaguely, as those who have it would, which is how a player
// with the odd word plays, what both words have when that is unclear, and its own as usual.
function goodLine(game: ImpostorAgentGame, tie: boolean): string {
  const fitIn = 'Fit in with what the others said, without repeating it.';
  const good =
    'good line is true of your word but vague: specific enough that the players who share your word recognize ' +
    "it, and vague enough that a player with the other word can't work yours out.";
  if (game.word === null) return `A ${good} ${fitIn}`;
  if (!linesToGoBy(game, tie)) {
    return [
      'This is the first round, so there is little to hold your word against yet, if anything: stay broad. Say ' +
        'only the field or the kind that your word and closest both belong to, or one property that both have, ' +
        'never a use, a mechanism or any feature that tells one from the other, so that your line fits whichever ' +
        'of the two the others have.',
      fitIn,
    ].join(' ');
  }
  return [
    'Describe by fit. If it is closest, take closest for your word and describe it, vaguely, as the players who ' +
      'have it would, and never anything that only your own word has: that is how a player with the odd word ' +
      'plays. If it is unclear, say only what both words have.',
    `If it is mine, a ${good}`,
    fitIn,
  ].join(' ');
}

// Whom to vote for. The PI is told what it always was. A player with a word votes by `fit`: when
// the lines fit its own word, for the player whose lines fit it least; when they fit the closest
// word, it is probably a Reviewer 2, whose side wins only while one of them lasts, so it votes
// neither for the students, which would give it away, nor, in a game with two Reviewer 2s while
// both are in, for the other one, whose lines lean toward its word as its own do; and when that is
// unclear, for the player whose lines fit the others' least. The points are those of the rules
// (docs/games/impostor.md#points), told with a win's, which outweighs any one vote.
function howToVote(game: ImpostorAgentGame): string {
  if (game.word === null) {
    return (
      'It is time to vote. Vote for the player whose lines fit the word that most players seem to have the ' +
      'least: that player probably has another word, or none. Voting out a student costs you a point; abstaining ' +
      'costs nothing, but helps nobody.'
    );
  }
  const reviewer2sIn =
    roleCounts(game.seats.length, false).reviewer2 - game.seats.filter(({ role }) => role === 'reviewer2').length;
  const partner =
    reviewer2sIn > 1
      ? ' A player whose lines lean toward your word, as yours do, is probably the other Reviewer 2, on your ' +
        'side: never vote for them either.'
      : '';
  return [
    'It is time to vote. First name closest, and judge fit from the lines alone: it may not be mine.',
    'If fit is mine, vote for the player whose lines fit your word the least: that player probably has another ' +
      'word, or none.',
    'If fit is closest, you are probably a Reviewer 2, and your side wins only while one of you is still in the ' +
      'game. The players whose lines fit closest are probably students: never vote for one of them, which would ' +
      `give you away.${partner} Vote for a player whose lines fit neither word, who is probably the PI, or abstain.`,
    "If fit is unclear, vote for the player whose lines fit the others' lines the least, or abstain.",
    `The points: a vote for a Reviewer 2 or the PI is worth +${POINTS.hit}, whatever comes of it; a vote that ` +
      `puts a student out, ${POINTS.wrong}; abstaining, 0. Your side winning is worth +${WIN_POINTS.student} to a ` +
      `student, +${WIN_POINTS.reviewer2} to a Reviewer 2 and +${WIN_POINTS.pi} to the PI, and +${POINTS.lasted} ` +
      'more when you are still in the game then, so keeping your side in the game outweighs any one vote. ' +
      'Choose the vote that these points favor most.',
  ].join(' ');
}

// The names of the players and the roles as the game shows them in a Chinese room
// (client/src/locales/zh.json, games.impostor), as escapes, so that the source stays in English: a
// number followed by the character for one, then the student, the Reviewer 2 and the PI.
const CHINESE_NAMES = {
  player: '3 \u53f7',
  student: '\u5b66\u751f',
  reviewer2: '\u4e8c\u53f7\u5ba1\u7a3f\u4eba',
  pi: '\u5bfc\u5e08',
};

// The one sentence of a reason, all in the language of the room. Told the game in English, the
// model otherwise writes the players and the roles in English in a Chinese room ("Player 5"), or
// translates them its own way, so it is told the names the game shows.
function reason(game: ImpostorAgentGame, persona: Persona): string {
  const language = LANGUAGE_NAMES[game.language];
  const { player, student, reviewer2, pi } = CHINESE_NAMES;
  const names =
    game.language === 'zh'
      ? `: write a player by number as "${player}", and the roles as ${student}, ${reviewer2} and ${pi}, never ` +
        'as "Player 3", "PI" or "Reviewer 2"'
      : '';
  return (
    `Give your reason in one short sentence in ${language}, ${persona.tone}. Write all of it in ${language}, ` +
    `with no words of another language${names}.`
  );
}

// What the answer carries, in the order the model writes it: the judgment a player with a word
// makes first (judges), and the rest by it.
function answerIn(game: ImpostorAgentGame, rest: string, linesToGoBy: boolean): string {
  const judged = judges(game, linesToGoBy);
  if (judged === 'none') return `Answer in JSON: ${rest}.`;
  const closest =
    'Answer in JSON: closest, the other word closest to yours, the one most likely paired with it in this game: a ' +
    'specific word or term, never a category or a summary';
  if (judged === 'closest') return `${closest}; then ${rest}.`;
  return (
    `${closest}; fit, which of the two the others' lines fit better: mine, closest or unclear, closest only when ` +
    `they clearly fit it better than yours, and unclear when you can't tell; then ${rest}, by what you found.`
  );
}

export function describeSystem(game: ImpostorAgentGame, persona: Persona, tie: boolean): string {
  const language = LANGUAGE_NAMES[game.language];
  const unit = game.language === 'zh' ? 'Chinese characters' : 'characters';
  return [
    rules(game),
    yourWord(game),
    tie
      ? 'You are tied with others for the most votes: describe your word once more, so that the others believe ' +
        'that you are a student.'
      : 'It is your turn to describe your word.',
    goodLine(game, tie),
    `Write in ${language}, at most ${game.length} ${unit} a line, ${persona.tone}. Never use your word or any ` +
      'part of it, a character of it, its plural, its translation or its pinyin, and never repeat a line that was ' +
      'said before, or nearly so.',
    answerIn(game, 'candidates, 3 different lines, the best first', linesToGoBy(game, tie)),
  ].join('\n');
}

// The lines that the rules refused, and why, as the model is told when it is asked again.
export interface RefusedLine {
  text: string;
  why: string;
}

export function describeUser(game: ImpostorAgentGame, refused: readonly RefusedLine[] = []): string {
  const parts = [state(game)];
  if (refused.length > 0) {
    const lines = refused.map(({ text, why }) => `- "${text}": ${why}`);
    parts.push(`The rules refused these lines, so write three new ones:\n${lines.join('\n')}`);
  }
  return parts.join('\n\n');
}

export function voteSystem(game: ImpostorAgentGame, persona: Persona, candidates: readonly number[]): string {
  return [
    rules(game),
    yourWord(game),
    howToVote(game),
    `You may vote for one of the players ${candidates.join(', ')}, or answer 0 to abstain.`,
    reason(game, persona),
    answerIn(game, 'number and reason', true),
  ].join('\n');
}

export const voteUser = state;

export function judgeSystem(
  game: ImpostorAgentGame,
  persona: Persona,
  report: { by: number; target: number; text: string | null; reason: string },
): string {
  return [
    rules(game),
    yourWord(game),
    `Player ${report.by} has reported player ${report.target} for breaking the rules, saying: "${report.reason}".` +
      (report.text === null ? '' : ` The report is about this line of theirs: "${report.text}".`),
    "The rules: a line describes the player's own word, and must not give the word away, nor say who has which " +
      'word. A report that passes puts the player out; one that fails costs the reporter a point. Agree only ' +
      "when the rules were clearly broken; disagree when they were not; abstain when you can't tell.",
    reason(game, persona),
    'Answer in JSON: verdict (agree, disagree or abstain) and reason.',
  ].join('\n');
}

export const judgeUser = state;

export function comebackSystem(game: ImpostorAgentGame): string {
  const own = game.seats.find((seat) => seat.number === game.number)?.role ?? null;
  const known =
    game.word === null
      ? 'You were the PI, with no word.'
      : `You were ${own === null ? 'not a student' : ROLE_NAMES[own]}: your word, ${game.word.word}, was not the ` +
        "students' word, which is a different word related to it.";
  return [
    rules(game),
    `You were voted out. ${known}`,
    "You may now guess the students' word once: if you are right, your side wins at once; if you are wrong, it " +
      'costs you a point. Work it out from what the students said.',
    `Answer in JSON: word, the students' word in ${LANGUAGE_NAMES[game.language]}, or an empty string to make ` +
      'no guess.',
  ].join('\n');
}

export const comebackUser = state;

// The shapes of the answers, as JSON schemas that the model writes to (model.ts), with the fields
// in the order it writes them: the judgment a player with a word makes first (judges), then its
// lines or its vote.
const CLOSEST = { closest: { type: 'string' } };
const FIT = { fit: { type: 'string', enum: FITS } };

function shape(game: ImpostorAgentGame, linesToGoBy: boolean, properties: Record<string, object>): object {
  const judged = judges(game, linesToGoBy);
  const all = { ...(judged === 'none' ? {} : CLOSEST), ...(judged === 'fit' ? FIT : {}), ...properties };
  return { type: 'object', properties: all, required: Object.keys(all), additionalProperties: false };
}

export const describeSchema = (game: ImpostorAgentGame, tie: boolean): object =>
  shape(game, linesToGoBy(game, tie), { candidates: { type: 'array', items: { type: 'string' } } });

export const voteSchema = (game: ImpostorAgentGame): object =>
  shape(game, true, { number: { type: 'integer' }, reason: { type: 'string' } });

export const JUDGE_SCHEMA = {
  type: 'object',
  properties: { verdict: { type: 'string', enum: ['agree', 'disagree', 'abstain'] }, reason: { type: 'string' } },
  required: ['verdict', 'reason'],
  additionalProperties: false,
};

export const COMEBACK_SCHEMA = {
  type: 'object',
  properties: { word: { type: 'string' } },
  required: ['word'],
  additionalProperties: false,
};

import type { Language } from '@reviewer2/shared';
import type { ImpostorAgentGame, ImpostorRole } from '@reviewer2/shared/impostor';
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
// is told to work that out from the others' lines rather than take it that they share its word, as
// a Reviewer 2 otherwise does.
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
    'your word: hold it against their lines first. If most of them fit a different, related word better than ' +
    'yours, yours is probably the odd one, and you are probably a Reviewer 2.'
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

// What makes a good line. The PI, who has no word, is told what it always was. A player with a word
// says, in the first round, where there is little to hold its word against, only what its word
// shares with the words closest to it; after that, it leans toward the word that most players seem
// to have when that is not its own.
function goodLine(game: ImpostorAgentGame, tie: boolean): string {
  const fitIn = 'Fit in with what the others said, without repeating it.';
  const good =
    'good line is true of your word but vague: specific enough that the players who share your word recognize ' +
    "it, and vague enough that a player with the other word can't work yours out.";
  if (game.word === null) return `A ${good} ${fitIn}`;
  if (game.round === 1 && !tie) {
    return [
      'This is the first round, so there is little to hold your word against yet, if anything: stay broad. Say ' +
        'only what your word shares with the words closest to it, never a detail that tells it apart from them, so ' +
        'that your line fits whichever of two close words the others have.',
      'If most of the lines so far already fit another word better than yours, lean toward that word.',
      fitIn,
    ].join(' ');
  }
  return [
    'If most of the lines fit another word better than yours, yours is probably the odd one: say only what your ' +
      'word shares with that word, leaning toward it, as vaguely as you can, and never anything that only your ' +
      'word has.',
    `If they fit your word, a ${good}`,
    fitIn,
  ].join(' ');
}

// Whom to vote for. The PI is told what it always was. A player with a word first works out the
// word that most players seem to have; when that is not its own, it is probably a Reviewer 2, and
// votes as a student would rather than for the students. The points of a vote are those of the
// rules (docs/games/impostor.md#points).
function howToVote(game: ImpostorAgentGame): string {
  if (game.word === null) {
    return (
      'It is time to vote. Vote for the player whose lines fit the word that most players seem to have the ' +
      'least: that player probably has another word, or none. Voting out a student costs you a point; abstaining ' +
      'costs nothing, but helps nobody.'
    );
  }
  return [
    'It is time to vote. First work out from the lines alone the word that most players seem to have: it may ' +
      'not be yours.',
    'If it is yours, vote for the player whose lines fit it the least: that player probably has another word, or ' +
      'none.',
    'If it is not, you are probably a Reviewer 2, and the players whose lines fit it are probably students: never ' +
      'vote for one of them, which would give you away. Vote, as a student would, for the player whose lines fit ' +
      'that word the least, or abstain.',
    'A vote for a Reviewer 2 or the PI brings you a point, whatever comes of it; a vote that puts a student out ' +
      'costs you one; abstaining costs nothing, but helps nobody. Choose the vote that these points favor most.',
  ].join(' ');
}

// The one sentence of a reason, all in the language of the room. Told the game in English, the
// model otherwise writes the players and the roles in English in a Chinese room ("Player 5").
function reason(game: ImpostorAgentGame, persona: Persona): string {
  const language = LANGUAGE_NAMES[game.language];
  const names =
    game.language === 'zh'
      ? ': name the players and the roles in Chinese too, never as "Player 3", "PI" or "Reviewer 2"'
      : '';
  return (
    `Give your reason in one short sentence in ${language}, ${persona.tone}. Write all of it in ${language}, ` +
    `with no words of another language${names}.`
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
    'Answer in JSON: candidates, 3 different lines, the best first.',
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
    'Answer in JSON: number and reason.',
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

// The shapes of the answers, as JSON schemas that the model writes to (model.ts).
export const DESCRIBE_SCHEMA = {
  type: 'object',
  properties: { candidates: { type: 'array', items: { type: 'string' } } },
  required: ['candidates'],
  additionalProperties: false,
};

export const VOTE_SCHEMA = {
  type: 'object',
  properties: { number: { type: 'integer' }, reason: { type: 'string' } },
  required: ['number', 'reason'],
  additionalProperties: false,
};

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

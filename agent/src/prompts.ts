import type { AgentGame, CardColor, CardView, ClueCount, Language, Team } from '@reviewer2/shared';
import type { Persona } from './personas';

// What the agent tells the model and asks it, for the team word guessing game
// (docs/games/keywords.md). The prompts are in English, the language the models follow best; the
// model answers in the language of the board. The game is described in its own terms: a group's
// PI gives the clues and its students reveal the cards.

// The version of the prompts, which every answer notes (AgentNote), so that the record of a game
// says which prompts played it. Change it with any change to what the model is told.
export const PROMPT_VERSION = 'keywords-4';

const LANGUAGE_NAMES: Record<Language, string> = { zh: 'Chinese', en: 'English' };

// The most Chinese characters that one candidate is asked to use (clueRules()): the room's length,
// up to four, beyond which a clue reads as a sentence.
const FULL_LENGTH = 4;

// Whose a card is, as the group sees it. The model is told "ours" and "theirs" rather than red and
// blue, so that the agent plays the blue group as well as the red one.
function whose(color: CardColor, team: Team): string {
  if (color === team) return 'OURS';
  if (color === 'neutral') return 'NEUTRAL';
  if (color === 'reviewer2') return 'REVIEWER 2';
  return 'THEIRS';
}

// The board, one card a line with its number: as a PI sees it, every card with whose it is, and as
// a student sees it, only the revealed cards.
function board(cards: readonly CardView[], team: Team): string {
  return cards
    .map(({ word, color, revealed }, index) => {
      const owner = color === undefined ? '' : ` [${whose(color, team)}]`;
      return `${index}. ${word}${owner}${revealed ? ' (revealed)' : ''}`;
    })
    .join('\n');
}

function earlierClues(game: AgentGame): string {
  if (game.clues.length === 0) return 'No clues have been given yet.';
  const lines = game.clues.map(
    ({ team, word, count }) => `- ${word}, ${count}, to ${team === game.team ? 'our group' : 'the other group'}`,
  );
  return `Clues given so far:\n${lines.join('\n')}`;
}

// What a clue may be in the room (clueOptions() in shared/src/games/keywords/settings.ts), as the
// strict clue rule has it, which the agent keeps to even where the room's rule is loose.
//
// How a clue is written is a means to the aim that clueSystem() sets, the most of the group's cards
// that its students can work out, and the model is told so. In a Chinese room, a clue may be a
// single character, a few characters that need not form a word, a word, or a word with a character
// or two beside it. Told only that it may, a model nearly always writes a common word of two
// characters, and told that a single character is often best, it gives one nearly every time; so
// its three candidates are written in three ways, one of them as long as the room allows, up to
// FULL_LENGTH. Told that each character points at a card, it takes the characters from the cards'
// own words, which the rules refuse, so it is told that none of them comes from the board. The
// agent gives the first candidate that the rules take (keywords.ts), so the best must come first.
function clueRules(game: AgentGame): string {
  const { clueLength } = game.settings;
  if (game.language === 'zh') {
    const offBoard =
      'It must not be a word on the board, contain one or share any Chinese character with one, and it must not ' +
      'be the English term or the pinyin of a word on the board.';
    if (clueLength === 1) {
      return [
        'Clue rules: write the clue in Chinese, as a single Chinese character (two Latin letters or digits count as ' +
          'one character). Through its different meanings and the different words it forms, one character can tie ' +
          'several related cards together.',
        offBoard,
        'Put the best candidate first.',
      ].join(' ');
    }
    const wordAndCharacters = clueLength >= 3 ? '; or a word with a single character or two beside it' : '';
    const full = Math.min(clueLength, FULL_LENGTH);
    return [
      `Clue rules: write the clue in Chinese, at most ${clueLength} Chinese characters (two Latin letters or digits ` +
        'count as one character).',
      offBoard,
      'How the clue is written is up to you, as a means to the aim: a single character; a few single characters ' +
        'that need not form a word, written together with no spaces, none of them taken from the board, each tying ' +
        `cards together through its own meanings; a word or a phrase${wordAndCharacters}. Write it in whichever ` +
        'way lets your students link the most of OUR cards without going wrong.',
      `Write the three candidates in three different ways, and make one of them ${full} characters long. Rank ` +
        'them by the aim and put the best first.',
    ].join(' ');
  }
  const words =
    clueLength === 1
      ? 'exactly one English word'
      : `at most ${clueLength} English words, in whichever way lets your students link the most of OUR cards ` +
        'without going wrong';
  return (
    `Clue rules: the clue is ${words}. It must not be a word on the board, a plural or a part of one, or the ` +
    'Chinese term of one.'
  );
}

export function clueSystem(game: AgentGame, persona: Persona): string {
  const { min, preferred, max } = persona.targets;
  return [
    'You are playing a team word-guessing game for academics, as the PI (the clue giver) of your group. The board ' +
      'has 25 cards, each an academic term, numbered 0 to 24. You can see whose each card is: OURS are your ' +
      "group's, THEIRS are the other group's, NEUTRAL are irrelevant papers, and REVIEWER 2 loses the game at once " +
      'if your group reveals it.',
    "Your students can't see whose the cards are. The aim: give one clue and a number so that they reveal as many " +
      'of OUR cards as they can and stay away from REVIEWER 2 and THEIR cards. Count only the cards that they can ' +
      'surely work out from the clue: never stretch a clue to more cards than they can follow. Revealed cards are ' +
      'out of play.',
    clueRules(game),
    'The clue is a new word that is not on the board and links the cards you aim at. It must not mention whose ' +
      'the cards are, numbers, positions or letters, and it must not be a clue that was given before in this game.',
    `First choose ${min} to ${max} of OUR unrevealed cards that are close in meaning, ${preferred} if you can, as ` +
      'your targets; then think of the clue. Make sure that no NEUTRAL card, none of THEIRS and above all not ' +
      'REVIEWER 2 is close to it.',
    'Answer in JSON: candidates, 3 of them, each with targets (card numbers), clue and count (how many targets).',
  ].join('\n');
}

export function clueUser(game: AgentGame, refused: readonly { word: string; why: string }[] = []): string {
  const parts = [`Board:\n${board(game.cards, game.team)}`, earlierClues(game)];
  if (refused.length > 0) {
    const lines = refused.map(({ word, why }) => `- ${word}: ${why}`);
    parts.push(`The rules refused these clues, so give three new ones:\n${lines.join('\n')}`);
    // What a model most often gets wrong in a Chinese room: spaces between the characters, and a
    // character that a word on the board has.
    if (game.language === 'zh') {
      parts.push(
        'Write each clue with no spaces, and check every character of it: none may appear in any word on the board.',
      );
    }
  }
  return parts.join('\n\n');
}

export function guessSystem(game: AgentGame, persona: Persona, limit: number): string {
  return [
    'You are playing a team word-guessing game for academics, as a student (a guesser) of your group. The board ' +
      "has 25 cards, each an academic term, numbered 0 to 24. You can't see whose the cards are, except for the " +
      "revealed ones. Your PI gave a clue and a number: how many of your group's cards the clue links, " +
      'unlimited, or 0 when it links none and warns you off the cards it brings to mind.',
    `List the numbers of the cards you would reveal, the surest first, at most ${limit}. Always list at least one ` +
      `card. After the first, list only cards that you are ${persona.caution} of: a card of the other group ends ` +
      'your turn, and REVIEWER 2 loses the game at once. Never list a revealed card.',
    `Give your reason in one short sentence in ${LANGUAGE_NAMES[game.language]}, ${persona.tone}.`,
    'Answer in JSON: picks (card numbers) and reason.',
  ].join('\n');
}

// The clue with its number, and what the number means: a count of the group's cards, no limit, or
// none at all, when the clue is a warning and the earlier clues are what to go by.
function clueLine({ word, count }: { word: string; count: ClueCount }): string {
  if (count === 'unlimited') {
    return `Clue: ${word}, unlimited: the clue links any number of our group's cards, and the earlier clues may link more.`;
  }
  if (count === 0) {
    return (
      `Clue: ${word}, 0: the clue links none of our group's cards and warns us off the cards it brings to mind. ` +
      'Go by the earlier clues instead.'
    );
  }
  return `Clue: ${word}, ${count}: the clue links ${count} of our group's cards.`;
}

export function guessUser(game: AgentGame, clue: { word: string; count: ClueCount }): string {
  return [`Board:\n${board(game.cards, game.team)}`, earlierClues(game), clueLine(clue)].join('\n\n');
}

// The shapes of the answers, as JSON schemas that the model writes to (model.ts).
export const CLUE_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          targets: { type: 'array', items: { type: 'integer' } },
          clue: { type: 'string' },
          count: { type: 'integer' },
        },
        required: ['targets', 'clue', 'count'],
        additionalProperties: false,
      },
    },
  },
  required: ['candidates'],
  additionalProperties: false,
};

export const GUESS_SCHEMA = {
  type: 'object',
  properties: {
    picks: { type: 'array', items: { type: 'integer' } },
    reason: { type: 'string' },
  },
  required: ['picks', 'reason'],
  additionalProperties: false,
};

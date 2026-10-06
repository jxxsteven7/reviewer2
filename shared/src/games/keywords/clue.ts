// Checks a clue against the standard rules: one word, and neither a word that is still on the
// board nor a form of one. The client runs it while the captain types, and the server runs it
// again before it accepts the clue. docs/games/keywords.md says which conflicts are refused and
// which only bring up a warning.

export type ClueProblem = 'clue_empty' | 'clue_not_one_word' | 'clue_too_long' | 'clue_on_board';

export interface ClueCheck {
  problem: ClueProblem | null;
  // The card that the clue repeats, when the problem is clue_on_board.
  conflict: number | null;
  // Cards that the clue may be a form of, such as "modeling" for "model". These are allowed,
  // but the captain sees a warning.
  similar: number[];
}

export const MAX_CLUE_LENGTH = 24;
export const MAX_CLUE_HAN = 10;

const HAN = /\p{Script=Han}/u;
// Letters, marks, digits, apostrophes and hyphens: "self-attention" is one word.
const ONE_WORD = /^[\p{L}\p{M}\p{N}'\u2019-]+$/u;
// The parts of a word: runs of Latin letters and digits, runs of Chinese characters, and runs of
// anything else, split at spaces, apostrophes and hyphens.
const PART = /[\p{Script=Latin}\p{N}]+|\p{Script=Han}+|[^\s'\u2019\p{Script=Latin}\p{N}\p{Script=Han}-]+/gu;
const LATIN = /\p{Script=Latin}/u;

export const normalizeClue = (text: string): string => text.normalize('NFKC').trim().toLowerCase();

const partsOf = (normalized: string): string[] => normalized.match(PART) ?? [];

const isPluralOf = (plural: string, word: string) => plural === `${word}s` || plural === `${word}es`;
const sameOrPlural = (a: string, b: string) => a === b || isPluralOf(a, b) || isPluralOf(b, a);

// The word itself and its possible stems without a common ending, also with a doubled final
// consonant undone ("modelling") and with the -y or -e that the ending replaced ("studies",
// "making"). Two words with a stem in common may be forms of each other.
const ENDINGS = ['ations', 'ation', 'ings', 'ing', 'ers', 'er', 'ies', 'ied', 'es', 'ed', 'ly', 's'];

function stems(word: string): Set<string> {
  const found = new Set([word]);
  for (const ending of ENDINGS) {
    if (!word.endsWith(ending)) continue;
    const base = word.slice(0, -ending.length);
    if (base.length < 3) continue;
    found.add(base);
    if (/([b-df-hj-np-tv-z])\1$/.test(base)) found.add(base.slice(0, -1));
    if (ending === 'ies' || ending === 'ied') found.add(`${base}y`);
    else found.add(`${base}e`);
  }
  return found;
}

const shareStem = (a: string, b: string) => [...stems(a)].some((stem) => stems(b).has(stem));

function repeats(clue: string, clueParts: string[], word: string): boolean {
  if (clue === word) return true;
  const wordParts = partsOf(word);
  return clueParts.some((part) =>
    wordParts.some((other) =>
      HAN.test(part) && HAN.test(other) ? part.includes(other) || other.includes(part) : sameOrPlural(part, other),
    ),
  );
}

function resembles(clueParts: string[], word: string): boolean {
  const wordParts = partsOf(word).filter((part) => LATIN.test(part));
  return clueParts.some((part) => LATIN.test(part) && wordParts.some((other) => shareStem(part, other)));
}

export function checkClue(clue: string, board: readonly { word: string; revealed: boolean }[]): ClueCheck {
  const verdict = (problem: ClueProblem | null, conflict: number | null = null, similar: number[] = []): ClueCheck => ({
    problem,
    conflict,
    similar,
  });
  const text = normalizeClue(clue);
  if (!text) return verdict('clue_empty');
  if (!ONE_WORD.test(text)) return verdict('clue_not_one_word');
  const chars = [...text];
  if (chars.length > MAX_CLUE_LENGTH || (chars.some((char) => HAN.test(char)) && chars.length > MAX_CLUE_HAN)) {
    return verdict('clue_too_long');
  }

  const clueParts = partsOf(text);
  const similar: number[] = [];
  for (const [index, card] of board.entries()) {
    if (card.revealed) continue; // a covered word may be said again
    const word = normalizeClue(card.word);
    if (repeats(text, clueParts, word)) return verdict('clue_on_board', index);
    if (resembles(clueParts, word)) similar.push(index);
  }
  return verdict(null, null, similar);
}

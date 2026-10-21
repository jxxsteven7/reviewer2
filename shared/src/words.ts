import { toSimplified } from './han';

// Words of the word library (words/README.md) and the text that players write about them: how a
// word is cleaned, compared and told from another, for every game that uses the library.

// A term as a game gets it from the word library: the word in the room's language and, when the
// library has them, the same term in its other languages, and the other forms of the term that the
// library lists in any language, such as "dataset" for "Data". A Chinese word also comes with its
// pinyin, which the server works out, without tones and with a space between the syllables, and
// with the English meanings of its characters, as the dictionary in words/dictionary/ gives them
// (`glosses`). The games' checks hold what a player writes against all of these.
export interface BoardWord {
  word: string;
  translations?: readonly string[];
  forms?: readonly string[];
  pinyin?: string;
  glosses?: readonly string[];
  // A word of the chair's own (docs/games/keywords.md#custom-words), which the record of the game
  // marks on its card; a word of the lists has none.
  custom?: true;
}

// Characters that show nothing: zero-width spaces and joiners, variation selectors, soft hyphens
// and blank fillers. Inside a word they would make it look like another word.
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;
const MARKS = /\p{M}/gu;
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]+/gu;
const SPACES = /\s+/gu;

// A word or a line as it is recorded and shown: as the player typed it, but without invisible
// characters, without the spaces at its ends, and with one plain space between its words.
export const cleanWord = (text: string): string => text.replace(INVISIBLE, '').trim().replace(SPACES, ' ');

// A word as it is checked: with full-width and compatibility forms folded (NFKC), and in lower
// case.
export const normalizeWord = (text: string): string => cleanWord(text.normalize('NFKC')).toLowerCase();

// A word as it is compared: normalized, without accents, and with traditional Chinese characters
// turned into simplified ones.
export const foldWord = (text: string): string => toSimplified(normalizeWord(text).normalize('NFD').replace(MARKS, ''));

// What makes two texts the same word: their letters and digits, in the form in which words are
// compared. "Co-author", "co author", "Coauthor" and "COAUTHOR" all have the key "coauthor".
export const wordKey = (text: string): string => foldWord(text).replace(NOT_LETTER_OR_DIGIT, '');

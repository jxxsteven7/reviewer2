// What players write, as it is shown: the rules that nicknames (names.ts) and chat messages
// (games/keywords/chat.ts) share, so that the two can't drift apart. A nickname refuses what a
// message merely drops, so the rules come as cleaners, and a name is refused when a cleaner would
// change it. Both sides run them: the client while a player types, and the server again before it
// keeps the text.

// How many marks of each kind one character may carry; see trimMarks.
export const MAX_MARKS = 4;

// Characters that show nothing by themselves but have a part in the text around them, so they
// stay: the zero-width joiner and non-joiner, which emoji are built with and which scripts such as
// Sinhala, Devanagari and Persian write some of their letters with; the variation selectors, which
// choose the glyph of an emoji, a Chinese character or a Mongolian letter; the Mongolian vowel
// separator; and the three direction marks, which put punctuation and numbers on the right side
// of Arabic and Hebrew text.
const SILENT_CHARS = '\\u200c-\\u200f\\u061c\\u180e\\p{Variation_Selector}';
export const SILENT = new RegExp(`[${SILENT_CHARS}]`, 'gu');
// Format characters that are shown: the signs that Arabic, Syriac and Kaithi draw over the number
// that follows them, such as the sign that ends an ayah.
const NUMBER_SIGN_CHARS = '\\u0600-\\u0605\\u06dd\\u070f\\u0890\\u0891\\u08e2\\u{110bd}\\u{110cd}';
// Everything else that shows nothing, or that every device shows in its own way: control and
// format characters, halves of surrogate pairs, private-use characters, the characters that
// Unicode says to ignore, such as zero-width spaces, soft hyphens, the characters that turn the
// direction of text around and the Hangul fillers, and the blank Braille pattern.
const HIDDEN_CHAR = `(?![${SILENT_CHARS}${NUMBER_SIGN_CHARS}])[\\p{Cc}\\p{Cf}\\p{Cs}\\p{Co}\\p{Default_Ignorable_Code_Point}\\u2800]`;
// The flags of England, Scotland and Wales are a black flag followed by tag characters, which are
// hidden. These three sequences are the only tags that stay.
const BLACK_FLAG = '\u{1f3f4}';
const TAG_FLAG =
  '\\u{1f3f4}\\u{e0067}\\u{e0062}(?:\\u{e0065}\\u{e006e}\\u{e0067}|\\u{e0073}\\u{e0063}\\u{e0074}|\\u{e0077}\\u{e006c}\\u{e0073})\\u{e007f}';
const HIDDEN_OR_FLAG = new RegExp(`${TAG_FLAG}|${HIDDEN_CHAR}`, 'gu');

// The text without its hidden characters. A match that starts with the black flag is one of the
// three flags, whole, and keeps its tags; every other match is one hidden character.
export const dropHidden = (text: string): string =>
  text.replace(HIDDEN_OR_FLAG, (match) => (match.startsWith(BLACK_FLAG) ? match : ''));

// Characters that stand with the character before them rather than on their own: combining marks,
// with the selectors among them, and the joiners, direction marks and vowel separator.
const CLINGING = '\\p{M}\\u200c-\\u200f\\u061c\\u180e';
const MARK_RUN = new RegExp(`[${CLINGING}]+`, 'gu');
// Marks that sit on the letter, and marks that stand beside it and take their own room.
const PILING = /[\p{Mn}\p{Me}]/u;
const SPACING = /\p{Mc}/u;

// The text with no more than MAX_MARKS marks of each kind on any one character: marks that sit on
// it, which otherwise pile up over the lines around; marks that stand beside it, which otherwise
// make one character as wide as a line; and the joiners and direction marks among them, which
// otherwise could split a pile into short runs. The run after a character is measured as a whole,
// whatever stands between its marks. Four of a kind is what the scripts that stack their letters
// need: a Tibetan syllable may sit three or four marks on a letter, and a Burmese one may stand
// three beside it.
export function trimMarks(text: string): string {
  return text.replace(MARK_RUN, (run) => {
    const counts = { piling: 0, spacing: 0, other: 0 };
    let kept = '';
    for (const char of run) {
      let kind: keyof typeof counts = 'other';
      if (PILING.test(char)) kind = 'piling';
      else if (SPACING.test(char)) kind = 'spacing';
      if (++counts[kind] <= MAX_MARKS) kept += char;
    }
    return kept;
  });
}

// Marks and silent characters at the ends of the text, with the spaces around them. At the start,
// a mark would settle on whatever stands before the text on the page, and a silent character has
// nothing to belong to; at the end, they hide a space that would otherwise be trimmed.
const STRAYS = new RegExp(`^[\\s${CLINGING}]+|\\s[\\s${CLINGING}]*$`, 'gu');
export const trimStrays = (text: string): string => text.replace(STRAYS, '');

// Whether a reader sees anything of the text at all: it has a character that is neither a space,
// a mark, hidden nor silent, or one of the number signs, which are format characters but shown.
const SHOWN = new RegExp(
  `[^\\s\\p{M}\\p{Cc}\\p{Cf}\\p{Cs}\\p{Co}\\p{Default_Ignorable_Code_Point}\\u2800]|[${NUMBER_SIGN_CHARS}]`,
  'u',
);
export const showsSomething = (text: string): boolean => SHOWN.test(text);

// A browser without Intl.Segmenter counts code points instead, which only makes it stricter than
// the server about characters that are built from several.
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;

// How long a text is, in the characters that a reader sees: an emoji that is built from several
// code points is one, and so is a letter with its marks.
export const textLength = (text: string): number =>
  segmenter ? [...segmenter.segment(text)].length : [...text].length;

// Spaces, tabs and other control characters inside a line count as one space, and so does the
// blank Braille pattern, as in the chat.
const SPACES = /[\s\p{Cc}\u2800]+/gu;

// One line as it is kept, as a contact or a bio is: as a chat message is cleaned, without hidden
// characters, with no more than four marks of a kind on any character, and without spaces or
// stray marks at its ends.
export const cleanLine = (line: string): string => trimStrays(trimMarks(dropHidden(line.replace(SPACES, ' '))));

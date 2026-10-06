import { MAX_NAME_INPUT, MAX_NAME_LENGTH } from './protocol';

// Nicknames (docs/architecture.md). Both sides run these rules: the client while a player types,
// and the server before it lets anyone in or renames them.

// The zero-width joiner and the two variation selectors show nothing by themselves, but many
// emoji are built with them.
const EMOJI_GLUE = /\u200d|\ufe0e|\ufe0f/g;
// Everything else that shows nothing, or that every device shows in its own way: control and
// format characters, private-use characters, halves of surrogate pairs, the characters that
// Unicode says to ignore, such as zero-width spaces, soft hyphens and the Hangul fillers, and the
// blank Braille pattern. Two names could differ in them and look the same, and a name of nothing
// else would look empty.
const HIDDEN = /(?!\u200d|\ufe0e|\ufe0f)[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Default_Ignorable_Code_Point}\u2800]/u;
// The flags of England, Scotland and Wales are a black flag followed by tag characters, which are
// among those that show nothing. These three sequences are the only tags that a name may have.
const TAG_FLAGS =
  /\u{1f3f4}\u{e0067}\u{e0062}(?:\u{e0065}\u{e006e}\u{e0067}|\u{e0073}\u{e0063}\u{e0074}|\u{e0077}\u{e006c}\u{e0073})\u{e007f}/gu;
// A combining mark at the start of a name settles on whatever stands before the name on the page,
// and a long run of marks piles up over the lines above. Scripts that stack their letters, such
// as Tibetan, need runs of up to four. The selectors are marks themselves and count; the joiner
// is not, so it is taken out before the runs are measured, or it could split a long run into
// short ones. It may stand after a mark all the same: that is how Sinhala and other scripts
// write some of their letters.
const STRAY_MARKS = /^\p{M}|\p{M}{5}/u;
const JOINERS = /\u200d/g;

let segmenter: Intl.Segmenter | null | undefined;

// How long a name is, in the characters that a reader sees: an emoji that is built from several
// code points is one. A browser without Intl.Segmenter counts code points instead, which only
// makes it stricter than the server about such emoji.
function nameLength(name: string): number {
  if (segmenter === undefined) {
    segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
  }
  return segmenter ? [...segmenter.segment(name)].length : [...name].length;
}

// A nickname as it will be shown, or null when it can't be one: empty, too long, or with something
// in it that a reader can't see. Spaces inside are collapsed and full-width forms folded.
export function cleanName(raw: string): string | null {
  if (raw.length > MAX_NAME_INPUT) return null;
  const name = raw.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (HIDDEN.test(name.replace(TAG_FLAGS, '')) || STRAY_MARKS.test(name.replace(JOINERS, ''))) return null;
  // What is left may still show nothing, if it is only the glue between emoji.
  if (!name.replace(EMOJI_GLUE, '').trim()) return null;
  return nameLength(name) <= MAX_NAME_LENGTH ? name : null;
}

// Two names clash when a reader can't tell them apart: when they differ only in case, or only in
// the glue between emoji, which shows nothing where no emoji needs it.
const nameKey = (name: string): string => name.replace(EMOJI_GLUE, '').toLocaleLowerCase('en');
export const sameName = (a: string, b: string): boolean => nameKey(a) === nameKey(b);

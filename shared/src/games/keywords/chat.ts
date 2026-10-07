// The chat between the guessers of a group (docs/games/keywords.md). The client runs this check
// while a player types, and the server runs it again before it keeps the message.

export type ChatProblem = 'chat_empty' | 'chat_too_long';

export interface ChatCheck {
  // The message as it is kept and shown.
  text: string;
  problem: ChatProblem | null;
}

// The longest message, in characters, once it has been cleaned.
export const MAX_CHAT_LENGTH = 200;
// The longest text that is looked at at all, in UTF-16 units as it arrives.
export const MAX_CHAT_INPUT = 1000;
// How many messages a group keeps. Every change to a room sends each member a whole snapshot
// with their group's chat in it, so the chat decides how large a snapshot can get, and a guesser
// may send ten messages of 200 characters a second, each of which goes out to everyone in the
// room with the whole chat. Twenty messages are what a group has said in the turn or two that it
// is still thinking about, and at most 4,000 characters in a snapshot.
export const CHAT_KEPT = 20;

// Line breaks, tabs and other control characters count as spaces: a message is one line.
const SPACES = /[\s\p{Cc}]+/gu;
// The zero-width joiner and the two variation selectors show nothing by themselves, but many
// emoji are built with them.
const EMOJI_GLUE = /\u200d|\ufe0e|\ufe0f/g;
// The flags of England, Scotland and Wales are a black flag followed by tag characters, which
// show nothing by themselves.
const TAG_FLAG =
  /\u{1f3f4}\u{e0067}\u{e0062}(?:\u{e0065}\u{e006e}\u{e0067}|\u{e0073}\u{e0063}\u{e0074}|\u{e0077}\u{e006c}\u{e0073})\u{e007f}/u;
// Characters that show nothing, such as zero-width spaces and the marks that turn the direction
// of text around, but not the emoji glue. The first group matches one of those three flags
// whole, so that its tags can be put back.
const INVISIBLE = new RegExp(`(${TAG_FLAG.source})|(?!${EMOJI_GLUE.source})\\p{Default_Ignorable_Code_Point}`, 'gu');
// A long run of combining marks piles up over the line above. Scripts that stack their letters,
// such as Tibetan and Burmese, need runs of up to four, so a run keeps its first four marks and
// loses the rest. The selectors are marks themselves and count. The joiner is not a mark, and it
// may stand after one, as Sinhala and other scripts write some of their letters with it, so the
// run is measured across it; otherwise it could split a long run into short ones.
const PILED_MARKS = /(\p{M}(?:\u200d*\p{M}){3})(?:\u200d*\p{M})+\u200d*/gu;

// A message as it is kept and shown: what the player typed, on one line, without invisible
// characters and piles of combining marks, and without spaces at its ends.
export const cleanChat = (text: string): string =>
  text
    .replace(INVISIBLE, (_, flag?: string) => flag ?? '')
    .replace(SPACES, ' ')
    .replace(PILED_MARKS, '$1')
    .trim();

export function checkChat(text: string): ChatCheck {
  // The types promise a string, but the message comes from a player.
  if (typeof text !== 'string') return { text: '', problem: 'chat_empty' };
  if (text.length > MAX_CHAT_INPUT) return { text: '', problem: 'chat_too_long' };
  const cleaned = cleanChat(text);
  // What is left may still show nothing, if it is only the glue between emoji.
  if (!cleaned.replace(EMOJI_GLUE, '').trim()) return { text: '', problem: 'chat_empty' };
  if ([...cleaned].length > MAX_CHAT_LENGTH) return { text: cleaned, problem: 'chat_too_long' };
  return { text: cleaned, problem: null };
}

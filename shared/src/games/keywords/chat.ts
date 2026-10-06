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
// How many messages a group keeps. Older ones are dropped, so that the state of a room, which
// every change sends to every player, stays small.
export const CHAT_KEPT = 50;

// Line breaks, tabs and other control characters count as spaces: a message is one line.
const SPACES = /[\s\p{Cc}]+/gu;
// Characters that show nothing, such as zero-width spaces and the marks that turn the direction
// of text around. The zero-width joiner and the two variation selectors that emoji are built
// with stay.
const INVISIBLE = /(?!\u200d|\ufe0e|\ufe0f)\p{Default_Ignorable_Code_Point}/gu;
const EMOJI_GLUE = /\u200d|\ufe0e|\ufe0f/g;
// More than two combining marks in a row only pile up over the line above.
const PILED_MARKS = /(\p{M}{2})\p{M}+/gu;

// A message as it is kept and shown: what the player typed, on one line, without invisible
// characters and piles of combining marks, and without spaces at its ends.
export const cleanChat = (text: string): string =>
  text.replace(INVISIBLE, '').replace(SPACES, ' ').replace(PILED_MARKS, '$1').trim();

export function checkChat(text: string): ChatCheck {
  if (text.length > MAX_CHAT_INPUT) return { text: '', problem: 'chat_too_long' };
  const cleaned = cleanChat(text);
  // What is left may still show nothing, if it is only the glue between emoji.
  if (!cleaned.replace(EMOJI_GLUE, '').trim()) return { text: '', problem: 'chat_empty' };
  if ([...cleaned].length > MAX_CHAT_LENGTH) return { text: cleaned, problem: 'chat_too_long' };
  return { text: cleaned, problem: null };
}

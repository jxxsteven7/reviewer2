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
// Characters that show nothing, such as zero-width spaces and the marks that turn the direction
// of text around. The zero-width joiner and the two variation selectors stay, because many
// emoji are built with them.
const INVISIBLE = /(?!\u200d|\ufe0e|\ufe0f)\p{Default_Ignorable_Code_Point}/gu;
const EMOJI_GLUE = /\u200d|\ufe0e|\ufe0f/g;
// No emoji has a joiner or a selector after a combining mark, so one that stands there only
// serves to hide a pile of marks from the next step.
const GLUE_AFTER_MARK = /(\p{M})(?:\u200d|\ufe0e|\ufe0f)+/gu;
// More than two combining marks in a row only pile up over the line above.
const PILED_MARKS = /(\p{M}{2})\p{M}+/gu;

// A message as it is kept and shown: what the player typed, on one line, without invisible
// characters and piles of combining marks, and without spaces at its ends.
export const cleanChat = (text: string): string =>
  text.replace(INVISIBLE, '').replace(GLUE_AFTER_MARK, '$1').replace(SPACES, ' ').replace(PILED_MARKS, '$1').trim();

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

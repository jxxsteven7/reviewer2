// The chat between the guessers of a group (docs/games/keywords.md). The client runs this check
// while a player types, and the server runs it again before it keeps the message. What shows and
// what doesn't is decided in text.ts, which nicknames share.

import { dropHidden, showsSomething, textLength, trimMarks, trimStrays } from '../../text';

export type ChatProblem = 'chat_empty' | 'chat_too_long';

export interface ChatCheck {
  // The message as it is kept and shown.
  text: string;
  problem: ChatProblem | null;
}

// The longest message, in the characters that a reader sees, once it has been cleaned.
export const MAX_CHAT_LENGTH = 200;
// The longest text that is looked at at all, in UTF-16 units as it arrives. Cleaning never makes a
// text longer, so this also bounds a message as it is kept: a character may be built from several
// code points, and 200 flags of Scotland would be 2,800 units.
export const MAX_CHAT_INPUT = 1000;
// How many messages a group keeps. Every change to a room sends each member a whole snapshot
// with their group's chat in it, so the chat decides how large a snapshot can get, and a guesser
// may send ten messages a second, each of which goes out to everyone in the room with the whole
// chat. Twenty messages are what a group has said in the turn or two that it is still thinking
// about, and at most 20,000 UTF-16 units in a snapshot.
export const CHAT_KEPT = 20;

// Line breaks, tabs and other control characters count as spaces, and so does the blank Braille
// pattern: a message is one line.
const SPACES = /[\s\p{Cc}\u2800]+/gu;

// A message as it is kept and shown: what the player typed, on one line, without hidden
// characters, with no more than four marks of a kind on any character, and without spaces or stray
// marks at its ends.
export const cleanChat = (text: string): string => trimStrays(trimMarks(dropHidden(text.replace(SPACES, ' '))));

export function checkChat(text: string): ChatCheck {
  // The types promise a string, but the message comes from a player.
  if (typeof text !== 'string') return { text: '', problem: 'chat_empty' };
  if (text.length > MAX_CHAT_INPUT) return { text: '', problem: 'chat_too_long' };
  const cleaned = cleanChat(text);
  // What is left may still show nothing, if it is only the silent characters that emoji and some
  // letters are built with.
  if (!showsSomething(cleaned)) return { text: '', problem: 'chat_empty' };
  if (textLength(cleaned) > MAX_CHAT_LENGTH) return { text: cleaned, problem: 'chat_too_long' };
  return { text: cleaned, problem: null };
}

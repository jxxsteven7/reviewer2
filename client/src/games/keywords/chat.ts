import type { ChatMessage } from '@reviewer2/shared';
import { readStored, writeStored } from '../../core/storage';

// The group chat on the client: the messages grouped by the turn in which they were written, and
// how many of them the viewer hasn't read yet. The ID of the last message the viewer has seen is
// stored with the game's ID, so that it survives a reload and starts over with the next game.

const SEEN = 'r2.chatSeen';

export interface ChatTurn {
  turn: number;
  messages: ChatMessage[];
}

export function byTurn(messages: readonly ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const message of messages) {
    const last = turns.at(-1);
    if (last?.turn === message.turn) last.messages.push(message);
    else turns.push({ turn: message.turn, messages: [message] });
  }
  return turns;
}

// The messages that others wrote after the last one the viewer has seen.
export const unread = (messages: readonly ChatMessage[], seen: number, me: string | null): number =>
  messages.filter((message) => message.id > seen && message.player !== me).length;

export function seenIn(gameId: string): number {
  const stored = readStored(SEEN) ?? '';
  const split = stored.lastIndexOf(':');
  if (split < 0 || stored.slice(0, split) !== gameId) return 0;
  return Number(stored.slice(split + 1)) || 0;
}

export const markSeen = (gameId: string, id: number): void => writeStored(SEEN, `${gameId}:${id}`);

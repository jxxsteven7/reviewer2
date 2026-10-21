import type { ChatMessage } from '@reviewer2/shared/keywords';
import { readStored, writeStored } from '../../core/storage';

// The group chat on the client: the messages grouped by the turn in which they were written, and
// how many of them the viewer hasn't read yet. The ID of the last message the viewer has seen is
// stored by game, so that it survives a reload, starts over with the next game, and two tabs in
// different rooms don't overwrite each other's.

const SEEN = 'r2.chatSeen';
// How many games are remembered: the latest few, so that the entry never grows.
const GAMES_KEPT = 8;

type Seen = [gameId: string, id: number][];

// The messages of a turn, or those written after the game (`after`), which come last.
export interface ChatTurn {
  turn: number;
  after?: true;
  messages: ChatMessage[];
}

export function byTurn(messages: readonly ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const message of messages) {
    const last = turns.at(-1);
    const after = message.after === true;
    if (last && last.turn === message.turn && (last.after === true) === after) last.messages.push(message);
    else turns.push({ turn: message.turn, ...(after ? { after: true as const } : {}), messages: [message] });
  }
  return turns;
}

// The messages that others wrote after the last one the viewer has seen.
export const unread = (messages: readonly ChatMessage[], seen: number, me: string | null): number =>
  messages.filter((message) => message.id > seen && message.player !== me).length;

// What is stored: the last message seen in each remembered game, oldest game first. Anything
// else in the entry, such as a value from an older build, counts as nothing seen.
function readSeen(): Seen {
  try {
    const stored: unknown = JSON.parse(readStored(SEEN) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored.filter(
      (entry): entry is Seen[number] =>
        Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number',
    );
  } catch {
    return [];
  }
}

export const seenIn = (gameId: string): number => readSeen().find(([game]) => game === gameId)?.[1] ?? 0;

export function markSeen(gameId: string, id: number): void {
  const others = readSeen().filter(([game]) => game !== gameId);
  writeStored(SEEN, JSON.stringify([...others.slice(1 - GAMES_KEPT), [gameId, id]]));
}

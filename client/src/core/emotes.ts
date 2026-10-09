import { EMOTE_COOLDOWN_MS, EMOTES, type Emote, type EmoteEvent } from '@reviewer2/shared';
import { reactive, ref, watch } from 'vue';
import { room } from './room';
import { act, socket } from './socket';
import { playSound } from './sound';

// The quick reactions of the room this page shows (docs/architecture.md): the bubbles that say who
// sent which, with their sounds, and the wait before this player may send another one.

export interface Bubble {
  id: number;
  name: string;
  avatar?: string | undefined;
  emote: Emote;
}

// How long a bubble stays, and how many show at once.
const SHOWN_MS = 4000;
const MOST_BUBBLES = 3;

export const bubbles = reactive<Bubble[]>([]);
let nextId = 1;

function pop(id: number): void {
  const index = bubbles.findIndex((bubble) => bubble.id === id);
  if (index !== -1) bubbles.splice(index, 1);
}

// The connection stays in its room when the page goes elsewhere, and the reactions keep coming, so
// only those of the room on the page show and sound, from a sender the page knows by name.
socket.on('room:emote', ({ roomId, playerId, emote }: EmoteEvent) => {
  const shown = room.value;
  const sender = shown?.roomId === roomId ? shown.players.find((player) => player.id === playerId) : undefined;
  if (!sender || !EMOTES.includes(emote)) return;
  const id = nextId;
  nextId += 1;
  bubbles.push({ id, name: sender.name, avatar: sender.avatar, emote });
  if (bubbles.length > MOST_BUBBLES) bubbles.splice(0, bubbles.length - MOST_BUBBLES);
  setTimeout(() => pop(id), SHOWN_MS);
  playSound(emote);
});

// When this player may send the next reaction, by the page's clock. The server keeps the same wait,
// for every tab of the player, and says how much is left when a tab asks too soon.
export const readyAt = ref(0);

export async function sendEmote(emote: Emote): Promise<void> {
  readyAt.value = Date.now() + EMOTE_COOLDOWN_MS;
  const reply = await act('room:emote', { emote });
  if (reply.ok) return;
  // Too soon after one from another tab: the wait is what the server says is left. One that never
  // reached the server, such as while offline, doesn't count.
  readyAt.value = reply.error === 'emote_cooldown' ? Date.now() + (reply.waitMs ?? EMOTE_COOLDOWN_MS) : 0;
}

// The bubbles and the wait are the room's: when the page shows another room, or none any more,
// after the chair closed it, they go.
watch(
  () => room.value?.roomId,
  () => {
    bubbles.splice(0);
    readyAt.value = 0;
  },
);

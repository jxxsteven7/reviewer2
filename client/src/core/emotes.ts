import { EMOTE_COOLDOWN_MS, EMOTES, type Emote, type EmoteEvent } from '@reviewer2/shared';
import { reactive, ref, watch } from 'vue';
import { room } from './room';
import { act, socket } from './socket';
import { playSound } from './sound';

// The quick reactions of the room this page shows (docs/architecture.md): the bubbles that say who
// sent which, with their sounds, and the wait before this player may send another one. The room's
// calls about a player, such as a PI's missed deadline, come as bubbles too, louder ones.

// A bubble is a reaction that a player sent, or a call about a player, as the page wrote it.
export type Bubble = {
  id: number;
  name: string;
  avatar?: string | undefined;
  // A guest's number, for the color of their avatar (PlayerAvatar.vue).
  guest?: number | undefined;
} & ({ emote: Emote } | { call: string });

// Whom a bubble shows: a player, as the room has them.
type Shown = { name: string; avatar?: string | undefined; guest?: number | undefined };

// How long a bubble stays, a call a little longer, and how many show at once (show).
const SHOWN_MS = 4000;
const CALL_MS = 6000;
const MOST_BUBBLES = 3;

export const bubbles = reactive<Bubble[]>([]);
let nextId = 1;

function pop(id: number): void {
  const index = bubbles.findIndex((bubble) => bubble.id === id);
  if (index !== -1) bubbles.splice(index, 1);
}

// Shows a bubble for `ms`. Over the limit, the oldest reaction goes first, so that a call about a
// player isn't crowded out by the reactions to it; only when nothing but calls is left does the
// oldest of them go.
function show(bubble: Bubble, ms: number): void {
  bubbles.push(bubble);
  while (bubbles.length > MOST_BUBBLES) {
    const oldest = bubbles.findIndex((shown) => 'emote' in shown);
    bubbles.splice(oldest === -1 ? 0 : oldest, 1);
  }
  setTimeout(() => pop(bubble.id), ms);
}

// The room calls out something about a player, for everyone on the page to see and hear: the
// line, with the player's avatar, and the sound of a reaction.
export function callOut(player: Shown, line: string, sound: Emote): void {
  const id = nextId;
  nextId += 1;
  show({ id, name: player.name, avatar: player.avatar, guest: player.guest, call: line }, CALL_MS);
  playSound(sound);
}

// The connection stays in its room when the page goes elsewhere, and the reactions keep coming, so
// only those of the room on the page show and sound, from a sender the page knows by name.
socket.on('room:emote', ({ roomId, playerId, emote }: EmoteEvent) => {
  const shown = room.value;
  const sender = shown?.roomId === roomId ? shown.players.find((player) => player.id === playerId) : undefined;
  if (!sender || !EMOTES.includes(emote)) return;
  const id = nextId;
  nextId += 1;
  show({ id, name: sender.name, avatar: sender.avatar, guest: sender.guest, emote }, SHOWN_MS);
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

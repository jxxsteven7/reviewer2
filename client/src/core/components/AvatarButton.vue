<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useOpenPlayer } from '../playerPanel';
import { openProfile } from '../profilePanel';
import PlayerAvatar from './PlayerAvatar.vue';

// A player's avatar that opens their panel in the room (PlayerPanel.vue), for everyone, the viewer
// themselves and guests included: a small hard shadow says that it can be pressed, as on every
// sticker that can, and the press takes it away. The button reaches 44 px around the avatar, out of
// sight, and its name says whose profile it shows. Where the page opens no panel, as on a big
// screen, or for a player who has left the room, it is the avatar alone. Outside a room, the avatar
// of an account, by the `handle` of its page, opens the account's panel (ProfilePanel.vue, the
// site's one, profilePanel.ts) in the same look, as a room's does, so that a tap on an avatar does
// the same everywhere. `name` is the player's name as the page gives it, `username` an account's
// username where the name is the viewer's own for a friend (names.ts), which the default avatar is
// drawn from all the same, `initial` what the default avatar shows in place of its first character,
// and `guest` a guest's number, for the default avatar's color (PlayerAvatar.vue). In a game that
// shows its players by number, a number's avatar `opens` the game's own panel for the seat, under
// the `label` that names it.
const props = withDefaults(
  defineProps<{
    playerId?: string | null;
    handle?: string | null;
    name: string;
    username?: string | null;
    initial?: string | null;
    guest?: number | null;
    avatar?: string | null;
    agent?: boolean;
    size?: 'small' | 'medium' | 'large';
    // Faded, with the dots of someone the room waits for (PlayerAvatar.vue).
    waiting?: boolean;
    // Faded under the veil alone, as a player who is out of a game (PlayerAvatar.vue).
    faded?: boolean;
    opens?: (() => void) | null;
    label?: string | null;
  }>(),
  {
    playerId: null,
    handle: null,
    username: null,
    initial: null,
    guest: null,
    avatar: null,
    agent: false,
    size: 'small',
    waiting: false,
    faded: false,
    opens: null,
    label: null,
  },
);
const open = useOpenPlayer();
const { t } = useI18n();
const press = () => props.playerId !== null && open?.(props.playerId);
const drawnFrom = computed(() => props.username ?? props.name);
</script>

<template>
  <button
    v-if="opens"
    type="button"
    class="avatar-button press-host"
    :aria-label="label ?? name"
    aria-haspopup="dialog"
    @click="opens()"
  >
    <PlayerAvatar
      class="press-part"
      :name="drawnFrom"
      :initial="initial"
      :guest="guest"
      :avatar="avatar"
      :agent="agent"
      :size="size"
      :waiting="waiting"
      :faded="faded"
    />
  </button>
  <button
    v-else-if="handle"
    type="button"
    class="avatar-button press-host"
    :aria-label="t('room.viewProfile', { name })"
    aria-haspopup="dialog"
    @click="openProfile(handle, username ?? name)"
  >
    <PlayerAvatar
      class="press-part"
      :name="drawnFrom"
      :initial="initial"
      :guest="guest"
      :avatar="avatar"
      :agent="agent"
      :size="size"
      :waiting="waiting"
      :faded="faded"
    />
  </button>
  <button
    v-else-if="open && playerId !== null"
    type="button"
    class="avatar-button press-host"
    :aria-label="t('room.viewProfile', { name })"
    @click="press"
  >
    <PlayerAvatar
      class="press-part"
      :name="drawnFrom"
      :initial="initial"
      :guest="guest"
      :avatar="avatar"
      :agent="agent"
      :size="size"
      :waiting="waiting"
      :faded="faded"
    />
  </button>
  <PlayerAvatar
    v-else
    :name="drawnFrom"
    :initial="initial"
    :guest="guest"
    :avatar="avatar"
    :agent="agent"
    :size="size"
    :waiting="waiting"
    :faded="faded"
  />
</template>

<style scoped>
.avatar-button {
  position: relative;
  display: inline-flex;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
  touch-action: manipulation;
}

.avatar-button::before {
  content: '';
  position: absolute;
  inset: calc(50% - 22px);
}

/* The avatar wears the hard shadow of a sticker that can be pressed, and moves as one does
   (`press-part` in base.css). */
.avatar-button > :deep(.avatar) {
  box-shadow: var(--shadow-1);
}

.avatar-button:focus-visible {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 3px;
}
</style>

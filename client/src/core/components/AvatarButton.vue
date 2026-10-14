<script setup lang="ts">
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
// the same everywhere. `name` is the player's name, an account's username.
const props = withDefaults(
  defineProps<{
    playerId?: string | null;
    handle?: string | null;
    name: string;
    avatar?: string | null;
    agent?: boolean;
    size?: 'small' | 'medium' | 'large';
  }>(),
  { playerId: null, handle: null, avatar: null, agent: false, size: 'small' },
);
const open = useOpenPlayer();
const { t } = useI18n();
const press = () => props.playerId !== null && open?.(props.playerId);
</script>

<template>
  <button
    v-if="handle"
    type="button"
    class="avatar-button"
    :aria-label="t('room.viewProfile', { name })"
    aria-haspopup="dialog"
    @click="openProfile(handle, name)"
  >
    <PlayerAvatar :name="name" :avatar="avatar" :agent="agent" :size="size" />
  </button>
  <button
    v-else-if="open && playerId !== null"
    type="button"
    class="avatar-button"
    :aria-label="t('room.viewProfile', { name })"
    @click="press"
  >
    <PlayerAvatar :name="name" :avatar="avatar" :agent="agent" :size="size" />
  </button>
  <PlayerAvatar v-else :name="name" :avatar="avatar" :agent="agent" :size="size" />
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

.avatar-button > :deep(.avatar) {
  box-shadow: var(--shadow-1);
  transition:
    transform var(--motion),
    box-shadow var(--motion);
}

.avatar-button:active > :deep(.avatar) {
  transform: translate(var(--shift-1), var(--shift-1));
  box-shadow: none;
}

.avatar-button:focus-visible {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 3px;
}
</style>

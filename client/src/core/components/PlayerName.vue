<script setup lang="ts">
import type { PlayerView } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import AgentIcon from './AgentIcon.vue';
import AvatarButton from './AvatarButton.vue';

// A player's avatar and name with their online status, the academic rank of a player with an
// account, small beside the name, and marks for "you", the chair, an AI player, with the robot's
// head that is its avatar too, and a player whose turns an AI plays while they are away
// (docs/architecture.md#ai-players). In a room, the avatar opens the player's panel, for everyone,
// the viewer included (AvatarButton.vue); the name is plain text. The rank and the marks wrap
// under the name, never under the avatar.
defineProps<{ player: PlayerView; me: boolean; chair: boolean }>();
const { t } = useI18n();
</script>

<template>
  <span class="player" :class="{ offline: !player.online }">
    <span class="dot" :class="{ on: player.online }" aria-hidden="true"></span>
    <AvatarButton
      :player-id="player.id"
      :name="player.name"
      :avatar="player.avatar"
      :agent="player.agent !== undefined"
      :class="{ away: !player.online }"
    />
    <span class="label">
      <span class="name">{{ player.name }}</span>
      <span v-if="player.rank" class="rank">{{ t(`ranks.names.${player.rank}`) }}</span>
      <span v-if="me" class="mark">{{ t('room.you') }}</span>
      <span v-if="chair" class="mark">{{ t('room.chair') }}</span>
      <span v-if="player.agent" class="mark agent"><AgentIcon />{{ t('room.agent') }}</span>
      <span v-if="player.takenOver" class="mark agent">{{ t('room.takenOver') }}</span>
      <span v-if="!player.online" class="mark">{{ t('room.offline') }}</span>
    </span>
  </span>
</template>

<style scoped>
.player {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  max-width: 100%;
  font-weight: var(--weight-bold);
}

.dot {
  flex: none;
  width: 10px;
  height: 10px;
  border: var(--line-thin) solid var(--ink);
  border-radius: 50%;
  background: var(--paper);
}

.dot.on {
  background: var(--ink);
}

.label {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px var(--space-2);
  min-width: 0;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.offline .name {
  color: var(--ink-2);
}

.rank {
  flex: none;
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}

.away {
  opacity: 0.5;
}

.mark {
  flex: none;
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--on-ink);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  line-height: 1.6;
}

.offline .mark:last-child {
  background: var(--neutral);
  color: var(--on-neutral);
}

/* An AI and the AI that plays for someone wear the same outlined mark, apart from the solid ones. */
.mark.agent {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  border: var(--line-thin) solid var(--ink);
  background: var(--paper);
  color: var(--ink);
}
</style>

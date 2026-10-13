<script setup lang="ts">
import type { PlayerView } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import AgentIcon from './AgentIcon.vue';
import PlayerAvatar from './PlayerAvatar.vue';

// A player's avatar and name with their online status, the academic rank of a player with an
// account, small beside the name, and marks for "you", the chair, an AI player, with the robot's
// head that is its avatar too, and a player whose turns an AI plays while they are away
// (docs/architecture.md#ai-players). For the chair, in a public room for anyone who may report a
// player, and for an account that may ask another to be friends, other players' names are buttons
// that open the player menu. The name, the rank and the marks wrap under the name, never under the
// avatar, so that on a narrow screen they stay clear of the sticker's round ends.
defineProps<{ player: PlayerView; me: boolean; chair: boolean; manageable: boolean }>();
const emit = defineEmits<{ manage: [player: PlayerView] }>();
const { t } = useI18n();
</script>

<template>
  <component
    :is="manageable ? 'button' : 'span'"
    :type="manageable ? 'button' : undefined"
    class="player"
    :class="{ offline: !player.online, manageable }"
    @click="manageable && emit('manage', player)"
  >
    <span class="dot" :class="{ on: player.online }" aria-hidden="true"></span>
    <PlayerAvatar
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
  </component>
</template>

<style scoped>
.player {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-weight: var(--weight-bold);
  text-align: left;
}

/* A name that can be acted on is a small sticker of its own, a pill on one line and a rounded box
   on two, with room above and below the lines. */
.manageable {
  padding: var(--space-1) var(--space-3) var(--space-1) var(--space-1);
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  cursor: pointer;
}

.manageable:active {
  background: var(--bg);
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

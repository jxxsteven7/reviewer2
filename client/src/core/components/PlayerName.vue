<script setup lang="ts">
import type { PlayerView } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import PlayerAvatar from './PlayerAvatar.vue';

// A player's avatar and name with their online status, and marks for "you" and the chair. For the
// chair, and in a public room for anyone who may report a player, other players' names are
// buttons that open the player menu.
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
    <PlayerAvatar :name="player.name" :avatar="player.avatar" :class="{ away: !player.online }" />
    <span class="name">{{ player.name }}</span>
    <span v-if="me" class="mark">{{ t('room.you') }}</span>
    <span v-if="chair" class="mark">{{ t('room.chair') }}</span>
    <span v-if="!player.online" class="mark">{{ t('room.offline') }}</span>
  </component>
</template>

<style scoped>
.player {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px var(--space-2);
  min-height: 44px;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-weight: var(--weight-bold);
  text-align: left;
}

/* A name that can be acted on is a small sticker of its own. */
.manageable {
  padding: 0 var(--space-3) 0 var(--space-1);
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-pill);
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

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.offline .name {
  color: var(--ink-2);
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
</style>

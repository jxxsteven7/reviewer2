<script setup lang="ts">
import type { PlayerView } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import PlayerAvatar from './PlayerAvatar.vue';

// A player's avatar and name with their online status, and marks for "you" and the chair. For the
// chair, other players' names are buttons that open the chair's actions.
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
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  text-align: left;
}

.manageable {
  cursor: pointer;
  text-decoration: underline dotted var(--ink-3);
  text-underline-offset: 0.25em;
}

.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border: 1px solid var(--ink-3);
  border-radius: 50%;
}

.dot.on {
  border-color: var(--ink);
  background: var(--ink);
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.offline .name {
  color: var(--ink-3);
}

.away {
  opacity: 0.55;
}

.mark {
  color: var(--ink-3);
  font-size: var(--text-xs);
  font-variant-caps: all-small-caps;
  letter-spacing: 0.06em;
}
</style>

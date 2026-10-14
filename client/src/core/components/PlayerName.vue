<script setup lang="ts">
import type { PlayerView } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import AgentIcon from './AgentIcon.vue';
import AvatarButton from './AvatarButton.vue';
import ScoreFloat, { type Shown } from './ScoreFloat.vue';

// A player's avatar and name with their online status, the academic rank of a player with an
// account, small beside the name, and marks for "you", the chair, an AI player, with the robot's
// head that is its avatar too, and a player whose turns an AI plays while they are away
// (docs/architecture.md#ai-players). In a room, the avatar opens the player's panel, for everyone,
// the viewer included (AvatarButton.vue); the name is plain text. Whether the player is online is a
// small dot on the avatar's bottom right corner, green or grey, as on the friends list. Everything
// stays on one line: where it is too long, the rank is cut short first, down to nothing, and only
// then the name, never the marks.
// A `float` is a number that rises from the avatar, what a card or the end of a game did to the
// player's points (ScoreFloat.vue).
withDefaults(defineProps<{ player: PlayerView; me: boolean; chair: boolean; float?: Shown | null }>(), {
  float: null,
});
const { t } = useI18n();
</script>

<template>
  <span class="player" :class="{ offline: !player.online }">
    <span class="face">
      <AvatarButton
        :player-id="player.id"
        :name="player.name"
        :avatar="player.avatar"
        :agent="player.agent !== undefined"
        :class="{ away: !player.online }"
      />
      <span class="dot" :class="{ on: player.online }" aria-hidden="true"></span>
      <ScoreFloat v-if="float" :key="float.key" :float="float" size="avatar" />
    </span>
    <span class="label">
      <span class="who">
        <span class="name">{{ player.name }}</span>
        <span v-if="player.rank" class="rank">{{ t(`ranks.names.${player.rank}`) }}</span>
      </span>
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
  min-width: 0;
  font-weight: var(--weight-bold);
}

/* The avatar, with the dot on its corner and the numbers that rise from it. */
.face {
  position: relative;
  display: inline-flex;
  flex: none;
}

.dot {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 11px;
  height: 11px;
  border: var(--line-thin) solid var(--ink);
  border-radius: 50%;
  background: var(--neutral);
  pointer-events: none;
}

.dot.on {
  background: var(--online);
}

.label {
  display: inline-flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

/* The name and the rank give way; the marks never do. In their box, the rank shrinks first, down
   to nothing, since it is the only part that can: the name's box is clamped to the whole of theirs
   instead, so that it is cut short only once the rank is gone. What the box then still hides is the
   gap and the empty rank. */
.who {
  display: inline-flex;
  flex: 0 1 auto;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  overflow: hidden;
}

.name {
  flex: none;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.offline .name {
  color: var(--ink-2);
}

.rank {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  text-overflow: ellipsis;
  white-space: nowrap;
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
  white-space: nowrap;
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

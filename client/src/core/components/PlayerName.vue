<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ShownPlayer } from '../room';
import AgentIcon from './AgentIcon.vue';
import AvatarButton from './AvatarButton.vue';
import ScoreFloat, { type Shown } from './ScoreFloat.vue';

// A player's avatar and name with their online status, the academic rank of a player with an
// account, small beside the name, and marks for "you", the chair, an AI player, with the robot's
// head that is its avatar too, and a player whose turns an AI plays while they are away
// (docs/architecture.md#ai-players). In a room, the avatar opens the player's panel, for everyone,
// the viewer included (AvatarButton.vue); the name is plain text. A player who is offline has the
// avatar of someone the room waits for, faded, with three grey dots in it (PlayerAvatar.vue), and
// their name greyed; only a screen reader is told the word for it.
//
// On one line, which is the default, everything stays on it: where it is too long, the rank is cut
// short first, down to nothing, and only then the name, never the marks. `stacked`, in a list where
// the names have a column's width, as in the waiting room's groups and the game's rosters, it takes
// two lines: the name on the first, cut short where it is too long, and under it, smaller, the rank
// with the marks after it; marks that don't fit beside the rank go on to a line of their own, and
// the rank is cut short only when it is too long for a line by itself.
// A `float` is a number that rises from the avatar, what a card or the end of a game did to the
// player's points (ScoreFloat.vue).
const props = withDefaults(
  defineProps<{ player: ShownPlayer; me: boolean; chair: boolean; float?: Shown | null; stacked?: boolean }>(),
  { float: null, stacked: false },
);
const { t } = useI18n();
const rank = computed(() => (props.player.rank ? t(`ranks.names.${props.player.rank}`) : null));
const marked = computed(() => props.me || props.chair || !!props.player.agent || !!props.player.takenOver);
</script>

<template>
  <span class="player" :class="{ offline: !player.online, stacked }">
    <span class="face">
      <AvatarButton
        :player-id="player.id"
        :name="player.name"
        :username="player.username"
        :guest="player.guest"
        :avatar="player.avatar"
        :agent="player.agent !== undefined"
        :waiting="!player.online"
      />
      <ScoreFloat v-if="float" :key="float.key" :float="float" size="avatar" />
    </span>
    <span class="label">
      <span class="who">
        <span class="name">{{ player.name }}</span>
        <span v-if="rank && !stacked" class="rank">{{ rank }}</span>
      </span>
      <span v-if="marked || (stacked && rank)" class="marks">
        <span v-if="rank && stacked" class="rank">{{ rank }}</span>
        <span v-if="me" class="mark">{{ t('room.you') }}</span>
        <span v-if="chair" class="mark">{{ t('room.chair') }}</span>
        <span v-if="player.agent" class="mark agent"><AgentIcon />{{ t('room.agent') }}</span>
        <span v-if="player.takenOver" class="mark agent">{{ t('room.takenOver') }}</span>
      </span>
      <span v-if="!player.online" class="sr-only">{{ t('room.offline') }}</span>
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

/* The avatar, with the numbers that rise from it. */
.face {
  position: relative;
  display: inline-flex;
  flex: none;
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

.marks {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
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

/* An AI and the AI that plays for someone wear the same outlined mark, apart from the solid ones. */
.mark.agent {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  border: var(--line-thin) solid var(--ink);
  background: var(--paper);
  color: var(--ink);
}

/* Two lines: the name, and under it the rank and the marks, a row that wraps, so that the marks go
   on to a third line rather than squeeze the rank out; the rank alone on a line is cut short. */
.stacked .label {
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  line-height: 1.25;
}

.stacked .who {
  max-width: 100%;
}

.stacked .marks {
  flex: 0 1 auto;
  flex-wrap: wrap;
  gap: 2px var(--space-1);
  max-width: 100%;
  min-width: 0;
}

.stacked .rank {
  max-width: 100%;
  margin-right: var(--space-1);
}

.stacked .mark {
  line-height: 1.5;
}
</style>

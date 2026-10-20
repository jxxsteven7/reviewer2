<script setup lang="ts">
import type { Language, Seat, StartProblem } from '@reviewer2/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSpot, type SpotTarget } from '../../../core/guide/spot';
import { ROOM_ACTIONS } from '../../../core/useRoomPage';
import KeywordsLobby from '../KeywordsLobby.vue';
import { demoRoom, ME } from './demo';

// A step of the site's chapter on the waiting room: the game's own waiting room, of an invented
// room that Mira chairs, with three friends of hers. First Mira watches, with the red group's PI
// still to come; then she is its PI, and the groups are ready; last, the room is one with friends
// and Reviewer 1, with a seat for Reviewer 1 to take. Only to look at.
const props = defineProps<{ chapter: string; step: number }>();
const { t, locale } = useI18n();

const room = computed(() => {
  const language = locale.value as Language;
  const seats: Record<string, Seat> = {
    [ME]: { team: 'red', role: 'captain' },
    ava: { team: 'red', role: 'guesser' },
    theo: { team: 'blue', role: 'captain' },
    lin: { team: 'blue', role: 'guesser' },
  };
  if (props.step === 1) return demoRoom(t, language, { seats: { ...seats, [ME]: { team: null, role: 'spectator' } } });
  if (props.step < 4) return demoRoom(t, language, { seats });
  const problems: StartProblem[] = [{ problem: 'needs_guesser', team: 'blue' }];
  const players = demoRoom(t, language, { seats }).players.filter((player) => player.id !== 'lin');
  const seated = Object.fromEntries(Object.entries(seats).filter(([id]) => id !== 'lin'));
  return demoRoom(t, language, { seats: seated, players, agents: true, startProblems: problems });
});

const SPOTS: Record<number, SpotTarget> = {
  1: { selector: '.group.red .vacant-line .button', finger: 'point' },
  2: { selector: '.start-actions .button.primary', finger: 'point' },
  3: { selector: '.desk .section-title', finger: 'point' },
  4: { selector: '.group.blue .invite-agent', finger: 'point' },
};
const root = ref<HTMLElement | null>(null);
useSpot(root, () => SPOTS[props.step] ?? null);
</script>

<template>
  <div ref="root" class="lobby-scene" inert>
    <!-- The waiting room puts its reaction button in the room page's masthead, which isn't here. -->
    <span :id="ROOM_ACTIONS" hidden></span>
    <KeywordsLobby :room="room" />
  </div>
</template>

<style scoped>
/* The chair's start bar stays in its place here, below the tutorial's own bar at the top. */
.lobby-scene :deep(.start-dock) {
  position: static;
}
</style>

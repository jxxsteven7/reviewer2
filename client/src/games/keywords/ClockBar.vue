<script setup lang="ts">
import type { KeywordsView } from '@reviewer2/shared';
import { computed, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

// How long the current phase has left, as a bar that runs down and the seconds beside it. The
// server keeps the time and ends the phase (docs/games/keywords.md): every snapshot says how much
// time was left when it was sent, and the bar counts down from there, from when the snapshot
// arrived, until the next one sets it right again. It never ends anything itself, and stops at
// zero to wait for the server. The last 10 seconds are red.
const props = defineProps<{ clock: NonNullable<KeywordsView['clock']> }>();
const { t } = useI18n();

const URGENT_MS = 10_000;

// When the phase ends, by this page's own clock, and how much time is left until then. The clock
// moves on only when the seconds shown change, and the bar steps down with them rather than
// gliding: a bar that glides has the browser draw it again on every frame for as long as the phase
// lasts, on every page in the room.
let ends = 0;
const left = ref(0);
let timer: ReturnType<typeof setTimeout> | undefined;

// The seconds shown change when the time left falls to the next whole second. A timer keeps whole
// milliseconds and drops the rest, so the wait is rounded up: a timer that reads the clock a moment
// early sees a sliver of a second left and wakes up again right away.
function tick(): void {
  clearTimeout(timer);
  const ms = ends - performance.now();
  left.value = Math.max(0, ms);
  timer = ms > 0 ? setTimeout(tick, Math.ceil(ms % 1000) || 1000) : undefined;
}

watch(
  () => props.clock,
  (clock) => {
    ends = performance.now() + clock.left;
    tick();
  },
  { immediate: true },
);
onUnmounted(() => clearTimeout(timer));

const seconds = computed(() => Math.ceil(left.value / 1000));
const shown = computed(() => `${Math.floor(seconds.value / 60)}:${String(seconds.value % 60).padStart(2, '0')}`);
const share = computed(() => (props.clock.total > 0 ? left.value / props.clock.total : 0));
</script>

<template>
  <div class="clock" :class="{ urgent: left <= URGENT_MS }" role="timer" :aria-label="t('game.clock', { seconds })">
    <div class="track" aria-hidden="true">
      <div class="fill" :style="{ transform: `scaleX(${share})` }"></div>
    </div>
    <span class="seconds num" aria-hidden="true">{{ shown }}</span>
  </div>
</template>

<style scoped>
.clock {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.track {
  flex: 1;
  height: 12px;
  overflow: hidden;
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper-2);
}

.fill {
  height: 100%;
  background: var(--ink);
  transform-origin: left;
}

/* The seconds on an ink pill, as a clock on a wall. */
.seconds {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--on-ink);
  font-size: var(--text-lg);
  font-weight: var(--weight-display);
}

.urgent .fill {
  background: var(--red);
}

.urgent .seconds {
  background: var(--red);
  color: var(--on-red);
}
</style>

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
// Often enough for the seconds to change on time.
const TICK_MS = 250;

// When the phase ends, by this page's own clock, and what that clock says now.
const ends = ref(0);
const now = ref(performance.now());
watch(
  () => props.clock,
  (clock) => {
    now.value = performance.now();
    ends.value = now.value + clock.left;
  },
  { immediate: true },
);
const timer = setInterval(() => (now.value = performance.now()), TICK_MS);
onUnmounted(() => clearInterval(timer));

const left = computed(() => Math.max(0, ends.value - now.value));
const seconds = computed(() => Math.ceil(left.value / 1000));
const shown = computed(() => `${Math.floor(seconds.value / 60)}:${String(seconds.value % 60).padStart(2, '0')}`);
const share = computed(() => (props.clock.total > 0 ? left.value / props.clock.total : 0));
</script>

<template>
  <div class="clock" :class="{ urgent: left <= URGENT_MS }" role="timer" :aria-label="t('game.clock', { seconds })">
    <div class="track" aria-hidden="true">
      <div class="fill" :style="{ transform: `scaleX(${share})` }"></div>
    </div>
    <span class="seconds mono" aria-hidden="true">{{ shown }}</span>
  </div>
</template>

<style scoped>
.clock {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.track {
  flex: 1;
  height: 6px;
  overflow: hidden;
  background: var(--paper-2);
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
}

.fill {
  height: 100%;
  background: var(--ink-2);
  transform-origin: left;
  transition: transform 250ms linear;
}

.seconds {
  min-width: 3.5em;
  color: var(--ink-2);
  font-size: var(--text-sm);
  text-align: right;
}

.urgent .fill {
  background: var(--red);
}

.urgent .seconds {
  color: var(--red);
  font-weight: 600;
}

@media (prefers-reduced-motion: reduce) {
  .fill {
    transition: none;
  }
}
</style>

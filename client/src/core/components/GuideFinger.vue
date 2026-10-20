<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { spot } from '../guide/spot';

// The finger over a step's scene in the tutorial (spot.ts): one right hand, drawn here, the same
// everywhere, small enough to stay on a phone's screen at the last column of the board. Its tip is
// a little below the middle of the part, so that the part's word stays readable. It taps, with a
// ring that spreads from the tip, holds down, while a ring fills round the tip, or only nods at the
// part; it never takes a tap itself, and lies under the coach card and the chapter's bar. Where the
// device asks for less motion, it stands still. It follows the part as the page moves it about,
// and as the board settles after a card has turned over.
const root = ref<HTMLElement | null>(null);
const at = ref<{ x: number; y: number } | null>(null);
// Each new part starts the finger's motion afresh.
const shown = ref(0);

function place() {
  const current = spot.value;
  const host = root.value?.parentElement;
  if (!current || !host || !current.el.isConnected) {
    at.value = null;
    return;
  }
  const box = host.getBoundingClientRect();
  const rect = current.el.getBoundingClientRect();
  at.value = { x: rect.left - box.left + rect.width / 2, y: rect.top - box.top + rect.height * 0.72 };
}

// A card that turns over moves the board about for a moment.
const SETTLE_MS = 700;
let observer: ResizeObserver | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
watch(spot, (current) => {
  shown.value += 1;
  place();
  observer?.disconnect();
  if (root.value?.parentElement) observer?.observe(root.value.parentElement);
  if (current) observer?.observe(current.el);
  clearTimeout(timer);
  timer = setTimeout(place, SETTLE_MS);
});
onMounted(() => {
  observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
  if (root.value?.parentElement) observer?.observe(root.value.parentElement);
  if (spot.value) observer?.observe(spot.value.el);
  window.addEventListener('resize', place);
  place();
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener('resize', place);
  clearTimeout(timer);
});
</script>

<template>
  <div ref="root" class="finger-layer" aria-hidden="true">
    <div
      v-if="at && spot"
      :key="shown"
      class="finger"
      :class="spot.finger"
      :style="{ left: `${at.x}px`, top: `${at.y}px` }"
    >
      <span class="ripple"></span>
      <svg v-if="spot.finger === 'hold'" class="hold-ring" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" /></svg>
      <svg class="hand" viewBox="0 0 52 62">
        <path
          class="skin"
          d="M11 38V8a5.5 5.5 0 0 1 11 0v17a4.75 4.75 0 0 1 9.5 0v2a4.75 4.75 0 0 1 9.5 0v2a4 4 0 0 1 8 0v14c0 9-6.5 16-15.5 16h-5.5c-5.5 0-9-2.5-12-6.5L4.5 41.5a3.8 3.8 0 0 1 6-4.7Z"
        />
        <path class="fold" d="M22 25v5M31.5 27v4.5M41 29v4" />
      </svg>
    </div>
  </div>
</template>

<style scoped>
.finger-layer {
  position: absolute;
  inset: 0;
  z-index: 8;
  overflow-x: clip;
  pointer-events: none;
}

.finger {
  position: absolute;
  width: 0;
  height: 0;
}

/* The tip of the finger is at (16.5, 2.5) of the drawing, which is 44px wide. */
.hand {
  position: absolute;
  left: -14px;
  top: -2px;
  width: 44px;
  overflow: visible;
  filter: drop-shadow(2px 2px 0 var(--ink));
  transform-origin: 14px 2px;
}

.skin {
  fill: var(--paper);
  stroke: var(--ink);
  stroke-width: 2.6;
  stroke-linejoin: round;
}

.fold {
  fill: none;
  stroke: var(--ink);
  stroke-width: 2.2;
  stroke-linecap: round;
}

.ripple {
  position: absolute;
  left: -16px;
  top: -16px;
  width: 32px;
  height: 32px;
  border: 3px solid var(--ink);
  border-radius: 50%;
  background: color-mix(in srgb, var(--paper) 45%, transparent);
  opacity: 0;
}

.hold-ring {
  position: absolute;
  left: -20px;
  top: -20px;
  width: 40px;
  height: 40px;
  transform: rotate(-90deg);
}

.hold-ring circle {
  fill: color-mix(in srgb, var(--paper) 40%, transparent);
  stroke: var(--ink);
  stroke-width: 4;
  stroke-dasharray: 126;
  stroke-dashoffset: 126;
  stroke-linecap: round;
}

/* Tap: comes down, presses, a ring spreads from the tip, lifts off. */
.tap .hand {
  animation: finger-tap 1.6s ease-in-out infinite;
}

.tap .ripple {
  animation: finger-ripple 1.6s ease-out infinite;
}

@keyframes finger-tap {
  0%,
  100% {
    transform: translate(7px, 10px) rotate(-6deg);
  }

  35% {
    transform: translate(0, 0) rotate(-6deg);
  }

  45% {
    transform: translate(0, 0) rotate(-6deg) scale(0.86);
  }

  58% {
    transform: translate(0, 0) rotate(-6deg);
  }
}

@keyframes finger-ripple {
  0%,
  42% {
    opacity: 0;
    transform: scale(0.3);
  }

  46% {
    opacity: 1;
    transform: scale(0.45);
  }

  85%,
  100% {
    opacity: 0;
    transform: scale(1.5);
  }
}

/* Hold: comes down, stays pressed while a ring fills round the tip, lifts off. */
.hold .hand {
  animation: finger-hold 2.6s ease-in-out infinite;
}

.hold .hold-ring circle {
  animation: finger-fill 2.6s linear infinite;
}

@keyframes finger-hold {
  0%,
  100% {
    transform: translate(7px, 10px) rotate(-6deg);
  }

  22% {
    transform: translate(0, 0) rotate(-6deg);
  }

  28%,
  76% {
    transform: translate(0, 0) rotate(-6deg) scale(0.86);
  }

  84% {
    transform: translate(0, 0) rotate(-6deg);
  }
}

@keyframes finger-fill {
  0%,
  28% {
    opacity: 1;
    stroke-dashoffset: 126;
  }

  74% {
    opacity: 1;
    stroke-dashoffset: 0;
  }

  86%,
  100% {
    opacity: 0;
    stroke-dashoffset: 0;
  }
}

/* Point: hovers at the spot and nods towards it, with no press. */
.point .hand {
  animation: finger-point 1.4s ease-in-out infinite alternate;
}

@keyframes finger-point {
  from {
    transform: translate(2px, 3px) rotate(-6deg);
  }

  to {
    transform: translate(6px, 9px) rotate(-6deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .hand,
  .ripple,
  .hold-ring circle {
    animation: none !important;
  }

  .hand {
    transform: translate(3px, 5px) rotate(-6deg);
  }
}
</style>

<script setup lang="ts">
import { encode } from 'uqr';
import { computed } from 'vue';

// A QR code drawn as one SVG path, so it stays sharp on a projector.
const props = defineProps<{ text: string; label: string }>();

const qr = computed(() => {
  const { size, data } = encode(props.text, { ecc: 'M', border: 2 });
  let path = '';
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return { size, path };
});
</script>

<template>
  <svg class="qr" :viewBox="`0 0 ${qr.size} ${qr.size}`" role="img" :aria-label="label" shape-rendering="crispEdges">
    <rect :width="qr.size" :height="qr.size" class="light" />
    <path :d="qr.path" class="dark" />
  </svg>
</template>

<style scoped>
.qr {
  display: block;
  width: 100%;
  max-width: 16rem;
  height: auto;
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-card);
  background: var(--paper);
}

.light {
  fill: var(--paper);
}

.dark {
  fill: var(--ink);
}
</style>

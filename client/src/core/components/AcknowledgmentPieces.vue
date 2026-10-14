<script setup lang="ts">
import type { AcknowledgmentPiece } from '@reviewer2/shared';

// The pieces of a line of the acknowledgments (AcknowledgmentsList.vue): text, bold, italic, and
// links, which open in a new tab and only to an https page. All of it is text, never markup.
defineProps<{ pieces: readonly AcknowledgmentPiece[] }>();
</script>

<template>
  <template v-for="(piece, at) in pieces" :key="at">
    <a
      v-if="piece.kind === 'link' && piece.href.startsWith('https://')"
      :href="piece.href"
      target="_blank"
      rel="nofollow ugc noopener"
      >{{ piece.text }}</a
    >
    <strong v-else-if="piece.kind === 'strong'">{{ piece.text }}</strong>
    <em v-else-if="piece.kind === 'em'">{{ piece.text }}</em>
    <template v-else>{{ piece.text }}</template>
  </template>
</template>

<style scoped>
/* Links and bold text stand out from the quieter text around them. */
a,
strong {
  color: var(--ink);
}
</style>

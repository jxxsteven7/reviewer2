<script setup lang="ts">
// A word that a game shows on its own, as the first game's clue and the second game's word: a
// yellow sticker with the strong outline and no shadow, since it can't be pressed, in bold type.
</script>

<template>
  <span class="word"><slot /></span>
</template>

<style scoped>
.word {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--bg);
  font-size: var(--text-xl);
  font-weight: var(--weight-black);
  overflow-wrap: anywhere;
}
</style>

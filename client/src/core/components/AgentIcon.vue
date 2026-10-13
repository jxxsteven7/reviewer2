<script setup lang="ts">
// A small robot's head, drawn here, which marks an AI player (docs/architecture.md#ai-players):
// an antenna, a boxy head with an ear each side, two round eyes and a flat mouth, cut out of the
// head so that it shows whatever is behind, in the ink of the text around it. It is decoration
// beside a word that says the same, so a screen reader skips it.
</script>

<template>
  <svg class="agent-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="2.5" r="1.7" />
    <path d="M11.2 3.5h1.6V6h-1.6z" />
    <path d="M1 10.5h2.4v5H1zM20.6 10.5H23v5h-2.6z" />
    <path
      fill-rule="evenodd"
      d="M7.2 6h9.6A3.2 3.2 0 0 1 20 9.2v7.6a3.2 3.2 0 0 1-3.2 3.2H7.2A3.2 3.2 0 0 1 4 16.8V9.2A3.2 3.2 0 0 1 7.2 6zm1.6 7.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zm6.4 0a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM9 15.6a.8.8 0 0 0 0 1.6h6a.8.8 0 0 0 0-1.6z"
    />
  </svg>
</template>

<style scoped>
.agent-icon {
  display: inline-block;
  flex: none;
  width: 1em;
  height: 1em;
  fill: currentcolor;
  vertical-align: -0.15em;
}
</style>

<script setup lang="ts">
// The arrow at the end of a link that leads off the site (docs/rules/display.md): the link on a player's
// page, the GitHub username and the way to GitHub's contributors among the contributions, and the
// version at the foot of the home page. It is drawn in the link's own color and says nothing to a
// screen reader, since the link's text does; the link that holds it moves it out under a pointer
// and further under a press.
</script>

<template>
  <svg class="arrow" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
    <path d="M3.5 8.5 8.5 3.5M4.5 3.5h4v4" />
  </svg>
</template>

<style scoped>
.arrow {
  position: relative;
  top: -1px;
  flex: none;
  width: 0.8em;
  height: 0.8em;
  fill: none;
  stroke: currentcolor;
  stroke-width: 2.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform var(--motion);
}
</style>

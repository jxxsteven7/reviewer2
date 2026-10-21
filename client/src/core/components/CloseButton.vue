<script setup lang="ts">
// A round × that closes or dismisses what it stands on, outside a sheet, as a sheet's head has one
// (UiSheet.vue): a white circle of 44 px with the outline, the hard shadow and the press. Its label
// says what it does.
defineProps<{ label: string; disabled?: boolean }>();
</script>

<template>
  <button type="button" class="close-button press" :aria-label="label" :disabled="disabled">&times;</button>
</template>

<style scoped>
.close-button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: var(--line) solid var(--ink);
  border-radius: 50%;
  background: var(--paper);
  box-shadow: var(--shadow-1);
  color: var(--ink);
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
}

.close-button:focus-visible {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}
</style>

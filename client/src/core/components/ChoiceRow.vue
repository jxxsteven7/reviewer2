<script setup lang="ts">
// One choice of a form as a row (docs/rules/display.md#choices-and-fields): the radio or the
// checkbox, which the slot holds with its v-model, at the start; the option in bold beside it; and
// a hint in grey under the option. The chosen row turns yellow, and one that can't be chosen now is
// grey.
defineProps<{ option: string; hint?: string }>();
</script>

<template>
  <label class="choice-row">
    <slot />
    <span class="option">{{ option }}</span>
    <span v-if="hint" class="hint">{{ hint }}</span>
  </label>
</template>

<style scoped>
.choice-row {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0 var(--space-3);
  min-height: 52px;
  padding: var(--space-2) var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--paper);
  cursor: pointer;
}

.choice-row:has(input:checked) {
  background: var(--bg);
}

.choice-row:has(input:disabled) {
  color: var(--ink-2);
  cursor: default;
}

.choice-row:has(input:focus-visible) {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.choice-row > :slotted(input) {
  width: 20px;
  height: 20px;
  margin: 0;
  accent-color: var(--ink);
}

.option {
  font-weight: var(--weight-black);
}

.hint {
  grid-column: 2;
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>

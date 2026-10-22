<script setup lang="ts" generic="T extends string | number">
import { useId } from 'vue';

// One of a few fixed values to pick, as pills (docs/rules/display.md): a fieldset with its legend,
// a radio in each pill, the chosen one yellow, and under them whatever the form has to say of the
// choice, such as a hint (the slot). The first game picks its match options with it
// (keywords/MatchOptions.vue), and the match form the number of games of a match of the second
// game (MatchForm.vue).
defineProps<{ legend: string; options: readonly { value: T; label: string }[] }>();
const model = defineModel<T>({ required: true });
const id = useId();
</script>

<template>
  <fieldset>
    <legend>{{ legend }}</legend>
    <div class="options">
      <label v-for="option in options" :key="option.value" :class="{ chosen: model === option.value }">
        <input
          type="radio"
          :name="id"
          :value="option.value"
          :checked="model === option.value"
          @change="model = option.value"
        />
        {{ option.label }}
      </label>
    </div>
    <slot />
  </fieldset>
</template>

<style scoped>
fieldset {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

legend {
  margin-bottom: var(--space-2);
  padding: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.options label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: 0 var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
  font-weight: var(--weight-bold);
  cursor: pointer;
}

.options label.chosen {
  background: var(--bg);
}

.options label:focus-within {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.options input {
  margin: 0;
  accent-color: var(--ink);
}
</style>

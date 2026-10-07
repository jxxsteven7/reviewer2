<script setup lang="ts">
import { useId } from 'vue';

// A labelled text input, with an optional hint and error below it.
defineProps<{
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  placeholder?: string;
  maxlength?: number;
  autocomplete?: string;
  inputmode?: 'text' | 'search' | 'none';
  enterkeyhint?: 'done' | 'go' | 'send' | 'next' | 'search';
  autocapitalize?: 'off' | 'characters' | 'words' | 'sentences';
  spellcheck?: boolean;
  prefix?: string;
}>();
const model = defineModel<string>({ required: true });
const id = useId();
</script>

<template>
  <div class="field" :class="{ invalid: error }">
    <label :for="id" class="label">{{ label }}</label>
    <div class="control">
      <span v-if="prefix" class="prefix" aria-hidden="true">{{ prefix }}</span>
      <input
        :id="id"
        v-model="model"
        :placeholder="placeholder"
        :maxlength="maxlength"
        :autocomplete="autocomplete ?? 'off'"
        :inputmode="inputmode"
        :enterkeyhint="enterkeyhint"
        :autocapitalize="autocapitalize ?? 'off'"
        :spellcheck="spellcheck ?? false"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error || hint ? `${id}-note` : undefined"
      />
    </div>
    <p v-if="error || hint" :id="`${id}-note`" class="note" :class="{ error }">{{ error || hint }}</p>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.label {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.control {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--ink-3);
  border-radius: var(--radius-control);
  background: var(--paper);
}

.control:focus-within {
  border-color: var(--ink);
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.invalid .control {
  border-color: var(--red);
}

.prefix {
  display: flex;
  align-items: center;
  padding-left: var(--space-3);
  color: var(--ink-3);
  font-family: var(--font-mono);
}

input {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 0 var(--space-3);
  border: 0;
  background: none;
  color: var(--ink);
  /* 16px keeps iOS from zooming in on focus */
  font: inherit;
  font-size: max(16px, var(--text-md));
  outline: none;
}

.prefix + input {
  padding-left: var(--space-1);
  font-family: var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.note {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.note.error {
  color: var(--red);
}
</style>

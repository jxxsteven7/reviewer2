<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';

// A labelled text input, with an optional hint and error below it. With `multiline`, it is a text
// area of `rows` lines, which the player can make taller. A password field has a button that
// shows what is typed, for typing a long password on a phone.
const props = defineProps<{
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  placeholder?: string;
  maxlength?: number;
  autocomplete?: string;
  inputmode?: 'text' | 'search' | 'numeric' | 'url' | 'none';
  enterkeyhint?: 'done' | 'go' | 'send' | 'next' | 'search';
  autocapitalize?: 'off' | 'characters' | 'words' | 'sentences';
  spellcheck?: boolean;
  prefix?: string;
  multiline?: boolean;
  rows?: number;
  type?: 'text' | 'password' | 'email';
}>();
const model = defineModel<string>({ required: true });
const id = useId();
const { t } = useI18n();
const shown = ref(false);
const inputType = computed(() => (props.type === 'password' && shown.value ? 'text' : (props.type ?? 'text')));
</script>

<template>
  <div class="field" :class="{ invalid: error }">
    <label :for="id" class="label">{{ label }}</label>
    <div class="control">
      <span v-if="prefix" class="prefix num" aria-hidden="true">{{ prefix }}</span>
      <textarea
        v-if="multiline"
        :id="id"
        v-model="model"
        :rows="rows ?? 4"
        :placeholder="placeholder"
        :maxlength="maxlength"
        :autocomplete="autocomplete ?? 'off'"
        :inputmode="inputmode"
        :autocapitalize="autocapitalize ?? 'off'"
        :spellcheck="spellcheck ?? false"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error || hint ? `${id}-note` : undefined"
      ></textarea>
      <input
        v-else
        :id="id"
        v-model="model"
        :type="inputType"
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
      <button v-if="type === 'password'" type="button" class="show" :aria-pressed="shown" @click="shown = !shown">
        {{ t(shown ? 'account.hidePassword' : 'account.showPassword') }}
      </button>
    </div>
    <p v-if="error || hint" :id="`${id}-note`" class="note" :class="{ error }">{{ error || hint }}</p>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.label {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.control {
  display: flex;
  align-items: stretch;
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--paper);
}

.control:focus-within {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.invalid .control {
  border-color: var(--red-deep);
}

.prefix {
  display: flex;
  align-items: center;
  padding-left: var(--space-4);
  color: var(--ink-2);
  font-size: var(--text-lg);
  font-weight: var(--weight-display);
  letter-spacing: 0.08em;
}

input,
textarea {
  flex: 1;
  min-width: 0;
  min-height: 50px;
  padding: 0 var(--space-4);
  border: 0;
  border-radius: inherit;
  background: none;
  color: var(--ink);
  /* 16px keeps iOS from zooming in */
  font: inherit;
  font-size: max(16px, var(--text-md));
  font-weight: var(--weight-bold);
  outline: none;
}

input::placeholder,
textarea::placeholder {
  color: var(--ink-2);
  font-weight: var(--weight-text);
  opacity: 0.7;
}

textarea {
  padding: var(--space-3) var(--space-4);
  line-height: 1.45;
  resize: vertical;
}

.prefix + input {
  padding-left: var(--space-1);
  font-family: var(--font-number);
  font-size: max(16px, var(--text-lg));
  font-weight: var(--weight-display);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.show {
  flex: none;
  min-width: 44px;
  padding: 0 var(--space-4);
  border: 0;
  background: none;
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  cursor: pointer;
}

.note {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.note.error {
  color: var(--red-deep);
  font-weight: var(--weight-bold);
}
</style>

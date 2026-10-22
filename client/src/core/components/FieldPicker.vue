<script setup lang="ts">
import type { FieldInfo, Language } from '@reviewer2/shared';
import { useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { gameInfo } from '../../games/info';

// Choosing the word lists for a room of a game. A list without enough words in the room's language
// for the game (GameInfo.usable) can't be chosen, and none can while the picker is `disabled`, as
// when the room draws its lists for every game; what is chosen still shows, greyed out. Each list
// says how many terms it has, or for a game of pairs how many pairs. A `single` list is chosen
// alone, as the field of a setter's words, which may be any.

const props = withDefaults(
  defineProps<{ fields: FieldInfo[]; language: Language; game: string; disabled?: boolean; single?: boolean }>(),
  { disabled: false, single: false },
);
const model = defineModel<string[]>({ required: true });
const { t } = useI18n();

const group = useId();
const usable = (field: FieldInfo) => props.single || (gameInfo(props.game)?.usable(field, props.language) ?? false);
const pairs = () => gameInfo(props.game)?.pairs === true;

function toggle(id: string, on: boolean) {
  if (props.single) model.value = [id];
  else model.value = on ? [...model.value, id] : model.value.filter((other) => other !== id);
}
</script>

<template>
  <ul class="fields">
    <li v-for="field in fields" :key="field.id">
      <label :class="{ disabled: disabled || !usable(field) }">
        <input
          :type="single ? 'radio' : 'checkbox'"
          :name="single ? group : undefined"
          :checked="model.includes(field.id)"
          :disabled="disabled || !usable(field)"
          @change="toggle(field.id, ($event.target as HTMLInputElement).checked)"
        />
        <span class="name">{{ field.name[language] }}</span>
        <span v-if="!single" class="count">
          {{
            pairs()
              ? usable(field)
                ? t('create.fieldPairs', { count: field.pairs })
                : t('create.fieldNoPairs')
              : usable(field)
                ? t('create.fieldTerms', { count: field.counts[language] })
                : t('create.fieldTooSmall')
          }}
        </span>
      </label>
    </li>
  </ul>
</template>

<style scoped>
.fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

label {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 48px;
  padding: var(--space-1) var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--paper);
  font-weight: var(--weight-bold);
  cursor: pointer;
}

label:has(input:checked) {
  background: var(--bg);
}

label:has(input:focus-visible) {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

label.disabled,
label.disabled:has(input:checked) {
  border-color: var(--neutral);
  background: var(--paper-2);
  color: var(--ink-2);
  cursor: not-allowed;
}

input {
  width: 20px;
  height: 20px;
  margin: 0;
  accent-color: var(--ink);
}

.name {
  flex: 1;
}

.count {
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-text);
  text-align: right;
}
</style>

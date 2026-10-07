<script setup lang="ts">
import type { FieldInfo, Language } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';

// Choosing the word lists for a room. A list without enough words in the room's language can't
// be chosen.

const props = defineProps<{ fields: FieldInfo[]; language: Language; needed: number }>();
const model = defineModel<string[]>({ required: true });
const { t } = useI18n();

const usable = (field: FieldInfo) => field.counts[props.language] >= props.needed;

function toggle(id: string, on: boolean) {
  model.value = on ? [...model.value, id] : model.value.filter((other) => other !== id);
}
</script>

<template>
  <ul class="fields">
    <li v-for="field in fields" :key="field.id">
      <label :class="{ disabled: !usable(field) }">
        <input
          type="checkbox"
          :checked="model.includes(field.id)"
          :disabled="!usable(field)"
          @change="toggle(field.id, ($event.target as HTMLInputElement).checked)"
        />
        <span class="name">{{ field.name[language] }}</span>
        <span class="count">
          {{ usable(field) ? t('create.fieldTerms', { count: field.counts[language] }) : t('create.fieldTooSmall') }}
        </span>
      </label>
    </li>
  </ul>
</template>

<style scoped>
.fields {
  margin: 0;
  padding: 0;
  list-style: none;
}

li + li {
  border-top: 1px solid var(--rule);
}

label {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 48px;
  cursor: pointer;
}

label.disabled {
  color: var(--ink-3);
  cursor: not-allowed;
}

input {
  width: 18px;
  height: 18px;
  accent-color: var(--ink);
}

.name {
  flex: 1;
}

.count {
  color: var(--ink-3);
  font-size: var(--text-sm);
}
</style>

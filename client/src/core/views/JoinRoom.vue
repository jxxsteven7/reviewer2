<script setup lang="ts">
import { CODE_PREFIX, parseCode } from '@reviewer2/shared';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import UiButton from '../components/UiButton.vue';
import UiField from '../components/UiField.vue';

// Joining by the manuscript number, read as the server reads it. The room page takes it from there.
const { t } = useI18n();
const router = useRouter();
const code = ref('');
const error = ref<string | undefined>();

function join() {
  const parsed = parseCode(code.value);
  if (!parsed) {
    error.value = t('home.join.invalid');
    return;
  }
  void router.push(`/room/${parsed}`);
}
</script>

<template>
  <form class="join" @submit.prevent="join">
    <UiField
      v-model="code"
      :label="t('home.join.label')"
      :prefix="CODE_PREFIX"
      :placeholder="t('home.join.placeholder')"
      :maxlength="8"
      autocapitalize="characters"
      enterkeyhint="go"
      :error="error"
    />
    <UiButton variant="blue" type="submit">{{ t('home.join.submit') }}</UiButton>
  </form>
</template>

<style scoped>
.join {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--space-2) var(--space-3);
  max-width: 24rem;
}

/* The field's label takes the whole row, however long it is in either language, and the button
   stands level with the box below it, with the field's note under the box. */
.join > :deep(.field) {
  display: contents;
}

.join > :deep(.field > .label) {
  grid-column: 1 / -1;
}

.join > :deep(.field > .note) {
  grid-column: 1;
}

.join > button {
  grid-row: 2;
  grid-column: 2;
  min-height: 56px;
}
</style>

<script setup lang="ts">
import { parseCode } from '@reviewer2/shared';
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
      prefix="R2-"
      :placeholder="t('home.join.placeholder')"
      :maxlength="8"
      autocapitalize="characters"
      enterkeyhint="go"
      :error="error"
    />
    <UiButton type="submit">{{ t('home.join.submit') }}</UiButton>
  </form>
</template>

<style scoped>
.join {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}

.join > :first-child {
  flex: 1;
  max-width: 14rem;
}

.join > button {
  margin-top: calc(var(--text-sm) * 1.55 + var(--space-1));
}
</style>

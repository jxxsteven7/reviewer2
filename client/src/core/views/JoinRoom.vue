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
    >
      <template #beside>
        <UiButton variant="primary" type="submit">{{ t('home.join.submit') }}</UiButton>
      </template>
    </UiField>
  </form>
</template>

<style scoped>
/* The button stands beside the box, in the field's slot, as tall as the box. */
.join {
  max-width: 24rem;
}
</style>

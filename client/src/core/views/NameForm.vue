<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../components/UiButton.vue';
import UiField from '../components/UiField.vue';
import { errorKey } from '../errors';
import { submitName } from '../room';
import { storedName, storeName } from '../session';

// A newcomer gives a nickname before joining. The page is already in the room's language.
const props = defineProps<{ code: string }>();
const { t } = useI18n();
const name = ref(storedName());
const error = ref<string | undefined>();
const busy = ref(false);

async function join() {
  error.value = undefined;
  busy.value = true;
  const reply = await submitName(name.value);
  busy.value = false;
  if (reply.ok) storeName(name.value.trim());
  else error.value = t(errorKey(reply.error));
}
</script>

<template>
  <form class="name-form" @submit.prevent="join">
    <h1>{{ t('room.join.title', { code: `R2-${props.code}` }) }}</h1>
    <UiField
      v-model="name"
      :label="t('room.join.name')"
      :maxlength="32"
      autocomplete="nickname"
      enterkeyhint="go"
      :error="error"
    />
    <UiButton variant="primary" type="submit" :disabled="busy || !name.trim()">{{ t('room.join.submit') }}</UiButton>
  </form>
</template>

<style scoped>
.name-form {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-4);
  max-width: 22rem;
  padding: var(--space-6) 0;
}

.name-form > :deep(.field) {
  align-self: stretch;
}

h1 {
  font-size: var(--text-2xl);
}
</style>

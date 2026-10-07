<script setup lang="ts">
import { formatCode, MAX_NAME_INPUT, parseCode } from '@reviewer2/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../components/UiButton.vue';
import UiField from '../components/UiField.vue';
import { submitName } from '../room';
import { storedName, storeName } from '../session';
import { useNameField } from '../useNameField';

// A newcomer gives a nickname before joining. The page is already in the room's language. A name
// that the server refuses comes back here with the reason, for another try.
const props = defineProps<{ code: string }>();
const { t } = useI18n();
const { name, clean, problem, refuse } = useNameField(storedName());
const busy = ref(false);
// The code as the address gives it may be in any case, or carry the prefix already.
const number = computed(() => formatCode(parseCode(props.code) ?? props.code));

async function join() {
  busy.value = true;
  const reply = await submitName(name.value);
  busy.value = false;
  if (reply.ok) storeName(clean.value ?? name.value.trim());
  else refuse(reply.error);
}
</script>

<template>
  <form class="name-form" @submit.prevent="join">
    <h1>{{ t('room.join.title', { code: number }) }}</h1>
    <UiField
      v-model="name"
      :label="t('room.join.name')"
      :maxlength="MAX_NAME_INPUT"
      autocomplete="nickname"
      enterkeyhint="go"
      :error="problem"
    />
    <UiButton variant="primary" type="submit" :disabled="busy || !clean">{{ t('room.join.submit') }}</UiButton>
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

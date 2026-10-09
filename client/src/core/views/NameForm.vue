<script setup lang="ts">
import { formatCode, MAX_NAME_INPUT, parseCode } from '@reviewer2/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { account } from '../account';
import PlayChoice from '../components/PlayChoice.vue';
import PlayerAvatar from '../components/PlayerAvatar.vue';
import UiButton from '../components/UiButton.vue';
import UiField from '../components/UiField.vue';
import { errorKey } from '../errors';
import { submitName } from '../room';
import { storedName, storeName } from '../session';
import { useBusy } from '../useBusy';
import { useNameField } from '../useNameField';

// A newcomer gives a nickname before joining, and says whether they have come to play or only to
// watch. The page is already in the room's language. A name that the server refuses comes back
// here with the reason, for another try. A newcomer who is logged in joins with their username,
// and is shown what the server had against that below the form, since there is no field for it.
const props = defineProps<{ code: string }>();
const { t } = useI18n();
const { name, clean, problem, refuse } = useNameField(storedName());
const formError = ref<string | undefined>();
const play = ref(true);
const { busy, run } = useBusy();
// The code as the address gives it may be in any case, or carry the prefix already.
const number = computed(() => formatCode(parseCode(props.code) ?? props.code));

async function join() {
  formError.value = undefined;
  const reply = await run(() => submitName(account.summary ? undefined : name.value, play.value));
  if (!reply) return;
  if (reply.ok) {
    if (!account.summary) storeName(clean.value ?? name.value.trim());
  } else if (account.summary) {
    formError.value = t(errorKey(reply.error));
  } else {
    refuse(reply.error);
  }
}
</script>

<template>
  <form class="name-form" @submit.prevent="join">
    <h1>{{ t('room.join.title', { code: number }) }}</h1>
    <i18n-t v-if="account.summary" keypath="account.as" tag="p" class="as" scope="global">
      <template #name>
        <PlayerAvatar :name="account.summary.username" :avatar="account.summary.avatar" />
        <strong>{{ account.summary.username }}</strong>
      </template>
    </i18n-t>
    <UiField
      v-else
      v-model="name"
      :label="t('room.join.name')"
      :maxlength="MAX_NAME_INPUT"
      autocomplete="nickname"
      enterkeyhint="go"
      :error="problem"
    />
    <PlayChoice v-model="play" />
    <p v-if="formError" class="problem" role="alert">{{ formError }}</p>
    <UiButton variant="primary" type="submit" :disabled="busy || !(clean || account.summary)">
      {{ t('room.join.submit') }}
    </UiButton>
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

.as {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.problem {
  color: var(--red);
  font-size: var(--text-sm);
}
</style>

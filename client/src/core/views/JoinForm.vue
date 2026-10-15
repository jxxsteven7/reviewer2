<script setup lang="ts">
import { formatCode, parseCode } from '@reviewer2/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { account } from '../account';
import PlayChoice from '../components/PlayChoice.vue';
import PlayerAvatar from '../components/PlayerAvatar.vue';
import UiButton from '../components/UiButton.vue';
import { errorKey } from '../errors';
import { submitChoice } from '../room';
import { useBusy } from '../useBusy';

// A newcomer says whether they have come to play or only to watch before joining. Nobody gives a
// name: a newcomer who is logged in joins with their username, which the form shows, and a guest
// as the guest the room numbers them. The page is already in the room's language. What the server
// had against joining shows below the form, for another try.
const props = defineProps<{ code: string }>();
const { t } = useI18n();
const formError = ref<string | undefined>();
const play = ref(true);
const { busy, run } = useBusy();
// The code as the address gives it may be in any case, or carry the prefix already.
const number = computed(() => formatCode(parseCode(props.code) ?? props.code));

async function join() {
  formError.value = undefined;
  const reply = await run(() => submitChoice(play.value));
  if (reply && !reply.ok) formError.value = t(errorKey(reply.error));
}
</script>

<template>
  <form class="join-form" @submit.prevent="join">
    <h1>{{ t('room.join.title', { code: number }) }}</h1>
    <i18n-t v-if="account.summary" keypath="account.as" tag="p" class="as" scope="global">
      <template #name>
        <PlayerAvatar :name="account.summary.username" :avatar="account.summary.avatar" />
        <strong>{{ account.summary.username }}</strong>
      </template>
    </i18n-t>
    <PlayChoice v-model="play" />
    <p v-if="formError" class="problem" role="alert">{{ formError }}</p>
    <UiButton variant="primary" type="submit" :disabled="busy">
      {{ t('room.join.submit') }}
    </UiButton>
  </form>
</template>

<style scoped>
.join-form {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-4);
  max-width: 26rem;
  margin: var(--space-5) 0;
  padding: var(--space-5) var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
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
  color: var(--red-deep);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}
</style>

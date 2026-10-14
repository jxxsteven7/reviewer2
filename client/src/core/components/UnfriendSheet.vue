<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { answerFriend } from '../friends';
import { useBusy } from '../useBusy';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';

// The sheet that asks an account whether it means to end a friendship (docs/architecture.md#friends)
// before it does, from the friend's card on the account page and from wherever the friend's panel
// or page offers it (FriendActions.vue). The sheet says `removed` once the friendship is over; after
// a refusal, which the player is told of, it closes.
const props = defineProps<{ open: boolean; username: string }>();
const emit = defineEmits<{ close: []; removed: [] }>();
const { t } = useI18n();
const { busy, run } = useBusy();

async function remove() {
  const done = await run(() => answerFriend(props.username, 'remove'));
  if (done === undefined) return;
  if (done) emit('removed');
  else emit('close');
}
</script>

<template>
  <UiSheet :open="open" :title="username" @close="emit('close')">
    <div class="unfriend">
      <p>{{ t('friends.removeConfirm', { name: username }) }}</p>
      <UiButton variant="danger" :disabled="busy" @click="remove">{{ t('friends.removeFriend') }}</UiButton>
      <UiButton variant="quiet" @click="emit('close')">{{ t('account.cancel') }}</UiButton>
    </div>
  </UiSheet>
</template>

<style scoped>
.unfriend {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
</style>

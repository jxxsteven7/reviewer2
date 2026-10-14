<script setup lang="ts">
import { checkFriendNote, FRIEND_NOTE_LENGTH, MAX_FRIEND_NOTE_INPUT, textLength } from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { errorKey } from '../errors';
import { requestFriend } from '../friends';
import { useBusy } from '../useBusy';
import UiButton from './UiButton.vue';
import UiField from './UiField.vue';
import UiSheet from './UiSheet.vue';

// The sheet in which an account asks another to be friends (docs/architecture.md#friends), the same
// from a room's player panel, from the search on the account page and from a public page: its title
// names them, and a line for them may go with the request, which the keyboard comes up for only on
// a tap, since most send none. `who` is how the server finds them, by username or by their seat in
// the room. The player hears how it went (requestFriend), and the sheet says `sent` once the
// request has gone through; each time it opens, it starts with no line.
const props = defineProps<{ open: boolean; name: string; who: { username: string } | { playerId: string } }>();
const emit = defineEmits<{ close: []; sent: [] }>();
const { t } = useI18n();
const { busy, run } = useBusy();
const note = ref('');
const checked = computed(() => checkFriendNote(note.value));
const problem = computed(() => (checked.value.problem ? t(errorKey(checked.value.problem)) : undefined));
const count = computed(() =>
  t('friends.noteCount', { count: textLength(checked.value.note ?? ''), max: FRIEND_NOTE_LENGTH }),
);

watch(
  () => props.open,
  (open) => {
    if (open) note.value = '';
  },
);

async function ask() {
  if (checked.value.problem) return;
  if (await run(() => requestFriend(props.who, checked.value.note))) emit('sent');
}
</script>

<template>
  <UiSheet :open="open" :title="t('friends.addTitle', { name })" :focus-input="false" @close="emit('close')">
    <form class="befriend" @submit.prevent="ask">
      <UiField
        v-model="note"
        :label="t('friends.noteLabel')"
        :maxlength="MAX_FRIEND_NOTE_INPUT"
        autocomplete="off"
        enterkeyhint="send"
        :hint="count"
        :error="problem"
      />
      <UiButton variant="primary" type="submit" :disabled="busy || checked.problem !== null">
        {{ t('friends.addSubmit') }}
      </UiButton>
      <UiButton variant="quiet" @click="emit('close')">{{ t('account.cancel') }}</UiButton>
    </form>
  </UiSheet>
</template>

<style scoped>
.befriend {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
</style>

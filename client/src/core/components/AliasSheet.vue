<script setup lang="ts">
import { checkAlias, MAX_FRIEND_ALIAS_INPUT } from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { errorKey } from '../errors';
import { send } from '../socket';
import { useBusy } from '../useBusy';
import UiButton from './UiButton.vue';
import UiField from './UiField.vue';
import UiSheet from './UiSheet.vue';

// The sheet in which an account gives a friend a name of its own (docs/architecture.md#friends), or
// takes it away by leaving it empty, from the friend's card on the account page and from wherever
// the friend's panel or page offers it (FriendActions.vue). It opens with the name the friend has,
// says what is wrong with a new one as it is typed, by the rules that the server applies
// (checkAlias), and what the server had against it; the sheet says `saved` once it is kept, and the
// server tells the account's pages, whose lists show it.
const props = defineProps<{ open: boolean; username: string; alias: string | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const { t } = useI18n();
const { busy, run } = useBusy();
const typed = ref('');
const refused = ref<string | undefined>();
const checked = computed(() => checkAlias(typed.value));
const problem = computed(
  () => refused.value ?? (checked.value.problem ? t(errorKey(checked.value.problem)) : undefined),
);
watch(typed, () => (refused.value = undefined));
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    typed.value = props.alias ?? '';
    refused.value = undefined;
  },
  { immediate: true },
);

async function save() {
  if (checked.value.problem) return;
  const reply = await run(() => send('friends:alias', { username: props.username, alias: typed.value }));
  if (!reply) return;
  if (!reply.ok) {
    refused.value = t(errorKey(reply.error));
    return;
  }
  emit('saved');
}
</script>

<template>
  <UiSheet :open="open" :title="t('friends.aliasTitle', { name: username })" @close="emit('close')">
    <form class="alias" @submit.prevent="save">
      <UiField
        v-model="typed"
        :label="t('friends.aliasLabel')"
        :maxlength="MAX_FRIEND_ALIAS_INPUT"
        autocomplete="off"
        enterkeyhint="done"
        :hint="t('friends.aliasHint')"
        :error="problem"
      />
      <UiButton variant="primary" type="submit" :disabled="busy || checked.problem !== null">
        {{ t('friends.aliasSave') }}
      </UiButton>
      <UiButton variant="quiet" @click="emit('close')">{{ t('account.cancel') }}</UiButton>
    </form>
  </UiSheet>
</template>

<style scoped>
.alias {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
</style>

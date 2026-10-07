<script setup lang="ts">
import type { PlayerView } from '@reviewer2/shared';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import UiButton from '../components/UiButton.vue';
import UiField from '../components/UiField.vue';
import UiSheet from '../components/UiSheet.vue';
import { errorKey } from '../errors';
import { leaveRoom } from '../room';
import { storeName } from '../session';
import { send } from '../socket';
import { toastError } from '../toast';

// Footnotes of the room page: who you are, and ways to rename yourself or leave.
const props = defineProps<{ me: PlayerView }>();
const { t } = useI18n();
const router = useRouter();
const renaming = ref(false);
const leaving = ref(false);
const name = ref('');
const error = ref<string | undefined>();

function startRenaming() {
  name.value = props.me.name;
  error.value = undefined;
  renaming.value = true;
}

async function rename() {
  const reply = await send('room:rename', { name: name.value });
  if (!reply.ok) {
    error.value = t(errorKey(reply.error));
    return;
  }
  storeName(name.value.trim());
  renaming.value = false;
}

async function leave() {
  const reply = await leaveRoom();
  if (!reply.ok) {
    toastError(reply.error);
    return;
  }
  await router.push('/');
}
</script>

<template>
  <footer class="room-footer">
    <span class="who">{{ me.name }}</span>
    <UiButton variant="quiet" size="small" @click="startRenaming">{{ t('room.rename') }}</UiButton>
    <UiButton variant="quiet" size="small" @click="leaving = true">{{ t('room.leave') }}</UiButton>

    <UiSheet :open="renaming" :title="t('room.rename')" @close="renaming = false">
      <form class="sheet-form" @submit.prevent="rename">
        <UiField v-model="name" :label="t('room.join.name')" :maxlength="32" enterkeyhint="done" :error="error" />
        <UiButton variant="primary" type="submit" :disabled="!name.trim()">{{ t('room.renameSubmit') }}</UiButton>
      </form>
    </UiSheet>

    <UiSheet :open="leaving" :title="t('room.leave')" @close="leaving = false">
      <div class="sheet-form">
        <p>{{ t('room.leaveConfirm') }}</p>
        <UiButton variant="danger" @click="leave">{{ t('room.leave') }}</UiButton>
        <UiButton variant="quiet" @click="leaving = false">{{ t('lobby.manage.cancel') }}</UiButton>
      </div>
    </UiSheet>
  </footer>
</template>

<style scoped>
.room-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  margin-top: var(--space-7);
  padding: var(--space-3) 0 max(var(--space-4), env(safe-area-inset-bottom));
  border-top: 1px solid var(--rule);
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.who {
  margin-right: auto;
  color: var(--ink-2);
}

.sheet-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
</style>

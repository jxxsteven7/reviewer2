<script setup lang="ts">
import { ACCOUNT_API, type AccountSummary } from '@reviewer2/shared';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { loadAccount, request } from '../account';
import AvatarCropper from '../components/AvatarCropper.vue';
import UiButton from '../components/UiButton.vue';
import UiSheet from '../components/UiSheet.vue';
import { toastError } from '../toast';
import { useBusy } from '../useBusy';

// The ways to change the account's avatar, which the account page shows beside it: a picture from
// the phone or the computer, cropped here to a square and shown as a circle, or the default one,
// drawn from the username.
const props = defineProps<{ summary: AccountSummary }>();
const { t } = useI18n();
const input = ref<HTMLInputElement | null>(null);
const file = ref<File | null>(null);
const { busy, run } = useBusy();

function chosen(event: Event) {
  const target = event.target as HTMLInputElement;
  file.value = target.files?.[0] ?? null;
  // Choosing the same file again must work too.
  target.value = '';
}

async function upload(avatar: Blob) {
  const reply = await run(() => request(ACCOUNT_API.avatar, avatar));
  if (!reply) return;
  if (!reply.ok) {
    toastError(reply.error);
    return;
  }
  file.value = null;
  await loadAccount();
}

async function useDefault() {
  const reply = await run(() => request(ACCOUNT_API.avatarRemove, {}));
  if (reply && !reply.ok) toastError(reply.error);
  await loadAccount();
}

function failed(code: string) {
  file.value = null;
  toastError(code);
}
</script>

<template>
  <div class="avatar-buttons">
    <UiButton size="small" :disabled="busy" @click="input?.click()">{{ t('account.profile.uploadAvatar') }}</UiButton>
    <UiButton v-if="props.summary.avatar" variant="quiet" size="small" :disabled="busy" @click="useDefault">
      {{ t('account.profile.defaultAvatar') }}
    </UiButton>
    <input ref="input" class="file" type="file" accept="image/*" tabindex="-1" aria-hidden="true" @change="chosen" />

    <UiSheet :open="file !== null" :title="t('account.profile.cropTitle')" @close="file = null">
      <AvatarCropper
        v-if="file"
        :key="file.name + file.size"
        :file="file"
        @done="upload"
        @cancel="file = null"
        @failed="failed"
      />
    </UiSheet>
  </div>
</template>

<style scoped>
.avatar-buttons {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.file {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
</style>

<script setup lang="ts">
import { ACCOUNT_API } from '@reviewer2/shared';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { request } from '../account';
import UiButton from '../components/UiButton.vue';
import { errorKey } from '../errors';
import { useBusy } from '../useBusy';
import { useMailLink } from '../useMailLink';
import MailLinkPage from './MailLinkPage.vue';

// Binds an email address with the link from a mail. Nothing happens until the button is pressed,
// so that a mail filter that opens the links in a mail to check them binds nothing. It needs no
// login: the mail may be opened on another device.
const { t } = useI18n();
const token = useMailLink();
const state = ref<'ready' | 'done' | 'invalid'>(token ? 'ready' : 'invalid');
const refused = ref<string | undefined>();
const { busy, run } = useBusy();

async function confirm() {
  const reply = await run(() => request(ACCOUNT_API.emailConfirm, { token }));
  if (!reply) return;
  if (reply.ok) state.value = 'done';
  else if (reply.error === 'link_invalid') state.value = 'invalid';
  else refused.value = t(errorKey(reply.error));
}
</script>

<template>
  <MailLinkPage :title="t('account.confirm.title')">
    <p v-if="state === 'done'" class="intro" role="status">{{ t('account.confirm.done') }}</p>
    <p v-else-if="state === 'invalid'" class="problem" role="alert">{{ t('account.confirm.invalid') }}</p>
    <template v-else>
      <p class="intro">{{ t('account.confirm.intro') }}</p>
      <p v-if="refused" class="problem" role="alert">{{ refused }}</p>
      <div>
        <UiButton variant="primary" :disabled="busy" @click="confirm">{{ t('account.confirm.submit') }}</UiButton>
      </div>
    </template>
  </MailLinkPage>
</template>

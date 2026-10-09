<script setup lang="ts">
import { ACCOUNT_API, looksLikeEmail, MAX_EMAIL_LENGTH } from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { request } from '../account';
import UiButton from '../components/UiButton.vue';
import UiField from '../components/UiField.vue';
import { errorKey } from '../errors';
import { currentLanguage } from '../i18n';
import { useBusy } from '../useBusy';
import MailLinkPage from './MailLinkPage.vue';

// Asks for a link that resets the password. The answer is the same whether or not an account has
// the address, so the page says what happens if one does.
const { t } = useI18n();
const email = ref('');
const sent = ref(false);
const refused = ref<string | undefined>();
const { busy, run } = useBusy();

watch(email, () => (refused.value = undefined));
const problem = computed(() =>
  email.value.trim() && !looksLikeEmail(email.value) ? t(errorKey('email_invalid')) : undefined,
);

async function send() {
  const reply = await run(() => request(ACCOUNT_API.forgot, { email: email.value, language: currentLanguage() }));
  if (!reply) return;
  if (reply.ok) sent.value = true;
  else refused.value = t(errorKey(reply.error));
}
</script>

<template>
  <MailLinkPage :title="t('account.forgot.title')">
    <p v-if="sent" class="intro" role="status">{{ t('account.forgot.sent') }}</p>
    <template v-else>
      <p class="intro">{{ t('account.forgot.intro') }}</p>
      <form class="form" @submit.prevent="send">
        <UiField
          v-model="email"
          type="email"
          :label="t('account.forgot.email')"
          :maxlength="MAX_EMAIL_LENGTH"
          autocomplete="email"
          enterkeyhint="send"
          :error="problem ?? refused"
        />
        <div>
          <UiButton variant="primary" type="submit" :disabled="busy || !looksLikeEmail(email)">
            {{ t('account.forgot.submit') }}
          </UiButton>
        </div>
      </form>
    </template>
  </MailLinkPage>
</template>

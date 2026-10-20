<script setup lang="ts">
import { ACCOUNT_API, checkPassword, MAX_PASSWORD_INPUT } from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { logIn } from '../account';
import UiButton from '../components/UiButton.vue';
import UiField from '../components/UiField.vue';
import { errorKey } from '../errors';
import { useBusy } from '../useBusy';
import { useMailLink } from '../useMailLink';
import MailLinkPage from './MailLinkPage.vue';

// Sets a new password with the link from a mail, which works once and for 30 minutes. Setting it
// logs the account out everywhere else, and this browser in, and the account page takes this one's
// place in the history: a page whose link is used up is no page to go back to (docs/rules/display.md).
const { t } = useI18n();
const router = useRouter();
const token = useMailLink();
const password = ref('');
const invalid = ref(!token);
const refused = ref<string | undefined>();
const { busy, run } = useBusy();

watch(password, () => (refused.value = undefined));
const problem = computed(() => {
  if (!password.value) return undefined;
  const found = checkPassword(password.value);
  return found ? t(errorKey(found)) : undefined;
});

async function reset() {
  const reply = await run(() => logIn(ACCOUNT_API.reset, { token, password: password.value }));
  if (!reply) return;
  if (reply.ok) {
    await router.replace('/account');
  } else if (reply.error === 'link_invalid') {
    invalid.value = true;
  } else {
    refused.value = t(errorKey(reply.error));
  }
}
</script>

<template>
  <MailLinkPage :title="t('account.reset.title')">
    <template v-if="invalid">
      <p class="problem" role="alert">{{ t('account.reset.invalid') }}</p>
      <RouterLink to="/account/forgot">{{ t('account.reset.again') }}</RouterLink>
    </template>
    <form v-else class="form" @submit.prevent="reset">
      <p class="intro">{{ t('account.reset.intro') }}</p>
      <UiField
        v-model="password"
        type="password"
        :label="t('account.profile.newPassword')"
        :maxlength="MAX_PASSWORD_INPUT"
        autocomplete="new-password"
        enterkeyhint="done"
        :hint="t('account.passwordHint')"
        :error="problem ?? refused"
      />
      <div>
        <UiButton variant="primary" type="submit" :disabled="busy || !password || !!problem">
          {{ t('account.reset.submit') }}
        </UiButton>
      </div>
    </form>
  </MailLinkPage>
</template>

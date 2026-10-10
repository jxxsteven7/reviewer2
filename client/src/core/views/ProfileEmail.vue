<script setup lang="ts">
import {
  ACCOUNT_API,
  looksLikeEmail,
  MAX_EMAIL_LENGTH,
  MAX_PASSWORD_INPUT,
  type AccountSummary,
} from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { account, loadAccount, request } from '../account';
import UiButton from '../components/UiButton.vue';
import UiField from '../components/UiField.vue';
import UiSheet from '../components/UiSheet.vue';
import { errorKey } from '../errors';
import { currentLanguage } from '../i18n';
import { toast } from '../toast';
import { useBusy } from '../useBusy';

// The email address, which is only for resetting a forgotten password. The server keeps a
// fingerprint of it and never the address, so the page can only say whether one is bound. Binding
// and unbinding ask for the password.
const props = defineProps<{ summary: AccountSummary }>();
const { t } = useI18n();
const sheet = ref<'bind' | 'unbind' | null>(null);
const email = ref('');
const password = ref('');
const refused = ref<string | undefined>();
const { busy, run } = useBusy();

watch([sheet, email, password], () => (refused.value = undefined));
watch(sheet, () => {
  email.value = '';
  password.value = '';
});

const emailProblem = computed(() =>
  email.value.trim() && !looksLikeEmail(email.value) ? t(errorKey('email_invalid')) : undefined,
);

async function bind() {
  const body = { email: email.value, password: password.value, language: currentLanguage() };
  const reply = await run(() => request(ACCOUNT_API.email, body));
  if (!reply) return;
  if (!reply.ok) {
    refused.value = t(errorKey(reply.error));
    return;
  }
  sheet.value = null;
  toast('account.profile.bindSent', {}, 8000);
  await loadAccount();
}

async function unbind() {
  const reply = await run(() => request(ACCOUNT_API.emailRemove, { password: password.value }));
  if (!reply) return;
  if (!reply.ok) {
    refused.value = t(errorKey(reply.error));
    return;
  }
  sheet.value = null;
  await loadAccount();
}
</script>

<template>
  <div class="email">
    <p class="state">{{ t(`account.profile.emailStates.${props.summary.email}`) }}</p>
    <div v-if="account.mail" class="buttons">
      <UiButton size="small" @click="sheet = 'bind'">
        {{ t(props.summary.email === 'bound' ? 'account.profile.rebind' : 'account.profile.bind') }}
      </UiButton>
      <UiButton v-if="props.summary.email === 'bound'" variant="quiet" size="small" @click="sheet = 'unbind'">
        {{ t('account.profile.unbind') }}
      </UiButton>
    </div>
    <p v-else class="note">{{ t('account.profile.mailOff') }}</p>

    <UiSheet :open="sheet === 'bind'" :title="t('account.profile.bind')" @close="sheet = null">
      <form class="sheet-form" @submit.prevent="bind">
        <p class="note">{{ t('account.profile.bindHint') }}</p>
        <UiField
          v-model="email"
          type="email"
          :label="t('account.forgot.email')"
          :maxlength="MAX_EMAIL_LENGTH"
          autocomplete="email"
          inputmode="text"
          :error="emailProblem"
        />
        <UiField
          v-model="password"
          type="password"
          :label="t('account.profile.yourPassword')"
          :maxlength="MAX_PASSWORD_INPUT"
          autocomplete="current-password"
          enterkeyhint="send"
        />
        <p v-if="refused" class="problem" role="alert">{{ refused }}</p>
        <UiButton variant="primary" type="submit" :disabled="busy || !looksLikeEmail(email) || !password">
          {{ t('account.profile.bindSubmit') }}
        </UiButton>
      </form>
    </UiSheet>

    <UiSheet :open="sheet === 'unbind'" :title="t('account.profile.unbind')" @close="sheet = null">
      <form class="sheet-form" @submit.prevent="unbind">
        <p>{{ t('account.profile.unbindWarning') }}</p>
        <UiField
          v-model="password"
          type="password"
          :label="t('account.profile.yourPassword')"
          :maxlength="MAX_PASSWORD_INPUT"
          autocomplete="current-password"
        />
        <p v-if="refused" class="problem" role="alert">{{ refused }}</p>
        <UiButton variant="danger" type="submit" :disabled="busy || !password">
          {{ t('account.profile.unbindSubmit') }}
        </UiButton>
      </form>
    </UiSheet>
  </div>
</template>

<style scoped>
.email {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.note {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.sheet-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.problem {
  color: var(--red-deep);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}
</style>

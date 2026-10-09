<script setup lang="ts">
import { ACCOUNT_API, checkPassword, checkUsername, MAX_NAME_INPUT, MAX_PASSWORD_INPUT } from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { account, logIn } from '../account';
import UiButton from '../components/UiButton.vue';
import UiField from '../components/UiField.vue';
import { errorKey } from '../errors';
import { useBusy } from '../useBusy';

// Logging in, or registering an account, which only needs a username and a password. Both forms
// say what is wrong with what is typed before it is sent, by the rules that the server applies
// (shared/src/accounts.ts), and what the server refused after. Registering logs the browser in.
const { t } = useI18n();
const router = useRouter();
const mode = ref<'login' | 'register'>('login');
const username = ref('');
const password = ref('');
const refused = ref<string | undefined>();
const { busy, run } = useBusy();

watch([mode, username, password], () => (refused.value = undefined));

const usernameProblem = computed(() => {
  if (mode.value !== 'register' || !username.value.trim()) return undefined;
  const { problem } = checkUsername(username.value);
  return problem ? t(errorKey(problem)) : undefined;
});
const passwordProblem = computed(() => {
  if (mode.value !== 'register' || !password.value) return undefined;
  const problem = checkPassword(password.value);
  return problem ? t(errorKey(problem)) : undefined;
});
const ready = computed(
  () => username.value.trim() !== '' && password.value !== '' && !usernameProblem.value && !passwordProblem.value,
);

async function submit() {
  const path = mode.value === 'login' ? ACCOUNT_API.login : ACCOUNT_API.register;
  const reply = await run(() => logIn(path, { username: username.value, password: password.value }));
  if (!reply) return;
  if (!reply.ok) {
    refused.value = t(errorKey(reply.error));
    return;
  }
  await router.push('/');
}
</script>

<template>
  <section class="sign-in">
    <h1>{{ t('account.signIn.title') }}</h1>
    <p class="intro">{{ t('account.signIn.intro') }}</p>
    <div class="tabs" role="group">
      <button type="button" class="tab" :aria-pressed="mode === 'login'" @click="mode = 'login'">
        {{ t('account.signIn.login') }}
      </button>
      <button type="button" class="tab" :aria-pressed="mode === 'register'" @click="mode = 'register'">
        {{ t('account.signIn.register') }}
      </button>
    </div>
    <form class="form" @submit.prevent="submit">
      <UiField
        v-model="username"
        :label="t('account.username')"
        :maxlength="MAX_NAME_INPUT"
        autocomplete="username"
        :hint="mode === 'register' ? t('account.usernameHint') : undefined"
        :error="usernameProblem"
      />
      <UiField
        v-model="password"
        type="password"
        :label="t('account.password')"
        :maxlength="MAX_PASSWORD_INPUT"
        :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
        enterkeyhint="go"
        :hint="mode === 'register' ? t('account.passwordHint') : undefined"
        :error="passwordProblem"
      />
      <p v-if="refused" class="problem" role="alert">{{ refused }}</p>
      <p v-if="mode === 'register'" class="note">{{ t('account.signIn.noEmail') }}</p>
      <div class="actions">
        <UiButton variant="primary" type="submit" :disabled="busy || !ready">
          {{ t(mode === 'login' ? 'account.signIn.loginSubmit' : 'account.signIn.registerSubmit') }}
        </UiButton>
        <RouterLink v-if="mode === 'login' && account.mail" to="/account/forgot" class="forgot">
          {{ t('account.signIn.forgot') }}
        </RouterLink>
      </div>
    </form>
  </section>
</template>

<style scoped>
.sign-in {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 24rem;
  padding-top: var(--space-3);
}

h1 {
  font-size: var(--text-2xl);
}

.intro {
  color: var(--ink-2);
}

.tabs {
  display: flex;
  border-bottom: 1px solid var(--rule);
}

.tab {
  min-height: 44px;
  margin-bottom: -1px;
  padding: 0 var(--space-4);
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--ink-2);
  cursor: pointer;
}

.tab[aria-pressed='true'] {
  border-bottom-color: var(--ink);
  color: var(--ink);
  font-weight: 600;
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.problem {
  color: var(--red);
  font-size: var(--text-sm);
}

.note {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-4);
}

.forgot {
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>

<script setup lang="ts">
import {
  ACCOUNT_API,
  checkPassword,
  checkUsername,
  MAX_NAME_INPUT,
  MAX_PASSWORD_INPUT,
  RECORDS_NOTICE_VERSION,
} from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { account, logIn } from '../account';
import UiButton from '../components/UiButton.vue';
import UiField from '../components/UiField.vue';
import { errorKey } from '../errors';
import { useBusy } from '../useBusy';

// Logging in, or registering an account, which only needs a username and a password, and the
// player's agreement to the notice on how games are recorded, which the form shows and a box under
// it takes (RECORDS_NOTICE_VERSION, docs/architecture.md#accounts): the request says which version
// of the notice the player agreed to. Both forms say what is wrong with what is typed before it is
// sent, by the rules that the server applies (shared/src/accounts.ts), and what the server refused
// after. Registering logs the browser in.
// Both lead to `next`, the room that sent the player here (AccountPage), or else home. The form is
// busy from the moment it sends until the page has left, and says so: the account page keeps the
// form meanwhile, although the browser is logged in already. It opens on logging in, or on
// registering for a page that asks for that, as the home page's way to practice does for a guest.
const props = defineProps<{ next?: string | undefined; register?: boolean }>();
// Whether the form is busy, as the account page hears it (v-model:busy): a copy, since a model with
// a listener reads as the parent last rendered it, and the guard against a second submit must read
// what it has just written (useBusy).
const busyModel = defineModel<boolean>('busy', { default: false });
const { t } = useI18n();
const router = useRouter();
const mode = ref<'login' | 'register'>(props.register ? 'register' : 'login');
const username = ref('');
const password = ref('');
const agreed = ref(false);
const refused = ref<string | undefined>();
const { busy, run } = useBusy();

watch(busy, (value) => (busyModel.value = value), { flush: 'sync' });
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
  () =>
    username.value.trim() !== '' &&
    password.value !== '' &&
    !usernameProblem.value &&
    !passwordProblem.value &&
    (mode.value === 'login' || agreed.value),
);

async function submit() {
  const registering = mode.value === 'register';
  const path = registering ? ACCOUNT_API.register : ACCOUNT_API.login;
  await run(async () => {
    const body = { username: username.value, password: password.value };
    const reply = await logIn(path, registering ? { ...body, consent: RECORDS_NOTICE_VERSION } : body);
    if (reply.ok) await router.push(props.next ?? '/');
    else refused.value = t(errorKey(reply.error));
  });
}
</script>

<template>
  <section class="sign-in">
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
      <p v-if="mode === 'register'" class="note">{{ t('privacy.records') }}</p>
      <p v-if="mode === 'register'" class="note">{{ t('account.signIn.publicPage') }}</p>
      <label v-if="mode === 'register'" class="agree">
        <input v-model="agreed" type="checkbox" />
        <span>{{ t('account.signIn.agree') }}</span>
      </label>
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
  max-width: 26rem;
  padding: var(--space-5) var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

.tabs {
  display: flex;
  gap: var(--space-2);
}

.tab {
  flex: 1;
  min-height: 44px;
  padding: 0 var(--space-3);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
  color: var(--ink);
  font-weight: var(--weight-bold);
  cursor: pointer;
}

/* The tabs are a choice, not buttons: no shadow, and the chosen one turns yellow, as a chosen row
   does (docs/rules/display.md). */
.tab[aria-pressed='true'] {
  background: var(--bg);
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.problem {
  color: var(--red-deep);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.note {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

/* The box to tick, as tall as a button, with the words beside it. */
.agree {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  min-height: 44px;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  cursor: pointer;
}

.agree input {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  margin: 2px 0 0;
  accent-color: var(--ink);
  cursor: pointer;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-4);
}

.forgot {
  font-size: var(--text-sm);
}
</style>

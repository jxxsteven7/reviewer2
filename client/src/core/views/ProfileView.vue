<script setup lang="ts">
import {
  ACCOUNT_API,
  checkPassword,
  checkUsername,
  MAX_NAME_INPUT,
  MAX_PASSWORD_INPUT,
  nextRank,
  rankFor,
  STREAK_KINDS,
  STREAK_MIN,
  type AccountSummary,
} from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { changeLogin, loadAccount, request } from '../account';
import UiButton from '../components/UiButton.vue';
import UiField from '../components/UiField.vue';
import UiSheet from '../components/UiSheet.vue';
import { errorKey } from '../errors';
import { useLanguage } from '../i18n';
import { streakTitle } from '../streaks';
import { toast, toastError } from '../toast';
import { useBusy } from '../useBusy';
import ProfileAvatar from './ProfileAvatar.vue';
import ProfileEmail from './ProfileEmail.vue';
import ProfileFriends from './ProfileFriends.vue';
import ProfileRecords from './ProfileRecords.vue';

// The account's own page: its avatar and username, its academic rank, its titles, its streaks and
// the acknowledgments counted for it, its friends, its email address, its password, its record, and
// the ways to log out and to delete it.
const props = defineProps<{ summary: AccountSummary }>();
const { t } = useI18n();
const router = useRouter();
const { busy, run } = useBusy();

// The one thing being changed: the username inline, the password or the deletion in a sheet.
const editing = ref<'username' | 'password' | 'delete' | null>(null);
const username = ref('');
const current = ref('');
const password = ref('');
const refused = ref<string | undefined>();

watch(editing, (what) => {
  username.value = what === 'username' ? props.summary.username : '';
  current.value = '';
  password.value = '';
  refused.value = undefined;
});
watch([username, current, password], () => (refused.value = undefined));

const usernameProblem = computed(() => {
  if (editing.value !== 'username' || !username.value.trim()) return undefined;
  const { problem } = checkUsername(username.value);
  return problem ? t(errorKey(problem)) : undefined;
});
const passwordProblem = computed(() => {
  if (!password.value) return undefined;
  const problem = checkPassword(password.value);
  return problem ? t(errorKey(problem)) : undefined;
});

// A title or an acknowledgment, with how often it was awarded when that is more than once.
const counted = (label: string, count: number) =>
  count > 1 ? t('account.profile.titleCount', { title: label, count }) : label;

// The rank that the account's points hold, and the next one (shared/src/ranks.ts).
const rank = computed(() => rankFor(props.summary.points));
const next = computed(() => nextRank(props.summary.points));

// The streak titles (shared/src/streaks.ts): the longest run of wins and of losses, from three games
// on, with the number in the words of the language.
const language = useLanguage();
const streakTitles = computed(() =>
  STREAK_KINDS.flatMap((kind) => {
    const length = props.summary.streaks[kind];
    return length >= STREAK_MIN ? [{ kind, title: streakTitle(t, kind, length, language.value) }] : [];
  }),
);

// Sends a change, and shows what the server had against it.
async function change(path: string, body: object): Promise<boolean> {
  const reply = await run(() => request(path, body));
  if (!reply) return false;
  if (!reply.ok) {
    refused.value = t(errorKey(reply.error));
    return false;
  }
  return true;
}

async function rename() {
  if (!(await change(ACCOUNT_API.username, { username: username.value }))) return;
  editing.value = null;
  await loadAccount();
}

// Sends a change of who the browser is, which ends the login it had (account.ts), and shows what
// the server had against it.
async function changeWho(path: string, body: object): Promise<boolean> {
  const result = await run(() => changeLogin(path, body));
  if (!result) return false;
  if (!result.reply.ok) {
    refused.value = t(errorKey(result.reply.error));
    return false;
  }
  return true;
}

async function changePassword() {
  if (!(await changeWho(ACCOUNT_API.password, { current: current.value, password: password.value }))) return;
  editing.value = null;
  toast('account.profile.passwordChanged', {}, 6000);
}

async function remove() {
  if (!(await changeWho(ACCOUNT_API.remove, { password: current.value }))) return;
  editing.value = null;
  await router.push('/');
}

async function logOut() {
  const result = await run(() => changeLogin(ACCOUNT_API.logout, {}));
  if (!result) return;
  if (!result.reply.ok) {
    toastError(result.reply.error);
    return;
  }
  await router.push('/');
}
</script>

<template>
  <section class="profile">
    <h1>{{ t('account.profile.title') }}</h1>

    <ProfileAvatar :summary="summary" />

    <section class="part" aria-labelledby="profile-username">
      <h2 id="profile-username">{{ t('account.profile.username') }}</h2>
      <form v-if="editing === 'username'" class="inline-form" @submit.prevent="rename">
        <UiField
          v-model="username"
          :label="t('account.username')"
          :maxlength="MAX_NAME_INPUT"
          autocomplete="username"
          enterkeyhint="done"
          :hint="t('account.usernameHint')"
          :error="usernameProblem ?? refused"
        />
        <div class="buttons">
          <UiButton variant="primary" type="submit" :disabled="busy || !username.trim() || !!usernameProblem">
            {{ t('account.profile.renameSubmit') }}
          </UiButton>
          <UiButton variant="quiet" @click="editing = null">{{ t('account.cancel') }}</UiButton>
        </div>
      </form>
      <div v-else class="line">
        <span class="name">{{ summary.username }}</span>
        <UiButton variant="quiet" size="small" @click="editing = 'username'">{{
          t('account.profile.rename')
        }}</UiButton>
      </div>
    </section>

    <section class="part" aria-labelledby="profile-rank">
      <h2 id="profile-rank">{{ t('ranks.title') }}</h2>
      <p class="rank-line">
        <span class="rank">{{ t(`ranks.names.${rank}`) }}</span>
        <span class="num">{{ t('ranks.points', { points: summary.points }) }}</span>
      </p>
      <p class="hint">
        {{ next ? t('ranks.next', { points: next.points, rank: t(`ranks.names.${next.rank}`) }) : t('ranks.top') }}
      </p>
      <p class="hint">{{ t('ranks.note') }}</p>
    </section>

    <section
      v-if="summary.titles.length || streakTitles.length || summary.acknowledgments.length"
      class="part"
      aria-labelledby="profile-titles"
    >
      <h2 id="profile-titles">{{ t('account.profile.titles') }}</h2>
      <ul class="titles">
        <li v-for="{ title, count } in summary.titles" :key="title">
          {{ counted(t(`account.profile.titleNames.${title}`), count) }}
        </li>
        <li v-for="{ kind, title } in streakTitles" :key="kind" class="streak" :class="kind">{{ title }}</li>
        <li v-for="{ kind, count } in summary.acknowledgments" :key="kind">
          {{ counted(t('account.profile.acknowledged', { kind: t(`acknowledgments.kinds.${kind}`) }), count) }}
        </li>
      </ul>
    </section>

    <section class="part" aria-labelledby="profile-friends">
      <h2 id="profile-friends">{{ t('friends.title') }}</h2>
      <ProfileFriends />
    </section>

    <section class="part" aria-labelledby="profile-email">
      <h2 id="profile-email">{{ t('account.profile.email') }}</h2>
      <ProfileEmail :summary="summary" />
    </section>

    <section class="part" aria-labelledby="profile-password">
      <h2 id="profile-password">{{ t('account.profile.password') }}</h2>
      <div>
        <UiButton size="small" @click="editing = 'password'">{{ t('account.profile.changePassword') }}</UiButton>
      </div>
    </section>

    <section class="part" aria-labelledby="profile-record">
      <h2 id="profile-record">{{ t('account.profile.record') }}</h2>
      <ProfileRecords />
    </section>

    <section class="part leave">
      <UiButton :disabled="busy" @click="logOut">{{ t('account.profile.logout') }}</UiButton>
      <UiButton variant="danger" @click="editing = 'delete'">{{ t('account.profile.delete') }}</UiButton>
    </section>

    <UiSheet :open="editing === 'password'" :title="t('account.profile.changePassword')" @close="editing = null">
      <form class="sheet-form" @submit.prevent="changePassword">
        <UiField
          v-model="current"
          type="password"
          :label="t('account.profile.currentPassword')"
          :maxlength="MAX_PASSWORD_INPUT"
          autocomplete="current-password"
        />
        <UiField
          v-model="password"
          type="password"
          :label="t('account.profile.newPassword')"
          :maxlength="MAX_PASSWORD_INPUT"
          autocomplete="new-password"
          enterkeyhint="done"
          :hint="t('account.passwordHint')"
          :error="passwordProblem"
        />
        <p v-if="refused" class="problem" role="alert">{{ refused }}</p>
        <UiButton variant="primary" type="submit" :disabled="busy || !current || !password || !!passwordProblem">
          {{ t('account.profile.passwordSubmit') }}
        </UiButton>
      </form>
    </UiSheet>

    <UiSheet :open="editing === 'delete'" :title="t('account.profile.delete')" @close="editing = null">
      <form class="sheet-form" @submit.prevent="remove">
        <p>{{ t('account.profile.deleteWarning') }}</p>
        <UiField
          v-model="current"
          type="password"
          :label="t('account.profile.yourPassword')"
          :maxlength="MAX_PASSWORD_INPUT"
          autocomplete="current-password"
        />
        <p v-if="refused" class="problem" role="alert">{{ refused }}</p>
        <UiButton variant="danger" type="submit" :disabled="busy || !current">
          {{ t('account.profile.deleteSubmit') }}
        </UiButton>
        <UiButton variant="quiet" @click="editing = null">{{ t('account.cancel') }}</UiButton>
      </form>
    </UiSheet>
  </section>
</template>

<style scoped>
.profile {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 34rem;
  margin-top: var(--space-3);
}

h1 {
  font-size: var(--text-2xl);
}

.part {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

.part h2 {
  font-size: var(--text-xl);
}

.line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.name {
  font-size: var(--text-xl);
  font-weight: var(--weight-black);
  overflow-wrap: anywhere;
}

.rank-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
}

.rank {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: var(--weight-display);
  font-synthesis: none;
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.inline-form,
.sheet-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.titles {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.titles li {
  padding: var(--space-1) var(--space-3);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--bg);
  font-weight: var(--weight-bold);
}

.titles .streak.wins {
  background: var(--blue-tint);
}

.titles .streak.losses {
  background: var(--red-tint);
}

.leave {
  flex-direction: row;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding: 0;
  border: 0;
  background: none;
  box-shadow: none;
}

.problem {
  color: var(--red-deep);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}
</style>

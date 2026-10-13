<script setup lang="ts">
import {
  ACCOUNT_API,
  checkPassword,
  checkUsername,
  MAX_NAME_INPUT,
  MAX_PASSWORD_INPUT,
  rankFor,
  type AccountSummary,
} from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { changeLogin, loadAccount, request } from '../account';
import BackButton from '../components/BackButton.vue';
import PlayerAvatar from '../components/PlayerAvatar.vue';
import PlayerNumber from '../components/PlayerNumber.vue';
import RankLadder from '../components/RankLadder.vue';
import TitlePills from '../components/TitlePills.vue';
import UiButton from '../components/UiButton.vue';
import UiField from '../components/UiField.vue';
import UiSheet from '../components/UiSheet.vue';
import { formatDay } from '../dates';
import { errorKey } from '../errors';
import { useLanguage } from '../i18n';
import { wayUp } from '../ranks';
import { streakTitles as titlesOf } from '../streaks';
import { toast, toastError } from '../toast';
import { useBusy } from '../useBusy';
import ProfileAvatar from './ProfileAvatar.vue';
import ProfileEmail from './ProfileEmail.vue';
import ProfileFriends from './ProfileFriends.vue';
import ProfilePublic from './ProfilePublic.vue';
import ProfileRecords from './ProfileRecords.vue';

// The account's own page: who it is, on one card at the top, with its avatar and the ways to
// change it, its username and the way to rename it, its number and when it registered; then its
// academic rank, its titles, its streaks and the acknowledgments counted for it, its public page,
// its friends, its email address, its password, its record, and the ways to log out and to delete
// it.
const props = defineProps<{ summary: AccountSummary }>();
const { t, locale } = useI18n();
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

// The day the account registered, as its public page shows it too.
const since = computed(() => formatDay(props.summary.createdAt, locale.value));

// The rank that the account's points hold, and the way to the next one (shared/src/ranks.ts). The
// rank opens the ladder of every rank, with this one marked.
const rank = computed(() => rankFor(props.summary.points));
const progress = computed(() => wayUp(t, props.summary.points));
const ladder = ref(false);

// The streak titles (streaks.ts): the longest run of wins and of losses, from three games on, with
// the number in the words of the language.
const language = useLanguage();
const streakTitles = computed(() => titlesOf(t, props.summary.streaks, language.value));

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
    <div class="title-row">
      <BackButton />
      <h1>{{ t('account.profile.title') }}</h1>
    </div>

    <section class="part identity" aria-labelledby="profile-username">
      <div class="head">
        <PlayerAvatar :name="summary.username" :avatar="summary.avatar" size="large" />
        <div class="who">
          <div class="line">
            <span id="profile-username" class="name">{{ summary.username }}</span>
            <UiButton v-if="editing !== 'username'" variant="quiet" size="small" @click="editing = 'username'">{{
              t('account.profile.rename')
            }}</UiButton>
          </div>
          <p class="line meta">
            <PlayerNumber :id="summary.id" />
            <span class="hint">{{ t('playerPage.since', { date: since }) }}</span>
          </p>
          <ProfileAvatar :summary="summary" />
        </div>
      </div>
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
    </section>

    <section class="part" aria-labelledby="profile-rank">
      <h2 id="profile-rank">{{ t('ranks.title') }}</h2>
      <button type="button" class="rank-button" aria-haspopup="dialog" @click="ladder = true">
        <span class="rank-line">
          <span class="rank">{{ t(`ranks.names.${rank}`) }}</span>
          <span class="num">{{ t('ranks.points', { points: summary.points }) }}</span>
        </span>
        <span class="hint">{{ progress }}</span>
        <span class="open">{{ t('ranks.ladder.open') }}</span>
      </button>
      <p class="hint">{{ t('ranks.note') }}</p>
      <RankLadder :open="ladder" :rank="rank" :points="summary.points" @close="ladder = false" />
    </section>

    <section
      v-if="summary.titles.length || streakTitles.length || summary.acknowledgments.length"
      class="part"
      aria-labelledby="profile-titles"
    >
      <h2 id="profile-titles">{{ t('account.profile.titles') }}</h2>
      <TitlePills :titles="summary.titles" :streaks="streakTitles" :acknowledgments="summary.acknowledgments" />
    </section>

    <section class="part" aria-labelledby="profile-public">
      <h2 id="profile-public">{{ t('account.profile.public.title') }}</h2>
      <ProfilePublic :summary="summary" />
    </section>

    <section class="part" aria-labelledby="profile-friends">
      <h2 id="profile-friends">
        {{ t('friends.title') }}
        <span v-if="summary.requests > 0" class="badge num" aria-hidden="true">{{ summary.requests }}</span>
        <span v-if="summary.requests > 0" class="sr-only">{{
          t('friends.requestsWaiting', { count: summary.requests }, summary.requests)
        }}</span>
      </h2>
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

/* The way back, when there is one, and the title on one row. */
.title-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
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

/* Who the account is: the avatar on the left, and beside it the name, the number and the avatar's
   buttons, which wrap under each other on a phone. */
.identity .head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.who {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.who .line {
  gap: var(--space-1) var(--space-3);
}

.name {
  min-width: 0;
  font-size: var(--text-xl);
  font-weight: var(--weight-black);
  line-height: 1.2;
  overflow-wrap: anywhere;
}

/* The rank is a sticker that opens the ladder: pressing it moves it by its shift and drops the
   shadow, as a button. */
.rank-button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  width: 100%;
  min-height: 44px;
  padding: var(--space-3) var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-card);
  background: var(--paper);
  box-shadow: var(--shadow-1);
  text-align: left;
  cursor: pointer;
}

.rank-button:active {
  transform: translate(var(--shift-1), var(--shift-1));
  box-shadow: none;
}

.rank-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
}

.open {
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 0.2em;
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

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  margin-left: var(--space-1);
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--red);
  color: var(--on-red);
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
  line-height: 1;
  vertical-align: middle;
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

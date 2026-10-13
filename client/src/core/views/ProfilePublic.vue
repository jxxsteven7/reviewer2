<script setup lang="ts">
import {
  ACCOUNT_API,
  checkBio,
  checkWebLink,
  LIKERS_SHOWN,
  MAX_BIO_INPUT,
  MAX_BIO_LENGTH,
  MAX_LINK_INPUT,
  PROFILE_PATH,
  textLength,
  type AccountSummary,
  type LikerView,
} from '@reviewer2/shared';
import { computed, nextTick, onMounted, ref, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { loadAccount, request } from '../account';
import PlayerAvatar from '../components/PlayerAvatar.vue';
import UiButton from '../components/UiButton.vue';
import UiField from '../components/UiField.vue';
import { errorKey } from '../errors';
import { friendsVersion, requestFriend } from '../friends';
import { toast } from '../toast';
import { useBusy } from '../useBusy';

// The account's public page, as its owner sets it up (docs/architecture.md#public-profiles): the
// link and the line about themselves that anyone may read, whether the record and the
// acknowledgments show there too, the way to the page itself, and who likes it, with a way to ask
// those who aren't friends yet. The form says what is wrong with the link or the bio before it is
// sent, by the rules that the server applies (shared/src/accounts.ts).
const props = defineProps<{ summary: AccountSummary }>();
const { t } = useI18n();
const { busy, run } = useBusy();
const link = ref('');
const bio = ref('');
const showRecord = ref(false);
const showThanks = ref(false);
const refused = ref<string | undefined>();
const likers = ref<LikerView[] | null>(null);
const likersFailed = ref<string | undefined>();

// The form shows the profile as the server last said, until the owner edits it. Each field follows
// the value that is kept, not the summary, which is asked for again whenever the friends change
// (friends.ts): what the owner has typed must not go when a request comes in, and a field whose
// kept value is as it was stays as typed. The link and the bio follow when the operator bars the
// account too, since the fields then close on whatever was typed.
const kept = () => props.summary.profile;
function follows<Value>(keptValue: () => Value, field: Ref<Value>): void {
  watch(keptValue, (value) => (field.value = value), { immediate: true });
}
follows(() => kept().link ?? '', link);
follows(() => kept().bio ?? '', bio);
follows(() => kept().showRecord, showRecord);
follows(() => kept().showThanks, showThanks);
function followWritten(): void {
  link.value = kept().link ?? '';
  bio.value = kept().bio ?? '';
}
watch(
  () => kept().banned,
  (banned) => {
    if (banned) followWritten();
  },
);
// After a save, every field follows whether its kept value changed or not: what was typed may have
// been kept as cleaned, with a space at the end gone, and the form must not go on saying there is
// something to save.
function follow(): void {
  followWritten();
  showRecord.value = kept().showRecord;
  showThanks.value = kept().showThanks;
}
watch([link, bio, showRecord, showThanks], () => (refused.value = undefined));

const linkProblem = computed(() => {
  const { problem } = checkWebLink(link.value);
  return problem ? t(errorKey(problem)) : undefined;
});
const checkedBio = computed(() => checkBio(bio.value));
const bioProblem = computed(() => (checkedBio.value.problem ? t(errorKey(checkedBio.value.problem)) : undefined));
const bioCount = computed(() =>
  t('account.profile.public.bioCount', { count: textLength(checkedBio.value.bio ?? ''), max: MAX_BIO_LENGTH }),
);
const changed = computed(() => {
  const { profile } = props.summary;
  return (
    link.value !== (profile.link ?? '') ||
    bio.value !== (profile.bio ?? '') ||
    showRecord.value !== profile.showRecord ||
    showThanks.value !== profile.showThanks
  );
});
const page = computed(() => `${PROFILE_PATH}${props.summary.handle}`);

async function save(): Promise<void> {
  if (linkProblem.value || bioProblem.value) return;
  const reply = await run(() =>
    request(ACCOUNT_API.profile, {
      link: link.value,
      bio: bio.value,
      showRecord: showRecord.value,
      showThanks: showThanks.value,
    }),
  );
  if (!reply) return;
  if (!reply.ok) {
    // An account barred while the page was open has lost its link and bio already, and the server
    // refuses the ones the form still holds: the summary says so, the two fields follow it and
    // close, and the choices stay as made, for the owner to save again. The word on why is kept
    // past the change.
    if (reply.error === 'profile_banned') {
      await loadAccount();
      followWritten();
      await nextTick();
    }
    refused.value = t(errorKey(reply.error));
    return;
  }
  await loadAccount();
  follow();
  toast('account.profile.public.saved');
}

async function loadLikers(): Promise<void> {
  likersFailed.value = undefined;
  const reply = await request<{ likers: LikerView[] }>(ACCOUNT_API.likers);
  if (reply.ok) likers.value = reply.likers;
  else likersFailed.value = reply.error;
}

onMounted(loadLikers);
// The list stops at LIKERS_SHOWN, which the count on the summary may be past.
const likersCut = computed(
  () => likers.value !== null && likers.value.length >= LIKERS_SHOWN && props.summary.likes > likers.value.length,
);
// A new like changes the count on the summary, on which the list is asked for again; so does a
// change among the friends, since the list says who is one.
watch(() => props.summary.likes, loadLikers);
watch(friendsVersion, loadLikers);

async function befriend(liker: LikerView): Promise<void> {
  await run(() => requestFriend({ username: liker.username }));
}
</script>

<template>
  <div class="public">
    <p class="hint">{{ t('account.profile.public.intro') }}</p>
    <RouterLink :to="page" class="view">{{ t('account.profile.public.view') }}</RouterLink>
    <p v-if="summary.profile.banned" class="problem">{{ t('account.profile.public.banned') }}</p>
    <form class="form" @submit.prevent="save">
      <!-- A barred account may still choose what else it shows, so only these two are disabled. -->
      <UiField
        v-model="link"
        :label="t('account.profile.public.link')"
        :maxlength="MAX_LINK_INPUT"
        :hint="t('account.profile.public.linkHint')"
        :error="linkProblem"
        :disabled="summary.profile.banned"
        inputmode="url"
        autocomplete="url"
        :placeholder="t('account.profile.public.linkPlaceholder')"
      />
      <UiField
        v-model="bio"
        :label="t('account.profile.public.bio')"
        :maxlength="MAX_BIO_INPUT"
        :hint="bioCount"
        :error="bioProblem"
        :disabled="summary.profile.banned"
        enterkeyhint="done"
      />
      <label class="check">
        <input v-model="showRecord" type="checkbox" />
        <span>{{ t('account.profile.public.showRecord') }}</span>
      </label>
      <label class="check">
        <input v-model="showThanks" type="checkbox" />
        <span>{{ t('account.profile.public.showThanks') }}</span>
      </label>
      <p v-if="refused" class="problem" role="alert">{{ refused }}</p>
      <div>
        <UiButton variant="primary" type="submit" :disabled="busy || !changed || !!linkProblem || !!bioProblem">
          {{ t('account.profile.public.save') }}
        </UiButton>
      </div>
    </form>

    <section class="likers" aria-labelledby="profile-likers">
      <h3 id="profile-likers">{{ t('account.profile.public.likes', { count: summary.likes }) }}</h3>
      <p v-if="likersFailed" class="hint">{{ t(errorKey(likersFailed)) }}</p>
      <p v-else-if="likers === null" class="hint">{{ t('friends.loading') }}</p>
      <p v-else-if="likers.length === 0" class="hint">{{ t('account.profile.public.noLikes') }}</p>
      <ul v-else class="list">
        <li v-for="liker in likers" :key="liker.handle" class="line">
          <PlayerAvatar :name="liker.username" :avatar="liker.avatar" />
          <RouterLink :to="`${PROFILE_PATH}${liker.handle}`" class="name">{{ liker.username }}</RouterLink>
          <span v-if="liker.friend" class="hint">{{ t('account.profile.public.friend') }}</span>
          <UiButton v-else variant="quiet" size="small" :disabled="busy" @click="befriend(liker)">
            {{ t('friends.addFromRoom') }}
          </UiButton>
        </li>
      </ul>
      <p v-if="likersCut" class="hint">{{ t('account.profile.public.likersShown', { count: LIKERS_SHOWN }) }}</p>
    </section>
  </div>
</template>

<style scoped>
.public,
.form,
.likers {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.likers {
  gap: var(--space-2);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.view {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  min-height: 44px;
  color: var(--ink);
  font-weight: var(--weight-bold);
}

.check {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  min-height: 44px;
  font-size: var(--text-sm);
}

.check input {
  flex: none;
  width: 22px;
  height: 22px;
  margin: 0;
  accent-color: var(--ink);
}

.problem {
  color: var(--red-deep);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

h3 {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
}

/* The name is a link on one line of text. Padding that the margins take back makes it 44px tall
   to tap, as the button beside it is, without moving anything. */
.name {
  position: relative;
  flex: 1;
  min-width: 0;
  margin: -10px 0;
  padding: 10px 0;
  overflow: hidden;
  color: var(--ink);
  font-weight: var(--weight-bold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

<script setup lang="ts">
import { ACCOUNT_API, type ProfileView } from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { account, request } from '../account';
import { errorKey } from '../errors';
import { connect, onceConnected, send, socket } from '../socket';
import { toast, toastError } from '../toast';
import { useBusy } from '../useBusy';
import PlayerAvatar from './PlayerAvatar.vue';
import PlayerNumber from './PlayerNumber.vue';
import UiButton from './UiButton.vue';

// A public profile (docs/architecture.md#public-profiles), by the handle of its account, on its
// own page and in the sheet that a room's player menu opens: the avatar, the username, the rank,
// the number and the date of registration, the titles, and what the owner chose to put there: a
// link, a line about themselves, the record and the acknowledgments. The bio is shown as the text
// it is, never as markup, and the link as the address it is, which opens in a new tab and which
// search engines are told not to follow. Anyone may look; an account that isn't the owner may
// like the profile and ask the owner to be friends.
const props = defineProps<{ handle: string }>();
const { t, locale } = useI18n();
const profile = ref<ProfileView | null>(null);
const failed = ref<string | undefined>();
const { busy, run } = useBusy();

async function load(): Promise<void> {
  failed.value = undefined;
  const reply = await request<{ profile: ProfileView }>(`${ACCOUNT_API.profiles}${props.handle}`);
  if (reply.ok) profile.value = reply.profile;
  else failed.value = reply.error;
}

watch(
  () => props.handle,
  () => {
    profile.value = null;
    void load();
  },
  { immediate: true },
);
// Whether the viewer likes the profile is the viewer's, so the profile is read again when the
// browser logs in or out.
watch(
  () => account.summary?.handle ?? null,
  (now, before) => {
    if (now !== before && profile.value !== null) void load();
  },
);

const viewer = computed(() => account.summary);
const canAct = computed(() => viewer.value !== null && profile.value !== null && !profile.value.mine);

// A date as the page's language writes it, or the ISO date if the browser can't.
function date(iso: string): string {
  try {
    return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

async function toggleLike(): Promise<void> {
  const current = profile.value;
  if (!current) return;
  const path = current.liked ? ACCOUNT_API.unlike : ACCOUNT_API.like;
  const reply = await run(() => request(path, { handle: current.handle }));
  if (!reply) return;
  if (!reply.ok) {
    toastError(reply.error);
    return;
  }
  await load();
}

// The page may have no connection yet: the friends messages go over one.
function whenConnected(ms = 5000): Promise<boolean> {
  if (socket.connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve(false);
    }, ms);
    const off = onceConnected(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function befriend(): Promise<void> {
  const current = profile.value;
  if (!current) return;
  await run(async () => {
    if (!(await whenConnected())) {
      toastError('offline');
      return;
    }
    const reply = await send<{ status: 'pending' | 'accepted' }>('friends:request', { username: current.username });
    if (!reply.ok) {
      toastError(reply.error);
      return;
    }
    toast(reply.status === 'accepted' ? 'friends.nowFriends' : 'friends.requestSent');
  });
}

// A connection is asked for early, so that the first tap on "Add friend" doesn't wait for one.
watch(
  canAct,
  (can) => {
    if (can) connect();
  },
  { immediate: true },
);
</script>

<template>
  <div class="profile-card">
    <p v-if="failed" class="hint">{{ t(errorKey(failed)) }}</p>
    <p v-else-if="profile === null" class="hint">{{ t('playerPage.loading') }}</p>
    <template v-else>
      <div class="head">
        <PlayerAvatar :name="profile.username" :avatar="profile.avatar" size="large" />
        <div class="who">
          <span class="name">{{ profile.username }}</span>
          <span class="rank">{{ t(`ranks.names.${profile.rank}`) }}</span>
          <PlayerNumber :id="profile.id" />
          <span class="since">{{ t('playerPage.since', { date: date(profile.createdAt) }) }}</span>
        </div>
      </div>

      <ul v-if="profile.titles.length" class="titles">
        <li v-for="{ title, count } in profile.titles" :key="title">
          {{
            count > 1
              ? t('account.profile.titleCount', { title: t(`account.profile.titleNames.${title}`), count })
              : t(`account.profile.titleNames.${title}`)
          }}
        </li>
      </ul>

      <p v-if="profile.bio !== null" class="bio">{{ profile.bio }}</p>
      <a v-if="profile.link !== null" class="link" :href="profile.link" target="_blank" rel="nofollow ugc noopener">{{
        profile.link
      }}</a>

      <p v-if="profile.record" class="meta">{{ t('playerPage.record', profile.record) }}</p>
      <ul v-if="profile.acknowledgments?.length" class="titles">
        <li v-for="{ kind, count } in profile.acknowledgments" :key="kind">
          {{
            count > 1
              ? t('account.profile.titleCount', {
                  title: t('account.profile.acknowledged', { kind: t(`acknowledgments.kinds.${kind}`) }),
                  count,
                })
              : t('account.profile.acknowledged', { kind: t(`acknowledgments.kinds.${kind}`) })
          }}
        </li>
      </ul>

      <div class="actions">
        <span class="likes num">{{ t('playerPage.likes', { count: profile.likes }) }}</span>
        <UiButton
          v-if="canAct"
          size="small"
          :variant="profile.liked ? 'primary' : 'secondary'"
          :aria-pressed="profile.liked"
          :disabled="busy"
          @click="toggleLike"
        >
          {{ t(profile.liked ? 'playerPage.liked' : 'playerPage.like') }}
        </UiButton>
        <UiButton v-if="canAct" size="small" variant="quiet" :disabled="busy" @click="befriend">
          {{ t('friends.addFromRoom') }}
        </UiButton>
        <RouterLink v-if="profile.mine" to="/account" class="edit">{{ t('playerPage.edit') }}</RouterLink>
        <span v-else-if="viewer === null" class="hint">{{ t('playerPage.logInToLike') }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.profile-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.who {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.name {
  font-size: var(--text-xl);
  font-weight: var(--weight-black);
  overflow-wrap: anywhere;
}

.rank {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--weight-display);
  font-synthesis: none;
}

.since,
.meta {
  color: var(--ink-2);
  font-size: var(--text-sm);
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
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.bio {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.link {
  align-self: flex-start;
  max-width: 100%;
  overflow: hidden;
  color: var(--ink);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.likes {
  font-weight: var(--weight-bold);
}

.edit {
  color: var(--ink);
  font-size: var(--text-sm);
}
</style>

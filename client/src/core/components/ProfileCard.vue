<script setup lang="ts">
import { ACCOUNT_API, type ProfileView } from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { account, request } from '../account';
import { formatDay } from '../dates';
import { errorKey } from '../errors';
import { standingOf } from '../friends';
import { nameOf, usernameAfter } from '../names';
import { countsOf, shownDuo, shownStreaks, shownTitles } from '../records';
import { useLanguage } from '../i18n';
import { connect } from '../socket';
import { streakTitles as titlesOf } from '../streaks';
import { toastError } from '../toast';
import { useBusy } from '../useBusy';
import { useFriendsList } from '../useFriendsList';
import DuoSummary from './DuoSummary.vue';
import FriendActions from './FriendActions.vue';
import GameTabs from './GameTabs.vue';
import LinkArrow from './LinkArrow.vue';
import PlayerAvatar from './PlayerAvatar.vue';
import PlayerNumber from './PlayerNumber.vue';
import RankLadder from './RankLadder.vue';
import RecordStats from './RecordStats.vue';
import TitlePills from './TitlePills.vue';
import UiButton from './UiButton.vue';

// A public profile (docs/architecture.md#public-profiles), by the handle of its account, on its own
// page and in a room's player panel: the avatar, the username, the rank, the number and the day of
// registration, the titles, the streaks among them, and what the owner chose to put there: a link,
// a line about themselves, the record as counts, one game at a time as its tab names it
// (GameTabs.vue, RecordStats.vue), and the feedback contributions as counts. The bio is shown as
// the text it is, never as markup, and the link as the address it is, which opens in a new tab and
// which search engines are told not to follow. The rank opens the ladder of every rank, with this
// one marked and no points, which the profile never shows. Anyone may look; an account that isn't
// the owner may like the profile and, beside the like, do what a room's panel and the search's
// panel offer by how the two stand (FriendActions.vue): ask the owner to be friends, see that it
// has asked, answer the owner's request, or give a friend a name or part. A friend of the owner
// also sees what the two have played together (docs/architecture.md#friend-duos), which nobody else
// is sent.
//
// The owner goes by the name that the viewer gives them as a friend, if any (names.ts), with the
// username after it in small grey type, since such a name may be anyone's, and by that name where
// the page says the two of them.
//
// In a room's panel (PlayerPanel.vue), whose title is the player's name, the card has no name of
// its own (`named` false), and is `brief` until the viewer opens the whole page: the avatar, the
// rank, the number, the day of registration and the titles.
const props = withDefaults(defineProps<{ handle: string; brief?: boolean; named?: boolean }>(), {
  brief: false,
  named: true,
});
// The owner's name, as the card shows it, whenever it changes, such as when the profile is read: the
// player's page puts it in the tab's title (ProfilePage.vue). Empty while there is no profile.
const emit = defineEmits<{ name: [name: string] }>();
const { t, locale } = useI18n();
const profile = ref<ProfileView | null>(null);
const failed = ref<string | undefined>();
const { busy, run } = useBusy();
const ladder = ref(false);

// Reads the profile. One that is up stays up when it can't be read again, as after a like on a
// poor connection: the reader is told why, and keeps what they had.
async function load(): Promise<void> {
  const reply = await request<{ profile: ProfileView }>(`${ACCOUNT_API.profiles}${props.handle}`);
  if (reply.ok) {
    profile.value = reply.profile;
    failed.value = undefined;
  } else if (profile.value === null) {
    failed.value = reply.error;
  } else {
    toastError(reply.error);
  }
}

watch(
  () => props.handle,
  () => {
    profile.value = null;
    failed.value = undefined;
    void load();
  },
  { immediate: true },
);
// Whether the viewer likes the profile is the viewer's, so the profile is read again when the
// browser logs in or out. The server's first word on who the browser is changes nothing: the
// profile was read with the same cookie, so what it says of the viewer holds.
watch(
  () => (account.loaded ? (account.summary?.handle ?? null) : undefined),
  (now, before) => {
    if (before !== undefined && now !== before && profile.value !== null) void load();
  },
);

const viewer = computed(() => account.summary);
const name = computed(() =>
  profile.value ? nameOf({ name: profile.value.username, handle: profile.value.handle }) : '',
);
watch(name, (value) => emit('name', value));
const username = computed(() =>
  profile.value ? usernameAfter({ name: name.value, username: profile.value.username }) : null,
);
const canAct = computed(() => viewer.value !== null && profile.value !== null && !profile.value.mine);
// A guest, once the server has said so: until then, the card offers nothing and explains nothing.
const guest = computed(() => account.loaded && viewer.value === null);
const since = computed(() => (profile.value ? formatDay(profile.value.createdAt, locale.value) : ''));
const language = useLanguage();
const streakTitles = computed(() =>
  profile.value ? titlesOf(t, shownStreaks(profile.value.streaks), language.value) : [],
);
// The titles of the first game (records.ts), and the game whose record is shown.
const recordGame = ref('keywords');
const titles = computed(() => (profile.value ? shownTitles(profile.value.titles) : []));
const duo = computed(() => (profile.value ? shownDuo(profile.value.duo) : null));

// Likes the profile, or takes the like back. The count and the viewer's like then come from the
// server, which keeps them, and the button waits for them: a second tap meanwhile would send the
// same thing again. The heart pops once the like is there.
const popping = ref(false);
async function toggleLike(): Promise<void> {
  const current = profile.value;
  if (!current) return;
  await run(async () => {
    const reply = await request(current.liked ? ACCOUNT_API.unlike : ACCOUNT_API.like, { handle: current.handle });
    if (!reply.ok) {
      toastError(reply.error);
      return;
    }
    await load();
    popping.value = profile.value?.liked === true;
  });
}

// The viewer's friends and requests, asked for while the whole page shows to an account that isn't
// the owner. Until they come, the page offers neither a request nor an answer.
const { view: friends, failed: friendsFailed } = useFriendsList(computed(() => canAct.value && !props.brief));
const standing = computed(() =>
  profile.value && (friends.value !== null || friendsFailed.value !== null)
    ? standingOf(profile.value.handle, viewer.value?.handle ?? null, friends.value)
    : null,
);

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
          <span v-if="named" class="name"
            >{{ name }}<small v-if="username !== null" class="username-after">{{ ` ${username}` }}</small></span
          >
          <button type="button" class="rank-button" aria-haspopup="dialog" @click="ladder = true">
            <span class="rank">{{ t(`ranks.names.${profile.rank}`) }}</span>
            <span class="sr-only">{{ t('ranks.ladder.open') }}</span>
            <span class="chevron" aria-hidden="true"></span>
          </button>
          <PlayerNumber :id="profile.id" />
          <span class="since">{{ t('playerPage.since', { date: since }) }}</span>
        </div>
      </div>

      <TitlePills
        v-if="titles.length || streakTitles.length || profile.contributions?.length"
        :titles="titles"
        :streaks="streakTitles"
        :contributions="profile.contributions"
      />

      <template v-if="!brief">
        <section v-if="duo" class="duo" aria-labelledby="profile-duo">
          <h3 id="profile-duo">{{ t('playerPage.duo', { name }) }}</h3>
          <DuoSummary :duo="duo" />
        </section>

        <a v-if="profile.link !== null" class="link" :href="profile.link" target="_blank" rel="nofollow ugc noopener">
          <span class="text">{{ profile.link }}</span>
          <LinkArrow />
        </a>
        <p v-if="profile.bio !== null" class="bio">{{ profile.bio }}</p>

        <template v-if="profile.record">
          <GameTabs v-model="recordGame" />
          <RecordStats :game="recordGame" :counts="countsOf(profile.record, recordGame)" />
        </template>

        <div class="actions">
          <i18n-t keypath="playerPage.likes" tag="span" class="likes num" scope="global">
            <template #heart>
              <span class="heart" :class="{ pop: popping }" @animationend="popping = false">{{
                t('playerPage.heart')
              }}</span>
            </template>
            <template #count>{{ profile.likes }}</template>
          </i18n-t>
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
          <FriendActions
            v-if="canAct && standing"
            compact
            :standing="standing"
            :name="profile.username"
            :who="{ username: profile.username }"
          />
          <RouterLink v-if="profile.mine" to="/account" class="edit">{{ t('playerPage.edit') }}</RouterLink>
          <span v-else-if="guest" class="hint">{{ t('playerPage.logInToLike') }}</span>
        </div>
      </template>
      <RankLadder :open="ladder" :rank="profile.rank" @close="ladder = false" />
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

/* The rank is one line of display type that opens the ladder. Padding that the margins take back
   makes it 44px tall to tap without moving anything; the focus ring is drawn inside that padding,
   so that it clears the lines above and below; and a chevron says that it opens. */
.rank-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  align-self: flex-start;
  max-width: 100%;
  min-height: 44px;
  margin: -8px -8px;
  padding: 8px 8px;
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
}

.rank-button:focus-visible {
  outline-offset: -5px;
}

/* The author's badge, on the line under the rank, reaches down alone to its 44px (PlayerNumber.vue),
   over the date, which opens nothing: the lines here are 4px apart, so a box that reached up as
   well would lie over the rank's. */
.who :deep(.number .author)::before {
  top: 0;
  bottom: calc(100% - 44px);
}

/* Two sides of a small square, turned to point right and raised to the middle of the type. */
.chevron {
  flex: none;
  width: 0.45em;
  height: 0.45em;
  margin-right: 0.3em;
  border: solid var(--ink);
  border-width: var(--line) var(--line) 0 0;
  transform: rotate(45deg);
}

.rank {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--weight-display);
  font-synthesis: none;
}

.since {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

/* What the viewer has played with the owner, a friend, set apart from what everyone sees. */
.duo {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-card);
  background: var(--bg);
}

.duo h3 {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
  overflow-wrap: anywhere;
}

.bio {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

/* The link is one line of small text in the link blue, not bold, with an arrow after it
   (LinkArrow.vue), which says that it leads off the site (docs/rules/display.md): under a pointer an
   underline sweeps in under the address alone and the arrow moves out; pressed, the underline is
   there at once, the arrow further out and the link a pixel lower, and both ease back after.
   Padding that the margins take back makes it 44px tall to tap, as the buttons are, without
   moving anything; the focus ring is drawn around the text alone. */
.link {
  position: relative;
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 3px;
  max-width: 100%;
  margin: -11px 0;
  padding: 11px 0;
  color: var(--link);
  font-size: var(--text-sm);
  font-weight: var(--weight-text);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition:
    color var(--motion),
    transform var(--motion);
}

.link .text {
  position: relative;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link .text::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 1px;
  left: 0;
  height: 2px;
  border-radius: 1px;
  background: currentcolor;
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 220ms var(--ease-out);
}

.link:focus-visible {
  outline: none;
}

.link:focus-visible::before {
  content: '';
  position: absolute;
  inset: 7px -4px;
  border-radius: var(--radius-small);
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 1px;
}

.link:focus-visible .text::after {
  transform: none;
}

@media (hover: hover) {
  .link:hover {
    color: var(--link-deep);
  }

  .link:hover .text::after {
    transform: none;
  }

  .link:hover .arrow {
    transform: translate(2px, -2px);
  }
}

.link:active {
  color: var(--link-deep);
  transform: translateY(1px);
  transition-duration: 0s;
}

.link:active .text::after {
  transform: none;
  transition-duration: 0s;
}

.link:active .arrow {
  transform: translate(4px, -4px);
  transition-duration: 0s;
}

/* The likes and the buttons beside them, close enough that a phone's row holds them all. */
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.likes {
  font-weight: var(--weight-bold);
}

/* The heart pops when the viewer likes the page; the count beside it just changes. */
.heart {
  display: inline-block;
}

.heart.pop {
  animation: pop 300ms var(--ease-spring);
}

@keyframes pop {
  50% {
    transform: scale(1.3);
  }
}

.edit {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--ink);
  font-size: var(--text-sm);
}
</style>

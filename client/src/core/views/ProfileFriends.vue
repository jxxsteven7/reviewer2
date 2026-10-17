<script setup lang="ts">
import {
  ACCOUNT_API,
  cleanName,
  DUO_TITLES,
  handleInLink,
  type Ack,
  type FriendView,
  type ProfileView,
} from '@reviewer2/shared';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { request } from '../account';
import AliasSheet from '../components/AliasSheet.vue';
import AvatarButton from '../components/AvatarButton.vue';
import FoldedTitles from '../components/FoldedTitles.vue';
import TitleInfo from '../components/TitleInfo.vue';
import UiButton from '../components/UiButton.vue';
import UiField from '../components/UiField.vue';
import UiSheet from '../components/UiSheet.vue';
import UnfriendSheet from '../components/UnfriendSheet.vue';
import { duoLine } from '../duos';
import { errorKey } from '../errors';
import { answerFriend, askToJoin } from '../friends';
import { openProfile } from '../profilePanel';
import { send, whenConnected } from '../socket';
import { useBusy } from '../useBusy';
import { useFriendsList } from '../useFriendsList';

// The account's friends (docs/architecture.md#friends): the search for someone to ask, the requests
// waiting for an answer each way, the line that came with each request for the account under its
// name, and the friends, each on a card: the avatar, which opens the friend's panel
// (ProfilePanel.vue), with a green dot on its corner while they are online, the name and the way
// into the room they are in, if any; under it, in small type, what the account has played with
// them, and the titles they hold among its friends (docs/architecture.md#friend-duos), on one line,
// folded where they don't fit. The friends' board above the list sums the titles up, in the same
// look, each with the avatar and the name of the friends who hold it, the avatar opening their
// panel as on the cards. A friend who is offline has the whole card faded, still readable. A friend
// in a public room can be joined from here; one in a private room only by their invitation, which
// the account may ask them for (askToJoin), and which the card says it has while the request
// stands. A friend whom the account has given a name of its own (an alias, for the account alone)
// goes by it, with the username after it in small grey type, here and in the sheets about them. The
// card's "more" button opens a sheet with the friend's name, from which the account gives them a
// name, or takes it away by leaving it empty, or removes them, after asking first. The requests are
// answered, and taken back, as the panels answer them (answerFriend). A change made here comes back
// as the word that the server sends both sides, on which the list is asked for again
// (useFriendsList), as it is after a refusal, since the list may have been out of date.
//
// The search finds someone by their whole username, or by a link to their page pasted with any
// text around it, and opens their panel, as a tap on an avatar does (ProfilePanel.vue). Once
// something has gone through there, the panel closes and the box is cleared. A name that is no
// account's, and a link to no page, are said under the box, which forgets them as it changes.
// Text that can't be a username, since it is longer than one or holds what one can't, is said to
// name no account here, without asking the server, so that it costs none of the hour's searches,
// and one that holds a link that leads to no page is said to be no such link.
const { t } = useI18n();
const { view, failed, load } = useFriendsList();
// The friend whose "more" sheet is open, the one being given a name, and the one about to be
// removed.
const managing = ref<FriendView | null>(null);
const naming = ref<FriendView | null>(null);
const removing = ref<FriendView | null>(null);
const { busy, run } = useBusy();

// The search as typed, and why it found nobody. The box takes a link with the text that a chat
// shares it with, which is longer than a name may be.
const MAX_SEARCH_INPUT = 1000;
const searchForm = ref<HTMLFormElement | null>(null);
const query = ref('');
const searchProblem = ref<string | undefined>();
type Found = { handle: string; username: string };
watch(query, () => (searchProblem.value = undefined));

// The account that the text names: by a link to its page, read as the public page it leads to,
// which anyone may read and which costs none of the hour's searches, or else by its whole
// username, which the server looks up (friends:find).
async function lookUp(text: string): Promise<Ack<{ found: Found }>> {
  const handle = handleInLink(text);
  if (handle !== null) {
    const reply = await request<{ profile: ProfileView }>(`${ACCOUNT_API.profiles}${handle}`);
    return reply.ok ? { ok: true, found: { handle: reply.profile.handle, username: reply.profile.username } } : reply;
  }
  // What can't be a username is no account's, as the server would say; what looks like a link and
  // holds none to a page is said so, since it is the link that is wrong, not the name.
  if (cleanName(text) === null) return { ok: false, error: text.includes('://') ? 'bad_link' : 'no_such_account' };
  if (!(await whenConnected())) return { ok: false, error: 'offline' };
  const reply = await send<Found>('friends:find', { username: text });
  return reply.ok ? { ok: true, found: { handle: reply.handle, username: reply.username } } : reply;
}

const SEARCH_PROBLEMS: Record<string, string> = {
  no_such_account: 'friends.search.notFound',
  bad_link: 'friends.search.badLink',
};

async function search() {
  const text = query.value.trim();
  if (!text) return;
  // A word against the last try is stale once another is made.
  searchProblem.value = undefined;
  const reply = await run(() => lookUp(text));
  if (!reply) return;
  if (!reply.ok) {
    searchProblem.value = t(SEARCH_PROBLEMS[reply.error] ?? errorKey(reply.error));
    return;
  }
  openProfile(reply.found.handle, reply.found.username, foundDone);
}

// Something went through in the panel of the account found: the box is cleared, and the focus
// comes to it for the next search, once the panel has given it back to the button, which is
// disabled while the box is empty.
async function foundDone() {
  query.value = '';
  await nextTick();
  searchForm.value?.querySelector('input')?.focus();
}

// Each title that a friend holds, with the friends who hold it, in the order of the titles.
const board = computed(() =>
  DUO_TITLES.flatMap((title) => {
    const holders = (view.value?.friends ?? []).filter((friend) => friend.duo?.titles.includes(title));
    return holders.length > 0 ? [{ title, holders }] : [];
  }),
);

const games = (friend: FriendView) => (friend.duo ? duoLine(t, friend.duo) : '');

// The answers to a request in the list, and taking one back, as the panels answer (friends.ts).
async function answer(reply: 'accept' | 'decline' | 'remove', name: string) {
  await run(() => answerFriend(name, reply));
}

async function ask(friend: FriendView) {
  await run(() => askToJoin(friend.username));
}

function closeAll() {
  managing.value = null;
  naming.value = null;
  removing.value = null;
}
</script>

<template>
  <div class="friends">
    <form ref="searchForm" class="search" role="search" @submit.prevent="search">
      <UiField
        v-model="query"
        :label="t('friends.search.label')"
        :placeholder="t('friends.search.placeholder')"
        :maxlength="MAX_SEARCH_INPUT"
        autocomplete="off"
        inputmode="search"
        enterkeyhint="search"
        :error="searchProblem"
      >
        <template #beside>
          <!-- Not disabled while a search is on its way, which would let the focus go, and the panel
               that opens then give it back to nothing: a second press meanwhile is nothing (useBusy). -->
          <UiButton type="submit" :disabled="!query.trim()">{{ t('friends.search.submit') }}</UiButton>
        </template>
      </UiField>
    </form>
    <p class="hint">{{ t('friends.intro') }}</p>

    <p v-if="failed" class="hint">{{ t(errorKey(failed)) }}</p>
    <p v-else-if="view === null" class="hint">{{ t('friends.loading') }}</p>
    <template v-if="view">
      <section v-if="view.incoming.length" class="group">
        <h3>{{ t('friends.incoming') }}</h3>
        <ul class="list">
          <li v-for="other in view.incoming" :key="other.username" class="card request">
            <AvatarButton
              class="face"
              :handle="other.handle"
              :name="other.username"
              :avatar="other.avatar"
              size="medium"
            />
            <span class="top"
              ><span class="name">{{ other.username }}</span></span
            >
            <span v-if="other.note" class="note">{{ t('friends.noteQuoted', { note: other.note }) }}</span>
            <span class="end">
              <UiButton variant="primary" size="small" :disabled="busy" @click="answer('accept', other.username)">
                {{ t('friends.accept') }}
              </UiButton>
              <UiButton variant="quiet" size="small" :disabled="busy" @click="answer('decline', other.username)">
                {{ t('friends.decline') }}
              </UiButton>
            </span>
          </li>
        </ul>
      </section>

      <section v-if="view.outgoing.length" class="group">
        <h3>{{ t('friends.outgoing') }}</h3>
        <ul class="list">
          <li v-for="other in view.outgoing" :key="other.username" class="card request">
            <AvatarButton
              class="face"
              :handle="other.handle"
              :name="other.username"
              :avatar="other.avatar"
              size="medium"
            />
            <span class="top"
              ><span class="name">{{ other.username }}</span></span
            >
            <span class="end">
              <UiButton variant="quiet" size="small" :disabled="busy" @click="answer('remove', other.username)">
                {{ t('friends.withdraw') }}
              </UiButton>
            </span>
          </li>
        </ul>
      </section>

      <section class="group">
        <h3>{{ t('friends.title') }}</h3>
        <section v-if="board.length > 0" class="board" aria-labelledby="friends-board">
          <h4 id="friends-board">{{ t('duos.board') }}</h4>
          <ul class="holders">
            <li v-for="{ title, holders } in board" :key="title">
              <TitleInfo :title="{ kind: 'duo', duo: title }" class="pill press press-small" />
              <span v-for="friend in holders" :key="friend.username" class="holder">
                <AvatarButton :handle="friend.handle" :name="friend.username" :avatar="friend.avatar" />
                <span class="holder-name">{{ friend.alias ?? friend.username }}</span>
              </span>
            </li>
          </ul>
        </section>
        <p v-if="view.friends.length === 0" class="hint">{{ t('friends.none') }}</p>
        <ul v-else class="list">
          <li
            v-for="friend in view.friends"
            :key="friend.username"
            class="card friend"
            :class="{ offline: !friend.online }"
          >
            <span class="face">
              <AvatarButton :handle="friend.handle" :name="friend.username" :avatar="friend.avatar" size="medium" />
              <span v-if="friend.online" class="dot" aria-hidden="true"></span>
            </span>
            <p class="top">
              <span class="who">
                <span class="name">{{ friend.alias ?? friend.username }}</span>
                <span v-if="friend.alias" class="username">{{ friend.username }}</span>
              </span>
              <span class="sr-only">{{ t(friend.online ? 'friends.online' : 'friends.offline') }}</span>
              <RouterLink v-if="friend.room?.code" :to="`/room/${friend.room.code}`" class="join press press-small">{{
                t('friends.join')
              }}</RouterLink>
              <button
                v-else-if="friend.room"
                type="button"
                class="join press press-small"
                :disabled="busy || friend.asked"
                @click="ask(friend)"
              >
                {{ t(friend.asked ? 'friends.asked' : 'friends.askJoinRoom') }}
              </button>
            </p>
            <span class="end">
              <button
                type="button"
                class="more"
                :aria-label="t('friends.more', { name: friend.alias ?? friend.username })"
                aria-haspopup="dialog"
                :disabled="busy"
                @click="managing = friend"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <circle cx="5" cy="12" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="19" cy="12" r="2" />
                </svg>
              </button>
            </span>
            <div v-if="games(friend) || friend.duo?.titles.length" class="rest">
              <p v-if="games(friend)" class="games">{{ games(friend) }}</p>
              <FoldedTitles v-if="friend.duo?.titles.length" :titles="friend.duo.titles" />
            </div>
          </li>
        </ul>
      </section>
    </template>
    <UiButton v-if="view || failed" variant="quiet" size="small" :disabled="busy" @click="load">{{
      t('friends.refresh')
    }}</UiButton>

    <UiSheet
      :open="managing !== null && naming === null && removing === null"
      :title="managing?.alias ?? managing?.username ?? ''"
      :subtitle="managing?.alias ? managing.username : null"
      @close="closeAll"
    >
      <div class="confirm">
        <UiButton @click="naming = managing">{{ t('friends.aliasEdit') }}</UiButton>
        <UiButton variant="danger" @click="removing = managing">{{ t('friends.removeFriend') }}</UiButton>
        <UiButton variant="quiet" @click="closeAll">{{ t('account.cancel') }}</UiButton>
      </div>
    </UiSheet>

    <AliasSheet
      :open="naming !== null"
      :username="naming?.username ?? ''"
      :alias="naming?.alias ?? null"
      @close="closeAll"
      @saved="closeAll"
    />
    <UnfriendSheet
      :open="removing !== null"
      :handle="removing?.handle ?? ''"
      :username="removing?.username ?? ''"
      @close="closeAll"
      @removed="closeAll"
    />
  </div>
</template>

<style scoped>
/* The search across the section, with its button beside the box. */
.search {
  align-self: stretch;
}

.friends,
.group,
.confirm {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.friends {
  align-items: flex-start;
}

.group {
  align-self: stretch;
  gap: var(--space-2);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
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

/* A card: the avatar on the left; the name and where the friend is on the first line, with what
   can be done on its right; under them, across the card, the games played together and the
   titles. */
.card {
  display: grid;
  grid-template-areas:
    'face top end'
    'face rest rest';
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  column-gap: var(--space-3);
  padding: var(--space-3);
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-card);
  background: var(--paper);
}

.card.request {
  grid-template-areas:
    'face top end'
    'face note note';
  align-items: center;
}

.face {
  position: relative;
  grid-area: face;
  margin-top: 2px;
}

.request .face {
  margin-top: 0;
}

/* The line that came with a request, under the name and the buttons, across the card. */
.note {
  grid-area: note;
  min-width: 0;
  margin-top: var(--space-1);
  color: var(--ink-2);
  font-size: var(--text-sm);
  overflow-wrap: break-word;
}

.top {
  display: flex;
  flex-wrap: wrap;
  grid-area: top;
  align-items: baseline;
  align-self: center;
  column-gap: var(--space-2);
  min-width: 0;
  margin: 0;
}

.name {
  max-width: 100%;
  overflow: hidden;
  font-weight: var(--weight-black);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The username after the name the account gives a friend. */
.username {
  max-width: 100%;
  overflow: hidden;
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* A friend's line: the name, and the way into the room they are in, if any, on one line. A name
   that doesn't fit is cut short at its end, the username first; the way in never is. */
.friend .top {
  flex-wrap: nowrap;
  align-items: center;
}

.who {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.who .name,
.who .username {
  display: inline;
}

.who .username {
  margin-left: var(--space-2);
}

/* A friend who is online has a green dot on the avatar's corner, as in the sheet that invites
   friends to a room. */
.dot {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 11px;
  height: 11px;
  border: var(--line-thin) solid var(--ink);
  border-radius: 50%;
  background: var(--online);
  pointer-events: none;
}

.end {
  display: flex;
  grid-area: end;
  align-items: center;
  gap: var(--space-1);
  margin: -6px -6px 0 0;
}

.request .end {
  gap: var(--space-2);
  margin: 0;
}

/* Joining, or asking to, is the card's main action: a green pill with the outline of a main button
   (UiButton.vue) and, small as the title pills beside it, their small shadow and press
   (press-small), whose box reaches 44 px high, out of sight; once asked, it is grey and flat. */
.join {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  min-height: 30px;
  padding: 0 var(--space-2);
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--go);
  box-shadow: var(--shadow-0);
  color: var(--ink);
  font: inherit;
  font-size: var(--text-xs);
  font-weight: var(--weight-black);
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
}

.join:disabled {
  border-color: var(--neutral);
  background: var(--paper-2);
  box-shadow: none;
  color: var(--ink-2);
  cursor: default;
}

.join::before {
  content: '';
  position: absolute;
  inset: calc(50% - 22px) 0;
}

/* The card's other actions, behind three dots: as quiet as a button can be. */
.more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--ink-2);
  cursor: pointer;
}

.more svg {
  width: 22px;
  height: 22px;
  fill: currentcolor;
}

.rest {
  display: flex;
  flex-direction: column;
  grid-area: rest;
  gap: 2px;
  min-width: 0;
}

/* The line breaks only at its plain spaces, after the dot and between the words of the English
   copy: its no-break spaces keep each number with its word, and keep-all keeps the Chinese copy,
   which has no plain space, from breaking between two characters. */
.games {
  margin: 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
  word-break: keep-all;
}

.rest .folded-titles {
  margin-top: var(--space-2);
}

/* A friend who is offline: the whole card fades, its text still at 4.5:1 or more. */
.card.offline {
  border-color: var(--neutral);
  background: var(--paper-2);
}

.offline .face {
  opacity: 0.45;
}

/* The avatar's shadow fades with it, lifted as well as at rest (`--press-ink` in base.css). */
.offline .face :deep(.avatar) {
  --press-ink: var(--neutral);

  box-shadow: var(--shift-1) var(--shift-1) 0 var(--neutral);
}

.offline .name {
  color: var(--ink-2);
}

/* The pills of a friend who is offline are faded, their outline and the ink of their press and
   shadow grey (FoldedTitles.vue), which the press keeps as it lifts and drops them. */
.offline :deep(.folded-titles .pill) {
  --press-ink: var(--neutral);

  border-color: var(--neutral);
  background: var(--bg-tint);
  color: var(--ink-2);
}

.offline :deep(.folded-titles .pill.more) {
  background: var(--paper);
}

/* The friends' board, in the cards' look: each title as a pill, with who holds it. */
.board {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-card);
  background: var(--paper);
}

h4 {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
}

.holders {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.holders li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
}

/* A title is a pill whose box reaches 44 px high, out of sight; the rows are 12 px apart, more than
   it reaches on either side. */
.holders .pill {
  position: relative;
  padding: 2px var(--space-2);
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--bg);
  box-shadow: var(--shadow-0);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  line-height: 1.5;
}

.holders .pill::before {
  content: '';
  position: absolute;
  inset: calc(50% - 22px) 0;
}

/* Each friend who holds a title: the avatar and the name, side by side, never apart. */
.holder {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  max-width: 100%;
}

.holder-name {
  min-width: 0;
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

<script setup lang="ts">
import {
  checkAlias,
  checkFriendNote,
  DUO_TITLES,
  FRIEND_NOTE_LENGTH,
  formatCode,
  MAX_FRIEND_ALIAS_INPUT,
  MAX_FRIEND_NOTE_INPUT,
  MAX_NAME_INPUT,
  PROFILE_PATH,
  textLength,
  type FriendView,
} from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import AvatarButton from '../components/AvatarButton.vue';
import FoldedTitles from '../components/FoldedTitles.vue';
import TitleInfo from '../components/TitleInfo.vue';
import UiButton from '../components/UiButton.vue';
import UiField from '../components/UiField.vue';
import UiSheet from '../components/UiSheet.vue';
import { duoLine } from '../duos';
import { errorKey } from '../errors';
import { askToJoin } from '../friends';
import { send } from '../socket';
import { toast, toastError } from '../toast';
import { useBusy } from '../useBusy';
import { useFriendsList } from '../useFriendsList';

// The account's friends (docs/architecture.md#friends): the way to ask someone by their username,
// with a line for them if the account likes, the requests waiting for an answer each way, the line
// that came with each request for the account under its name, and the friends, each on a card: the
// avatar, which leads to the account's public page, the name and whether they are online and where;
// under it, in small type, what the account has played with them, and the titles they hold among
// its friends (docs/architecture.md#friend-duos), on one line, folded where they don't fit. The
// friends' board above the list sums the titles up, in the same look, each with the avatar and the
// name of the friends who hold it, the avatar leading to their page as on the cards. A friend who
// is offline has the whole card faded, still readable. A friend in a public room can be joined from
// here; one in a private room only by their invitation, which the account may ask them for
// (askToJoin), and which the card says it has while the request stands. A friend whom the account
// has given a name of its own (an alias, for the account alone) goes by it, with the username after
// it in small grey type, here and in the sheets about them. The card's "more" button opens a sheet
// with the friend's name, from which the account gives them a name, or takes it away by leaving it
// empty, or removes them, after asking first. A change made here comes back as the word that the
// server sends both sides, on which the list is asked for again (useFriendsList); after a refusal
// it is asked for here, since the list may have been out of date.
const { t } = useI18n();
const { view, failed, load } = useFriendsList();
const username = ref('');
const note = ref('');
const problem = ref<string | undefined>();
const checkedNote = computed(() => checkFriendNote(note.value));
const noteProblem = computed(() => (checkedNote.value.problem ? t(errorKey(checkedNote.value.problem)) : undefined));
const noteCount = computed(() =>
  t('friends.noteCount', { count: textLength(checkedNote.value.note ?? ''), max: FRIEND_NOTE_LENGTH }),
);
// The friend whose "more" sheet is open, the one being given a name, with the name as typed, and
// the one about to be removed.
const managing = ref<FriendView | null>(null);
const naming = ref<FriendView | null>(null);
const alias = ref('');
const aliasRefused = ref<string | undefined>();
const removing = ref<FriendView | null>(null);
const { busy, run } = useBusy();
const checkedAlias = computed(() => checkAlias(alias.value));
const aliasProblem = computed(
  () => aliasRefused.value ?? (checkedAlias.value.problem ? t(errorKey(checkedAlias.value.problem)) : undefined),
);
watch(alias, () => (aliasRefused.value = undefined));

watch(username, () => (problem.value = undefined));

// Each title that a friend holds, with the friends who hold it, in the order of the titles.
const board = computed(() =>
  DUO_TITLES.flatMap((title) => {
    const holders = (view.value?.friends ?? []).filter((friend) => friend.duo?.titles.includes(title));
    return holders.length > 0 ? [{ title, holders }] : [];
  }),
);

const page = (handle: string) => `${PROFILE_PATH}${handle}`;
const games = (friend: FriendView) => (friend.duo ? duoLine(t, friend.duo) : '');

async function request() {
  if (checkedNote.value.problem) return;
  const line = checkedNote.value.note;
  const reply = await run(() =>
    send<{ status: 'pending' | 'accepted' }>('friends:request', {
      username: username.value,
      ...(line === null ? {} : { note: line }),
    }),
  );
  if (!reply) return;
  if (!reply.ok) {
    problem.value = t(errorKey(reply.error));
    return;
  }
  username.value = '';
  note.value = '';
  toast(reply.status === 'accepted' ? 'friends.nowFriends' : 'friends.requestSent');
}

async function answer(message: 'friends:accept' | 'friends:decline' | 'friends:remove', name: string) {
  const reply = await run(() => send(message, { username: name }));
  if (!reply) return;
  removing.value = null;
  managing.value = null;
  if (reply.ok) return;
  toastError(reply.error);
  void load();
}

async function ask(friend: FriendView) {
  await run(() => askToJoin(friend.username));
}

function startNaming(friend: FriendView) {
  alias.value = friend.alias ?? '';
  aliasRefused.value = undefined;
  naming.value = friend;
}

function closeAll() {
  managing.value = null;
  naming.value = null;
  removing.value = null;
}

async function saveAlias() {
  const friend = naming.value;
  if (!friend || checkedAlias.value.problem) return;
  const reply = await run(() => send('friends:alias', { username: friend.username, alias: alias.value }));
  if (!reply) return;
  if (!reply.ok) {
    aliasRefused.value = t(errorKey(reply.error));
    return;
  }
  closeAll();
  void load();
}
</script>

<template>
  <div class="friends">
    <p class="hint">{{ t('friends.intro') }}</p>
    <form class="add" @submit.prevent="request">
      <UiField
        v-model="username"
        :label="t('friends.addLabel')"
        :maxlength="MAX_NAME_INPUT"
        autocomplete="off"
        enterkeyhint="send"
        :error="problem"
      />
      <UiField
        v-model="note"
        :label="t('friends.noteLabel')"
        :maxlength="MAX_FRIEND_NOTE_INPUT"
        autocomplete="off"
        enterkeyhint="send"
        :hint="noteCount"
        :error="noteProblem"
      />
      <UiButton type="submit" :disabled="busy || !username.trim() || checkedNote.problem !== null">{{
        t('friends.addSubmit')
      }}</UiButton>
    </form>

    <p v-if="failed" class="hint">{{ t(errorKey(failed)) }}</p>
    <p v-else-if="view === null" class="hint">{{ t('friends.loading') }}</p>
    <template v-if="view">
      <section v-if="view.incoming.length" class="group">
        <h3>{{ t('friends.incoming') }}</h3>
        <ul class="list">
          <li v-for="other in view.incoming" :key="other.username" class="card request">
            <AvatarButton
              class="face"
              :to="page(other.handle)"
              :name="other.username"
              :avatar="other.avatar"
              size="medium"
            />
            <span class="top"
              ><span class="name">{{ other.username }}</span></span
            >
            <span v-if="other.note" class="note">{{ t('friends.noteQuoted', { note: other.note }) }}</span>
            <span class="end">
              <UiButton
                variant="primary"
                size="small"
                :disabled="busy"
                @click="answer('friends:accept', other.username)"
              >
                {{ t('friends.accept') }}
              </UiButton>
              <UiButton
                variant="quiet"
                size="small"
                :disabled="busy"
                @click="answer('friends:decline', other.username)"
              >
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
              :to="page(other.handle)"
              :name="other.username"
              :avatar="other.avatar"
              size="medium"
            />
            <span class="top"
              ><span class="name">{{ other.username }}</span></span
            >
            <span class="end">
              <UiButton variant="quiet" size="small" :disabled="busy" @click="answer('friends:remove', other.username)">
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
              <TitleInfo :title="{ kind: 'duo', duo: title }" class="pill" />
              <span v-for="friend in holders" :key="friend.username" class="holder">
                <AvatarButton :to="page(friend.handle)" :name="friend.username" :avatar="friend.avatar" />
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
            <AvatarButton
              class="face"
              :to="page(friend.handle)"
              :name="friend.username"
              :avatar="friend.avatar"
              size="medium"
            />
            <p class="top">
              <span class="name">{{ friend.alias ?? friend.username }}</span>
              <span v-if="friend.alias" class="username">{{ friend.username }}</span>
              <span class="where">
                <span class="dot" :class="{ on: friend.online }" aria-hidden="true"></span>
                {{ t(friend.online ? 'friends.online' : 'friends.offline') }}
                <template v-if="friend.room">
                  ·
                  <i18n-t v-if="friend.room.code" keypath="friends.inPublicRoom" tag="span" scope="global">
                    <template #code>
                      <span class="code">{{ formatCode(friend.room.code) }}</span>
                    </template>
                  </i18n-t>
                  <template v-else>{{ t('friends.inRoom') }}</template>
                </template>
              </span>
            </p>
            <span class="end">
              <RouterLink v-if="friend.room?.code" :to="`/room/${friend.room.code}`" class="join">{{
                t('friends.join')
              }}</RouterLink>
              <button
                v-else-if="friend.room"
                type="button"
                class="join"
                :disabled="busy || friend.asked"
                @click="ask(friend)"
              >
                {{ t(friend.asked ? 'friends.asked' : 'friends.askJoin') }}
              </button>
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
        <UiButton :disabled="busy" @click="managing && startNaming(managing)">{{ t('friends.aliasEdit') }}</UiButton>
        <UiButton variant="danger" :disabled="busy" @click="removing = managing">
          {{ t('friends.removeFriend') }}
        </UiButton>
        <UiButton variant="quiet" @click="closeAll">{{ t('account.cancel') }}</UiButton>
      </div>
    </UiSheet>

    <UiSheet
      :open="naming !== null"
      :title="t('friends.aliasTitle', { name: naming?.username ?? '' })"
      @close="closeAll"
    >
      <form class="confirm" @submit.prevent="saveAlias">
        <UiField
          v-model="alias"
          :label="t('friends.aliasLabel')"
          :maxlength="MAX_FRIEND_ALIAS_INPUT"
          autocomplete="off"
          enterkeyhint="done"
          :hint="t('friends.aliasHint')"
          :error="aliasProblem"
        />
        <UiButton variant="primary" type="submit" :disabled="busy || checkedAlias.problem !== null">
          {{ t('friends.aliasSave') }}
        </UiButton>
        <UiButton variant="quiet" @click="closeAll">{{ t('account.cancel') }}</UiButton>
      </form>
    </UiSheet>

    <UiSheet :open="removing !== null" :title="removing?.username ?? ''" @close="closeAll">
      <div class="confirm">
        <p>{{ t('friends.removeConfirm', { name: removing?.username ?? '' }) }}</p>
        <UiButton variant="danger" :disabled="busy" @click="answer('friends:remove', removing?.username ?? '')">
          {{ t('friends.removeFriend') }}
        </UiButton>
        <UiButton variant="quiet" @click="closeAll">{{ t('account.cancel') }}</UiButton>
      </div>
    </UiSheet>
  </div>
</template>

<style scoped>
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

/* The username, the line for them, and the button under both. */
.add {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-self: stretch;
}

.add > button {
  align-self: flex-start;
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

.where {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  white-space: nowrap;
}

.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border: var(--line-thin) solid var(--ink);
  border-radius: 50%;
  background: var(--neutral);
}

.dot.on {
  background: var(--online);
}

/* A room's number never breaks in two. */
.code {
  white-space: nowrap;
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

/* Joining, or asking to, is an ink pill whose box reaches 44 px high, out of sight; once asked, it
   is grey. */
.join {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--on-ink);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
}

.join:disabled {
  background: var(--paper-2);
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

.offline .face :deep(.avatar) {
  box-shadow: var(--shift-1) var(--shift-1) 0 var(--neutral);
}

.offline .name {
  color: var(--ink-2);
}

.offline .dot {
  border-color: var(--ink-2);
}

.offline :deep(.folded-titles .pill) {
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

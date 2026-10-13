<script setup lang="ts">
import { DUO_TITLES, formatCode, MAX_NAME_INPUT, PROFILE_PATH, type FriendView } from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import DuoSummary from '../components/DuoSummary.vue';
import PlayerAvatar from '../components/PlayerAvatar.vue';
import TitleInfo from '../components/TitleInfo.vue';
import UiButton from '../components/UiButton.vue';
import UiField from '../components/UiField.vue';
import UiSheet from '../components/UiSheet.vue';
import { errorKey } from '../errors';
import { formatList } from '../i18n';
import { send } from '../socket';
import { toast, toastError } from '../toast';
import { useBusy } from '../useBusy';
import { useFriendsList } from '../useFriendsList';

// The account's friends (docs/architecture.md#friends): the way to ask someone by their username,
// the requests waiting for an answer each way, and the friends, each with whether they are online
// and where, and what the account has played with them and the titles they hold among its friends
// (docs/architecture.md#friend-duos), which the friends' board above the list sums up. Every name
// leads to that account's public page. A friend in a public room can be joined from here; one in a
// private room only by their invitation. A change made here comes back as the word that the server
// sends both sides, on which the list is asked for again (useFriendsList); after a refusal it is
// asked for here, since the list may have been out of date.
const { t, locale } = useI18n();
const { view, failed, load } = useFriendsList();
const username = ref('');
const problem = ref<string | undefined>();
const removing = ref<FriendView | null>(null);
const { busy, run } = useBusy();

watch(username, () => (problem.value = undefined));

// Each title that a friend holds, with the friends who hold it, in the order of the titles.
const board = computed(() =>
  DUO_TITLES.flatMap((title) => {
    const holders = (view.value?.friends ?? []).filter((friend) => friend.duo?.titles.includes(title));
    return holders.length > 0
      ? [
          {
            title,
            names: formatList(
              locale.value,
              holders.map(({ username }) => username),
            ),
          },
        ]
      : [];
  }),
);

async function request() {
  const reply = await run(() =>
    send<{ status: 'pending' | 'accepted' }>('friends:request', { username: username.value }),
  );
  if (!reply) return;
  if (!reply.ok) {
    problem.value = t(errorKey(reply.error));
    return;
  }
  username.value = '';
  toast(reply.status === 'accepted' ? 'friends.nowFriends' : 'friends.requestSent');
}

async function answer(message: 'friends:accept' | 'friends:decline' | 'friends:remove', name: string) {
  const reply = await run(() => send(message, { username: name }));
  if (!reply) return;
  removing.value = null;
  if (reply.ok) return;
  toastError(reply.error);
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
      <UiButton type="submit" :disabled="busy || !username.trim()">{{ t('friends.addSubmit') }}</UiButton>
    </form>

    <p v-if="failed" class="hint">{{ t(errorKey(failed)) }}</p>
    <p v-else-if="view === null" class="hint">{{ t('friends.loading') }}</p>
    <template v-if="view">
      <section v-if="view.incoming.length" class="group">
        <h3>{{ t('friends.incoming') }}</h3>
        <ul class="list">
          <li v-for="other in view.incoming" :key="other.username" class="line">
            <PlayerAvatar :name="other.username" :avatar="other.avatar" />
            <RouterLink :to="`${PROFILE_PATH}${other.handle}`" class="name">{{ other.username }}</RouterLink>
            <UiButton variant="primary" size="small" :disabled="busy" @click="answer('friends:accept', other.username)">
              {{ t('friends.accept') }}
            </UiButton>
            <UiButton variant="quiet" size="small" :disabled="busy" @click="answer('friends:decline', other.username)">
              {{ t('friends.decline') }}
            </UiButton>
          </li>
        </ul>
      </section>

      <section v-if="view.outgoing.length" class="group">
        <h3>{{ t('friends.outgoing') }}</h3>
        <ul class="list">
          <li v-for="other in view.outgoing" :key="other.username" class="line">
            <PlayerAvatar :name="other.username" :avatar="other.avatar" />
            <RouterLink :to="`${PROFILE_PATH}${other.handle}`" class="name">{{ other.username }}</RouterLink>
            <UiButton variant="quiet" size="small" :disabled="busy" @click="answer('friends:remove', other.username)">
              {{ t('friends.withdraw') }}
            </UiButton>
          </li>
        </ul>
      </section>

      <section class="group">
        <h3>{{ t('friends.title') }}</h3>
        <section v-if="board.length > 0" class="board" aria-labelledby="friends-board">
          <h4 id="friends-board">{{ t('duos.board') }}</h4>
          <ul class="holders">
            <li v-for="{ title, names } in board" :key="title">
              <TitleInfo :title="{ kind: 'duo', duo: title }" class="holder-title" />
              <span class="holder-names">{{ names }}</span>
            </li>
          </ul>
        </section>
        <p v-if="view.friends.length === 0" class="hint">{{ t('friends.none') }}</p>
        <ul v-else class="list">
          <li v-for="friend in view.friends" :key="friend.username" class="line" :class="{ offline: !friend.online }">
            <span class="dot" :class="{ on: friend.online }" aria-hidden="true"></span>
            <PlayerAvatar :name="friend.username" :avatar="friend.avatar" :class="{ away: !friend.online }" />
            <span class="who">
              <RouterLink :to="`${PROFILE_PATH}${friend.handle}`" class="name">{{ friend.username }}</RouterLink>
              <span class="where">
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
              <DuoSummary v-if="friend.duo" :duo="friend.duo" class="duo" />
            </span>
            <RouterLink v-if="friend.room?.code" :to="`/room/${friend.room.code}`" class="join">{{
              t('friends.join')
            }}</RouterLink>
            <UiButton variant="quiet" size="small" :disabled="busy" @click="removing = friend">
              {{ t('friends.remove') }}
            </UiButton>
          </li>
        </ul>
      </section>
    </template>
    <UiButton v-if="view || failed" variant="quiet" size="small" :disabled="busy" @click="load">{{
      t('friends.refresh')
    }}</UiButton>

    <UiSheet :open="removing !== null" :title="t('friends.remove')" @close="removing = null">
      <div class="confirm">
        <p>{{ t('friends.removeConfirm', { name: removing?.username ?? '' }) }}</p>
        <UiButton variant="danger" :disabled="busy" @click="answer('friends:remove', removing?.username ?? '')">
          {{ t('friends.remove') }}
        </UiButton>
        <UiButton variant="quiet" @click="removing = null">{{ t('account.cancel') }}</UiButton>
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

.add {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: start;
  align-self: stretch;
}

/* Level with the box, below the field's label. */
.add > button {
  margin-top: calc(var(--text-sm) * 1.55 + var(--space-2));
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

.dot {
  flex: none;
  width: 10px;
  height: 10px;
  border: var(--line-thin) solid var(--ink);
  border-radius: 50%;
  background: var(--paper);
}

.dot.on {
  background: var(--ink);
}

.away {
  opacity: 0.5;
}

.who {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

/* The name is a link on one line of text. Padding that the margins take back makes it 44px tall
   to tap, as the buttons beside it are, without moving anything. */
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

.offline .name {
  color: var(--ink-2);
}

.where {
  color: var(--ink-2);
  font-size: var(--text-xs);
}

.duo {
  margin-top: var(--space-1);
}

/* The friends' board: each title on a line, with who holds it. */
.board {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-card);
  background: var(--bg);
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
  margin: 0;
  padding: 0;
  list-style: none;
}

.holders li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 var(--space-2);
}

/* A title is one line of bold text, 44px tall to tap. */
.holder-title {
  min-height: 44px;
  font-weight: var(--weight-black);
}

.holder-names {
  overflow-wrap: anywhere;
}

/* A room's number never breaks in two. */
.code {
  white-space: nowrap;
}

.join {
  display: inline-flex;
  flex: none;
  align-items: center;
  min-height: 44px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--on-ink);
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
  text-decoration: none;
}
</style>

<script setup lang="ts">
import { PROFILE_PATH, type FriendRoomView } from '@reviewer2/shared';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { account } from '../account';
import AvatarButton from '../components/AvatarButton.vue';
import UiButton from '../components/UiButton.vue';
import { askToJoin, friendsVersion } from '../friends';
import { connect, send, socket } from '../socket';
import { useBusy } from '../useBusy';

// The rooms that the account's friends are in (docs/architecture.md#friends), on the home page, for
// an account alone, and only while some friend is in a room where the account has no seat: a row a
// room, with the friends in it, each by the name the account gives them, if any, and whether a game
// is on. A public room has its Join link; a private one, whose number nobody tells, the way to ask
// the first friend in it to be let in, which says "Asked" while the request stands. The list is asked
// for when the page opens, on every connection after that, whenever the server says that the friends
// changed, which it does when a request is sent and when it ends, and when the page comes back into
// sight, since who is where changes all the time.
const { t } = useI18n();
const rooms = ref<FriendRoomView[]>([]);
const { busy, run } = useBusy();
const loggedIn = computed(() => account.summary !== null);
let asked = 0;

async function load() {
  const turn = (asked += 1);
  const reply = await send<{ rooms: FriendRoomView[] }>('friends:rooms');
  if (turn !== asked) return;
  if (reply.ok) rooms.value = reply.rooms;
  else if (reply.error === 'offline') connect();
}

const refresh = () => {
  if (loggedIn.value) void load();
};
const backInSight = () => {
  if (document.visibilityState === 'visible') refresh();
};

watch(
  loggedIn,
  (on) => {
    rooms.value = [];
    if (!on) return;
    if (socket.connected) void load();
    else connect();
  },
  { immediate: true },
);
watch(friendsVersion, refresh);
onMounted(() => {
  socket.on('connect', refresh);
  document.addEventListener('visibilitychange', backInSight);
});
onBeforeUnmount(() => {
  socket.off('connect', refresh);
  document.removeEventListener('visibilitychange', backInSight);
});

const names = (room: FriendRoomView) =>
  room.friends.map((friend) => friend.alias ?? friend.username).join(t('home.friendsPlaying.and'));
const pending = (room: FriendRoomView) => room.friends.some((friend) => friend.asked);

async function ask(room: FriendRoomView) {
  const friend = room.friends[0];
  if (!friend) return;
  await run(() => askToJoin(friend.username));
}
</script>

<template>
  <section v-if="loggedIn && rooms.length > 0" class="friends-playing" aria-labelledby="friends-playing">
    <h2 id="friends-playing">{{ t('home.friendsPlaying.title') }}</h2>
    <ul class="rooms">
      <li v-for="(room, index) in rooms" :key="room.code ?? `private-${index}`" class="room">
        <div class="who">
          <span class="faces">
            <AvatarButton
              v-for="friend in room.friends"
              :key="friend.username"
              :to="`${PROFILE_PATH}${friend.handle}`"
              :name="friend.username"
              :avatar="friend.avatar"
            />
          </span>
          <span class="names">{{ names(room) }}</span>
          <span class="status" :class="{ playing: room.playing }">
            {{ t(room.playing ? 'home.publicRooms.playing' : 'home.publicRooms.waiting') }}
          </span>
        </div>
        <RouterLink v-if="room.code" :to="`/room/${room.code}`" class="join">{{
          t('home.publicRooms.join')
        }}</RouterLink>
        <UiButton v-else-if="pending(room)" size="small" disabled>{{ t('friends.asked') }}</UiButton>
        <UiButton v-else size="small" :disabled="busy" @click="ask(room)">{{ t('friends.askJoin') }}</UiButton>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.friends-playing {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

h2 {
  font-size: var(--text-xl);
}

.rooms {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.room {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--paper);
  box-shadow: var(--shadow-1);
}

.who {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  min-width: 0;
}

/* The friends' avatars overlap a little, as a group of faces. */
.faces {
  display: inline-flex;
  flex: none;
}

.faces > * + * {
  margin-left: -6px;
}

.names {
  min-width: 0;
  font-weight: var(--weight-black);
  overflow-wrap: anywhere;
}

.status {
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--on-ink);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  line-height: 1.6;
  white-space: nowrap;
}

.status.playing {
  background: var(--neutral);
  color: var(--on-neutral);
}

.join {
  display: inline-flex;
  flex: none;
  align-items: center;
  min-height: 44px;
  padding: 0 var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
  font-weight: var(--weight-bold);
  text-decoration: none;
}

.room > :last-child {
  flex: none;
}
</style>

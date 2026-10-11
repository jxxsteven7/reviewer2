<script setup lang="ts">
import type { PublicRoom } from '@reviewer2/shared';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { account } from '../account';
import UiButton from '../components/UiButton.vue';
import { errorKey } from '../errors';
import { fields, loadFields } from '../fields';
import { onceConnected, send } from '../socket';

// The public rooms, which anyone with an account can join (docs/architecture.md#public-rooms).
// The list is asked for when it is opened and whenever the player asks again; it changes as rooms
// come and go, so it isn't kept. A guest sees the list, and is told to log in; the room page says
// so again when they try to join.
const { t } = useI18n();
const open = ref(false);
const rooms = ref<PublicRoom[] | null>(null);
// Why the last answer didn't come, if it didn't.
const failed = ref<string | null>(null);
const fieldNames = computed(() => new Map((fields.value ?? []).map((field) => [field.id, field.name])));

// What waits for a connection to ask for the list, and the way to call it off.
let waiting = () => {};

async function load() {
  waiting();
  failed.value = null;
  rooms.value = null;
  const reply = await send<{ rooms: PublicRoom[] }>('meta:rooms');
  if (reply.ok) rooms.value = reply.rooms;
  else {
    failed.value = reply.error;
    // The text then says that the page waits for the connection, so it does.
    if (reply.error === 'offline') waiting = onceConnected(() => void load());
  }
}

// The home page may have no connection yet; the list is asked for once there is one.
function show() {
  open.value = true;
  loadFields();
  waiting = onceConnected(() => void load());
}

// Back to the button, and no more waiting for a connection.
function hide() {
  waiting();
  open.value = false;
  rooms.value = null;
  failed.value = null;
}

onBeforeUnmount(() => waiting());

const listsOf = (room: PublicRoom) =>
  room.fields.map((id) => fieldNames.value.get(id)?.[room.language] ?? id).join(' · ');
</script>

<template>
  <section class="public-rooms">
    <UiButton v-if="!open" variant="blue" @click="show">{{ t('home.publicRooms.open') }}</UiButton>
    <template v-else>
      <div class="head">
        <h2>{{ t('home.publicRooms.title') }}</h2>
        <UiButton size="small" variant="quiet" @click="hide">{{ t('home.publicRooms.hide') }}</UiButton>
      </div>
      <p class="hint">
        {{ t('home.publicRooms.intro') }}
        <RouterLink v-if="account.loaded && !account.summary" to="/account">{{
          t('home.publicRooms.loginHint')
        }}</RouterLink>
      </p>
      <p v-if="failed" class="hint">{{ t(errorKey(failed)) }}</p>
      <p v-else-if="rooms === null" class="hint">{{ t('home.publicRooms.loading') }}</p>
      <p v-else-if="rooms.length === 0" class="hint">{{ t('home.publicRooms.none') }}</p>
      <ul v-else class="rooms">
        <li v-for="room in rooms" :key="room.code" class="room">
          <div class="facts">
            <span class="game">{{ t(`home.games.${room.game}.name`) }}</span>
            <span class="status" :class="{ playing: room.playing }">
              {{ t(room.playing ? 'home.publicRooms.playing' : 'home.publicRooms.waiting') }}
            </span>
            <span class="detail">{{ t(`language.${room.language}`) }} · {{ listsOf(room) }}</span>
            <span class="detail">{{ t('home.publicRooms.players', { count: room.players }) }}</span>
          </div>
          <RouterLink :to="`/room/${room.code}`" class="join">{{ t('home.publicRooms.join') }}</RouterLink>
        </li>
      </ul>
      <UiButton size="small" variant="quiet" @click="load">{{ t('home.publicRooms.refresh') }}</UiButton>
    </template>
  </section>
</template>

<style scoped>
.public-rooms {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  align-self: stretch;
}

h2 {
  font-size: var(--text-xl);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.rooms {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-self: stretch;
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

.facts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  min-width: 0;
}

.game {
  font-weight: var(--weight-black);
}

.status {
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--on-ink);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  line-height: 1.6;
}

.status.playing {
  background: var(--neutral);
  color: var(--on-neutral);
}

.detail {
  flex-basis: 100%;
  color: var(--ink-2);
  font-size: var(--text-sm);
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
</style>

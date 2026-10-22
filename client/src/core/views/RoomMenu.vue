<script setup lang="ts">
import { nextChair, type Ack, type PlayerView, type RoomView } from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { account } from '../account';
import InviteFriends from '../components/InviteFriends.vue';
import PlayerAvatar from '../components/PlayerAvatar.vue';
import SendFeedback from '../components/SendFeedback.vue';
import SoundToggle from '../components/SoundToggle.vue';
import UiButton from '../components/UiButton.vue';
import UiSheet from '../components/UiSheet.vue';
import { closeRoom, leaveRoom } from '../room';
import { act } from '../socket';
import { toastError } from '../toast';
import { useBusy } from '../useBusy';

// The room menu, behind the "Room" button in the masthead: who you are, whether the room is public
// or private, the way to leave, for an account the way to invite friends during a
// game and while a finished match's ranking stands in the waiting room (docs/architecture.md#friends),
// which the waiting room's start bar has otherwise, the switch for the sounds, which the quick
// reactions offer too,
// and the way to send the author feedback. The chair can also list the room on the home page or
// take it off, in the waiting room (as the tag beside the waiting room's heading does), and close
// the room for everyone, in the waiting room, during a game and after it. A player who is logged
// in is called by their username, which changes on the account page, and a guest by the number the
// room gave them. Each action opens its own sheet over the menu, as it did when they stood at the
// foot of the page.
const props = defineProps<{ room: RoomView; me: PlayerView }>();
const { t } = useI18n();
const router = useRouter();
const open = ref(false);
const inviting = ref(false);
const leaving = ref(false);
const closing = ref(false);
const { busy, run } = useBusy();

const isChair = computed(() => props.room.chairId === props.me.id);
// A finished match's ranking stands in the waiting room, where the start bar would be.
const matchOver = computed(() => props.room.match !== null && props.room.match.status !== 'on');
// Whoever would chair the room after the chair has left, by the server's own rule. Nobody, when
// the chair is the last one.
const successor = computed(() => {
  const id = nextChair(props.room.players.filter((player) => player.id !== props.me.id));
  return props.room.players.find((player) => player.id === id) ?? null;
});
// The chair's says who chairs the room next, and, where that ends the match (MatchView.chairBound),
// that it does.
const leaveText = computed(() => {
  if (!isChair.value) return t('room.leaveConfirm');
  if (!successor.value) return t('room.leaveLast');
  const key = props.room.match?.chairBound ? 'room.leaveChairMatch' : 'room.leaveChair';
  return t(key, { name: successor.value.name });
});

// A chair who hands the chair over, or loses it while away, can't close the room any more.
watch(isChair, (chair) => {
  if (!chair) closing.value = false;
});

// Leaving and closing both end on the home page.
async function goAway(action: () => Promise<Ack>) {
  const reply = await run(action);
  if (!reply) return;
  if (!reply.ok) {
    toastError(reply.error);
    return;
  }
  await router.push('/');
}

function closeInstead() {
  leaving.value = false;
  closing.value = true;
}

// Listing the room takes an account, which the menu says; the server says what else keeps the room
// from being listed, such as that the account was barred from public rooms.
const setPublic = (value: boolean) => act('room:public', { public: value });
</script>

<template>
  <UiButton class="room-button" size="small" @click="open = true">{{ t('room.menu') }}</UiButton>

  <UiSheet :open="open" :title="t('room.menu')" @close="open = false">
    <div class="room-menu">
      <p class="who">
        <PlayerAvatar :name="me.name" :guest="me.guest" :avatar="me.avatar" size="medium" />
        <span class="name">{{ me.name }}</span>
      </p>
      <p class="visibility">{{ t(room.public ? 'room.listed' : 'room.unlisted') }}</p>
      <template v-if="isChair && room.phase === 'lobby'">
        <UiButton v-if="room.public" @click="setPublic(false)">{{ t('room.makePrivate') }}</UiButton>
        <UiButton v-else :disabled="!account.summary" @click="setPublic(true)">{{ t('room.makePublic') }}</UiButton>
        <p v-if="!room.public" class="hint">{{ t(account.summary ? 'room.publicHint' : 'room.publicNeedsAccount') }}</p>
      </template>
      <UiButton v-if="account.summary && (room.phase !== 'lobby' || matchOver)" @click="inviting = true">{{
        t('friends.invite')
      }}</UiButton>
      <SoundToggle />
      <UiButton @click="leaving = true">{{ t('room.leave') }}</UiButton>
      <UiButton v-if="isChair" variant="danger" @click="closing = true">{{ t('room.closeRoom') }}</UiButton>
      <SendFeedback page="room" />
    </div>
  </UiSheet>

  <InviteFriends :open="inviting" :room="room" @close="inviting = false" />

  <UiSheet :open="leaving" :title="t('room.leave')" @close="leaving = false">
    <div class="sheet-form">
      <p>{{ leaveText }}</p>
      <UiButton variant="danger" :disabled="busy" @click="goAway(leaveRoom)">{{ t('room.leave') }}</UiButton>
      <UiButton v-if="isChair && successor" @click="closeInstead">{{ t('room.closeInstead') }}</UiButton>
      <UiButton variant="quiet" @click="leaving = false">{{ t('lobby.manage.cancel') }}</UiButton>
    </div>
  </UiSheet>

  <UiSheet :open="closing" :title="t('room.closeRoom')" @close="closing = false">
    <div class="sheet-form">
      <p>{{ t(room.phase === 'playing' ? 'room.closeConfirmGame' : 'room.closeConfirm') }}</p>
      <UiButton variant="danger" :disabled="busy" @click="goAway(closeRoom)">{{ t('room.closeRoom') }}</UiButton>
      <UiButton variant="quiet" @click="closing = false">{{ t('lobby.manage.cancel') }}</UiButton>
    </div>
  </UiSheet>
</template>

<style scoped>
.room-button {
  flex: none;
}

.room-menu,
.sheet-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.who {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
  font-size: var(--text-lg);
  font-weight: var(--weight-black);
}

.name {
  overflow-wrap: anywhere;
}

.visibility {
  font-weight: var(--weight-bold);
}

.hint {
  margin-top: calc(-1 * var(--space-2));
  color: var(--ink-2);
  font-size: var(--text-sm);
}

/* The feedback button sits with the others, at their width. */
.room-menu > :deep(.button.quiet) {
  align-self: flex-start;
}
</style>

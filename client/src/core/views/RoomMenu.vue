<script setup lang="ts">
import { MAX_NAME_INPUT, nextChair, type Ack, type PlayerView, type RoomView } from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { account } from '../account';
import PlayerAvatar from '../components/PlayerAvatar.vue';
import SendFeedback from '../components/SendFeedback.vue';
import UiButton from '../components/UiButton.vue';
import UiField from '../components/UiField.vue';
import UiSheet from '../components/UiSheet.vue';
import { closeRoom, leaveRoom } from '../room';
import { storeName } from '../session';
import { send } from '../socket';
import { toastError } from '../toast';
import { useBusy } from '../useBusy';
import { useNameField } from '../useNameField';

// The room menu, behind the "Room" button in the masthead: who you are, ways to rename yourself
// or leave, and the way to send the author feedback. The chair can also close the room for
// everyone, in the waiting room, during a game and after it. A player who is logged in is called
// by their username, which changes on the account page, not here. Each action opens its own
// sheet over the menu, as it did when they stood at the foot of the page.
const props = defineProps<{ room: RoomView; me: PlayerView }>();
const { t } = useI18n();
const router = useRouter();
const open = ref(false);
const renaming = ref(false);
const leaving = ref(false);
const closing = ref(false);
const { name, clean, problem, refuse } = useNameField();
const { busy, run } = useBusy();

const isChair = computed(() => props.room.chairId === props.me.id);
// Whoever would chair the room after the chair has left, by the server's own rule. Nobody, when
// the chair is the last one.
const successor = computed(() => {
  const id = nextChair(props.room.players.filter((player) => player.id !== props.me.id));
  return props.room.players.find((player) => player.id === id) ?? null;
});
const leaveText = computed(() => {
  if (!isChair.value) return t('room.leaveConfirm');
  return successor.value ? t('room.leaveChair', { name: successor.value.name }) : t('room.leaveLast');
});

// A chair who hands the chair over, or loses it while away, can't close the room any more.
watch(isChair, (chair) => {
  if (!chair) closing.value = false;
});

function startRenaming() {
  name.value = props.me.name;
  renaming.value = true;
}

async function rename() {
  const reply = await run(() => send('room:rename', { name: name.value }));
  if (!reply) return;
  if (!reply.ok) {
    refuse(reply.error);
    return;
  }
  storeName(clean.value ?? name.value.trim());
  renaming.value = false;
}

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
</script>

<template>
  <UiButton class="room-button" size="small" @click="open = true">{{ t('room.menu') }}</UiButton>

  <UiSheet :open="open" :title="t('room.menu')" @close="open = false">
    <div class="room-menu">
      <p class="who">
        <PlayerAvatar :name="me.name" :avatar="me.avatar" size="medium" />
        <span class="name">{{ me.name }}</span>
      </p>
      <UiButton v-if="!account.summary" @click="startRenaming">{{ t('room.rename') }}</UiButton>
      <UiButton @click="leaving = true">{{ t('room.leave') }}</UiButton>
      <UiButton v-if="isChair" variant="danger" @click="closing = true">{{ t('room.closeRoom') }}</UiButton>
      <SendFeedback page="room" />
    </div>
  </UiSheet>

  <UiSheet :open="renaming" :title="t('room.rename')" @close="renaming = false">
    <form class="sheet-form" @submit.prevent="rename">
      <UiField
        v-model="name"
        :label="t('room.join.name')"
        :maxlength="MAX_NAME_INPUT"
        enterkeyhint="done"
        :error="problem"
      />
      <UiButton variant="primary" type="submit" :disabled="busy || !clean">{{ t('room.renameSubmit') }}</UiButton>
    </form>
  </UiSheet>

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

/* The feedback button sits with the others, at their width. */
.room-menu > :deep(.button.quiet) {
  align-self: flex-start;
}
</style>

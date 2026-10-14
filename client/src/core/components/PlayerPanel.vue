<script setup lang="ts">
import {
  checkFriendNote,
  checkReport,
  FRIEND_NOTE_LENGTH,
  MAX_FRIEND_NOTE_INPUT,
  MAX_REPORT_INPUT,
  MAX_REPORT_LENGTH,
  textLength,
  type PlayerView,
  type RoomView,
} from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { account } from '../account';
import { errorKey } from '../errors';
import { requestFriend } from '../friends';
import { mayBefriend, mayReport } from '../manage';
import { act, send } from '../socket';
import { toast } from '../toast';
import { useBusy } from '../useBusy';
import { useFriendsList } from '../useFriendsList';
import AgentProfileCard from './AgentProfileCard.vue';
import PlayerAvatar from './PlayerAvatar.vue';
import ProfileCard from './ProfileCard.vue';
import UiButton from './UiButton.vue';
import UiField from './UiField.vue';
import UiSheet from './UiSheet.vue';

// The panel that a tap on a player's avatar opens in a room (AvatarButton.vue), one sheet over the
// room, so that the viewer stays in it: a game goes on meanwhile. Its title is the player's name.
//
// It shows who the player is: for an account, a brief profile card (ProfileCard.vue), with the rank,
// the number, the day of registration and the titles; for an AI player, its own page at once
// (AgentProfileCard.vue; docs/architecture.md#ai-players); for a guest, who has no page, the avatar
// and a word that they have none. Under it, what the viewer may do with the player:
// ask them to be friends, for an account that may (docs/architecture.md#friends), in a sheet of its
// own with a line for them, if the viewer likes, which the keyboard comes up for only on a tap,
// since most send none, or, once asked, a word that the request went, and nothing for a friend; the
// chair's
// actions, which move them to the spectators, hand them the chair, or remove them after a warning
// that says for how long, which is for good from a public room and two minutes from a private one,
// or, for an AI player, remove it at once, since it may be invited again
// (docs/architecture.md#ai-players); in a public room, the way for anyone with an account to report
// them to the operator (docs/architecture.md#public-rooms). Last, for an account, the whole page,
// which rises as a second sheet of its own height over the panel, scrolls inside, and leads back to
// it (docs/architecture.md#public-profiles); for the viewer's own account, the way to the account's
// page too. The server decides who may do what; the panel only shows what the viewer may ask for.
//
// For an account, the panel asks for the viewer's own friends list as it opens: a friend goes by
// the name the viewer gives them, if any, in the title, with the username after it in small grey
// type, as on the account page. Nothing in the room itself, where everyone goes by their username,
// shows that name.
const props = defineProps<{ playerId: string | null; room: RoomView }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const { busy, run } = useBusy();
const removing = ref(false);
const reporting = ref(false);
const reading = ref(false);
const befriending = ref(false);
const note = ref('');
const friendNote = ref('');
const refused = ref<string | undefined>();

// The player as the room has them now: a player who leaves the room takes the panel along.
const player = computed<PlayerView | null>(
  () => props.room.players.find((other) => other.id === props.playerId) ?? null,
);
watch(player, (now) => {
  if (now === null && props.playerId !== null) emit('close');
});

const isMe = computed(() => player.value?.id === props.room.me);
const isChair = computed(() => props.room.chairId === props.room.me && !isMe.value);
const isAgent = computed(() => player.value?.agent !== undefined);
const canReport = computed(() => !isMe.value && !isAgent.value && mayReport(props.room));
const befriendable = computed(() => player.value !== null && mayBefriend(props.room, player.value));
// The viewer's friends and requests, asked for while the panel is open on someone they may ask; a
// list that can't be had leaves the way to ask, which the server judges anyway.
const { view: friendsView, failed: friendsFailed } = useFriendsList(befriendable);
const friend = computed(() => friendsView.value?.friends.find(({ handle }) => handle === player.value?.handle) ?? null);
const asked = computed(
  () => friendsView.value?.outgoing.some(({ handle }) => handle === player.value?.handle) ?? false,
);
const canBefriend = computed(
  () => befriendable.value && (friendsView.value !== null || friendsFailed.value !== null) && !friend.value,
);
const title = computed(() => friend.value?.alias ?? player.value?.name ?? '');
const subtitle = computed(() => (friend.value?.alias ? (player.value?.name ?? null) : null));
const mine = computed(() => isMe.value && account.summary !== null);
const checked = computed(() => checkReport(note.value));
const noteProblem = computed(() => (checked.value.problem ? t(errorKey(checked.value.problem)) : undefined));
const count = computed(() =>
  t('feedback.count', { count: textLength(checked.value.text ?? ''), max: MAX_REPORT_LENGTH }),
);
const friendChecked = computed(() => checkFriendNote(friendNote.value));
const friendNoteProblem = computed(() =>
  friendChecked.value.problem ? t(errorKey(friendChecked.value.problem)) : undefined,
);
const friendNoteCount = computed(() =>
  t('friends.noteCount', { count: textLength(friendChecked.value.note ?? ''), max: FRIEND_NOTE_LENGTH }),
);
// Any sheet over the panel hides it.
const over = computed(() => removing.value || reporting.value || befriending.value);

// The sheets close with the panel, and a new player starts afresh.
watch(
  () => props.playerId,
  () => {
    removing.value = false;
    reporting.value = false;
    reading.value = false;
    befriending.value = false;
    note.value = '';
    friendNote.value = '';
    refused.value = undefined;
  },
);

async function manage(message: 'room:spectate' | 'room:remove' | 'room:chair') {
  const target = player.value;
  if (!target) return;
  await run(() => act(message, { playerId: target.id }));
  emit('close');
}

// A request to be friends, by the player's seat (friends.ts), with the line for them, if any,
// which the other side answers on their account page.
async function befriend() {
  const target = player.value;
  if (!target || friendChecked.value.problem) return;
  if (await run(() => requestFriend({ playerId: target.id }, friendChecked.value.note))) emit('close');
}

async function report() {
  const target = player.value;
  if (!target || checked.value.problem) return;
  refused.value = undefined;
  const reply = await run(() =>
    send('room:report', { playerId: target.id, ...(checked.value.text === null ? {} : { text: checked.value.text }) }),
  );
  if (!reply) return;
  if (!reply.ok) {
    refused.value = t(errorKey(reply.error));
    return;
  }
  toast('lobby.manage.reportSent');
  emit('close');
}
</script>

<template>
  <UiSheet :open="player !== null && !over" :title="title" :subtitle="subtitle" @close="emit('close')">
    <div v-if="player" class="panel-body">
      <ProfileCard v-if="player.handle" :handle="player.handle" brief :named="false" />
      <AgentProfileCard v-else-if="player.agent" :persona="player.agent" />
      <div v-else class="nobody">
        <PlayerAvatar :name="player.name" :avatar="player.avatar" size="large" />
        <div class="what">
          <span class="tag">{{ t('room.panel.guest') }}</span>
          <span class="hint">{{ t('room.panel.guestNote') }}</span>
        </div>
      </div>

      <div class="actions">
        <UiButton v-if="canBefriend && asked" disabled>{{ t('friends.requestPending') }}</UiButton>
        <UiButton v-else-if="canBefriend" :disabled="busy" @click="befriending = true">{{
          t('friends.addFromRoom')
        }}</UiButton>
        <UiButton v-if="isChair && isAgent" variant="danger" :disabled="busy" @click="manage('room:remove')">
          {{ t('lobby.manage.remove') }}
        </UiButton>
        <template v-else-if="isChair">
          <UiButton :disabled="busy" @click="manage('room:spectate')">{{ t('lobby.manage.spectate') }}</UiButton>
          <UiButton :disabled="busy" @click="manage('room:chair')">{{ t('lobby.manage.chair') }}</UiButton>
          <UiButton variant="danger" :disabled="busy" @click="removing = true">{{ t('lobby.manage.remove') }}</UiButton>
        </template>
        <UiButton v-if="canReport" variant="quiet" @click="reporting = true">{{ t('lobby.manage.report') }}</UiButton>
        <RouterLink v-if="mine" v-slot="{ href, navigate }" to="/account" custom>
          <UiButton :href="href" @click="navigate">{{ t('room.panel.myAccount') }}</UiButton>
        </RouterLink>
        <UiButton v-if="player.handle" @click="reading = true">{{ t('room.panel.fullPage') }}</UiButton>
      </div>
    </div>
  </UiSheet>

  <UiSheet
    :open="player !== null && reading && !over"
    :title="player?.name ?? ''"
    tall
    :back="t('room.panel.back')"
    @back="reading = false"
    @close="emit('close')"
  >
    <ProfileCard v-if="player?.handle" :handle="player.handle" :named="false" />
  </UiSheet>

  <UiSheet
    :open="player !== null && befriending"
    :title="t('friends.addTitle', { name: player?.name ?? '' })"
    :focus-input="false"
    @close="befriending = false"
  >
    <form class="actions" @submit.prevent="befriend">
      <UiField
        v-model="friendNote"
        :label="t('friends.noteLabel')"
        :maxlength="MAX_FRIEND_NOTE_INPUT"
        autocomplete="off"
        enterkeyhint="send"
        :hint="friendNoteCount"
        :error="friendNoteProblem"
      />
      <UiButton variant="primary" type="submit" :disabled="busy || friendChecked.problem !== null">
        {{ t('friends.addSubmit') }}
      </UiButton>
      <UiButton variant="quiet" @click="befriending = false">{{ t('lobby.manage.cancel') }}</UiButton>
    </form>
  </UiSheet>

  <UiSheet :open="player !== null && removing" :title="t('lobby.manage.remove')" @close="removing = false">
    <div class="actions">
      <p>
        {{
          t(room.public ? 'lobby.manage.removeConfirm' : 'lobby.manage.removeConfirmPrivate', {
            name: player?.name ?? '',
          })
        }}
      </p>
      <UiButton variant="danger" :disabled="busy" @click="manage('room:remove')">{{
        t('lobby.manage.remove')
      }}</UiButton>
      <UiButton variant="quiet" @click="removing = false">{{ t('lobby.manage.cancel') }}</UiButton>
    </div>
  </UiSheet>

  <UiSheet
    :open="player !== null && reporting"
    :title="t('lobby.manage.reportTitle', { name: player?.name ?? '' })"
    @close="reporting = false"
  >
    <form class="actions" @submit.prevent="report">
      <p class="hint">{{ t('lobby.manage.reportIntro') }}</p>
      <UiField
        v-model="note"
        :label="t('lobby.manage.reportNote')"
        :maxlength="MAX_REPORT_INPUT"
        :hint="count"
        :error="noteProblem"
        multiline
        :rows="3"
      />
      <p v-if="refused" class="problem" role="alert">{{ refused }}</p>
      <UiButton variant="primary" type="submit" :disabled="busy || checked.problem !== null">
        {{ t('lobby.manage.reportSubmit') }}
      </UiButton>
      <UiButton variant="quiet" @click="reporting = false">{{ t('lobby.manage.cancel') }}</UiButton>
    </form>
  </UiSheet>
</template>

<style scoped>
.panel-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* A guest or an AI player: the avatar, and a word of what they are. */
.nobody {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.what {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
  min-width: 0;
}

.tag {
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--paper-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.problem {
  color: var(--red-deep);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}
</style>

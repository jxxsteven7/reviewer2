<script setup lang="ts">
import {
  checkReport,
  MAX_REPORT_INPUT,
  MAX_REPORT_LENGTH,
  textLength,
  type PlayerView,
  type RoomView,
} from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { errorKey } from '../errors';
import { requestFriend } from '../friends';
import { mayBefriend, mayReport, mayView } from '../manage';
import { act, send } from '../socket';
import { toast } from '../toast';
import { useBusy } from '../useBusy';
import ProfileCard from './ProfileCard.vue';
import UiButton from './UiButton.vue';
import UiField from './UiField.vue';
import UiSheet from './UiSheet.vue';

// The menu for one player: the chair's actions, which move them to the spectators, remove them,
// after a warning that says for how long, which is for good from a public room and two minutes
// from a private one, or hand them the chair; for an account, the way to ask a player with an
// account to be friends (docs/architecture.md#friends); and, in a public room, the way for anyone
// with an account to report them to the operator (docs/architecture.md#public-rooms); and, for a
// player with an account, their public page (docs/architecture.md#public-profiles), in a sheet, so
// that the viewer stays in the room. The chair has one action on an AI player: to remove it, at once,
// since it may be invited again (docs/architecture.md#ai-players). The server decides who may do
// what; the menu only shows what the viewer may ask for.
const props = defineProps<{ player: PlayerView | null; room: RoomView }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const { busy, run } = useBusy();
const removing = ref(false);
const reporting = ref(false);
const viewing = ref(false);
const note = ref('');
const refused = ref<string | undefined>();

const isChair = computed(() => props.room.chairId === props.room.me);
const canReport = computed(() => mayReport(props.room));
const canBefriend = computed(() => props.player !== null && mayBefriend(props.room, props.player));
const canView = computed(() => props.player !== null && mayView(props.room, props.player));
const checked = computed(() => checkReport(note.value));
const noteProblem = computed(() => (checked.value.problem ? t(errorKey(checked.value.problem)) : undefined));
const count = computed(() =>
  t('feedback.count', { count: textLength(checked.value.text ?? ''), max: MAX_REPORT_LENGTH }),
);

// The sheets close with the menu, and a new player starts afresh.
watch(
  () => props.player,
  () => {
    removing.value = false;
    reporting.value = false;
    viewing.value = false;
    note.value = '';
    refused.value = undefined;
  },
);

async function manage(message: 'room:spectate' | 'room:remove' | 'room:chair') {
  const player = props.player;
  if (!player) return;
  await run(() => act(message, { playerId: player.id }));
  emit('close');
}

// A request to be friends, by the player's seat (friends.ts), which the other side answers on
// their account page.
async function befriend() {
  const player = props.player;
  if (!player) return;
  if (await run(() => requestFriend({ playerId: player.id }))) emit('close');
}

async function report() {
  const player = props.player;
  if (!player || checked.value.problem) return;
  refused.value = undefined;
  const reply = await run(() =>
    send('room:report', { playerId: player.id, ...(checked.value.text === null ? {} : { text: checked.value.text }) }),
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
  <UiSheet
    :open="player !== null && !removing && !reporting && !viewing"
    :title="player?.name ?? ''"
    @close="emit('close')"
  >
    <div class="actions">
      <UiButton v-if="canView" @click="viewing = true">{{ t('lobby.manage.viewPage') }}</UiButton>
      <UiButton v-if="isChair && player?.agent" variant="danger" :disabled="busy" @click="manage('room:remove')">
        {{ t('lobby.manage.remove') }}
      </UiButton>
      <template v-else-if="isChair">
        <UiButton :disabled="busy" @click="manage('room:spectate')">{{ t('lobby.manage.spectate') }}</UiButton>
        <UiButton :disabled="busy" @click="manage('room:chair')">{{ t('lobby.manage.chair') }}</UiButton>
        <UiButton variant="danger" :disabled="busy" @click="removing = true">{{ t('lobby.manage.remove') }}</UiButton>
      </template>
      <UiButton v-if="canBefriend" :disabled="busy" @click="befriend">{{ t('friends.addFromRoom') }}</UiButton>
      <UiButton v-if="canReport" variant="quiet" @click="reporting = true">{{ t('lobby.manage.report') }}</UiButton>
      <UiButton variant="quiet" @click="emit('close')">{{ t('lobby.manage.cancel') }}</UiButton>
    </div>
  </UiSheet>

  <UiSheet :open="player !== null && viewing" :title="player?.name ?? ''" @close="viewing = false">
    <ProfileCard v-if="player?.handle" :handle="player.handle" />
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
.actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
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

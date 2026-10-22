<script setup lang="ts">
import type { PlayerView, RoomView } from '@reviewer2/shared';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  sameSettings,
  type ImpostorSettings,
  type ImpostorStartProblem,
} from '@reviewer2/shared/impostor';
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import EmoteButton from '../../core/components/EmoteButton.vue';
import FieldFold from '../../core/components/FieldFold.vue';
import InviteFriends from '../../core/components/InviteFriends.vue';
import InvitedFriends from '../../core/components/InvitedFriends.vue';
import LobbyHead from '../../core/components/LobbyHead.vue';
import MatchResults from '../../core/components/MatchResults.vue';
import MatchTable from '../../core/components/MatchTable.vue';
import PlayerName from '../../core/components/PlayerName.vue';
import StartDock from '../../core/components/StartDock.vue';
import UiButton from '../../core/components/UiButton.vue';
import { account } from '../../core/account';
import { fields, loadFields } from '../../core/fields';
import { act } from '../../core/socket';
import { toastError } from '../../core/toast';
import { ROOM_ACTIONS } from '../../core/useRoomPage';
import InviteAgent from '../keywords/InviteAgent.vue';
import SetterForm from './SetterForm.vue';
import SettingsForm from './SettingsForm.vue';
import SettingsSummary from './SettingsSummary.vue';
import SourceChoice from './SourceChoice.vue';
import { useImpostor } from './useImpostor';

// The waiting room of the hidden word game, laid out as the first game's (KeywordsLobby.vue), with
// the same head, start bar, spectators, desk and summary, but one panel of players instead of two
// groups: up to 12 who came to play, in the order they came, by their own names and avatars, which
// turn into numbers only as the game starts (docs/games/impostor.md#numbers), and how many seats
// are left. Whoever is in the room plays or watches with one button. The chair's invitation of
// Reviewer 1 is the chip under the players, once a person plays. While the room has a setter, the
// setter, who is the chair, sets the two words in a panel of their own and watches; the others see
// who sets them, and whether they have. The chair's desk chooses where the words come from, the
// word lists while the game draws from them, and the settings, which are saved as the first game's
// are, or as the game starts.
//
// In a match, as in the first game's waiting room, the match's table comes first, or its final
// ranking once it is over, which takes the place of the start bar, the desk, the setter's form and
// the line that the room waits for the chair, since no game can start until the chair has chosen
// what comes next; once a game of the match has counted, the settings stay as they are,
// and the chair sees the rules under their desk. A match has no AI players, which the footnote
// on numbers leaves out then.
const props = defineProps<{ room: RoomView }>();
const { t } = useI18n();
const room = toRef(props, 'room');
const { data, isChair, setterId, isSetter, seated, spectators, isSeated, sit } = useImpostor(room);
const match = computed(() => props.room.match);
const finished = computed(() => match.value !== null && match.value.status !== 'on');
const locked = computed(() => match.value?.status === 'on' && match.value.played > 0);

const setter = computed(() => props.room.players.find((player) => player.id === setterId.value) ?? null);
const left = computed(() => Math.max(MAX_PLAYERS - seated.value.length, 0));

const problemText = (item: ImpostorStartProblem) =>
  t(`games.impostor.problems.${item.problem}`, { count: item.count ?? 0 }, item.count ?? 0);

// An account may invite its friends into the room, online or not, from the start bar
// (docs/architecture.md#friends).
const mayInviteFriends = computed(() => account.summary !== null);
const invitingFriends = ref(false);
// The chair invites AI players where the room may have them (docs/games/impostor.md#ai-players),
// once a person plays, to any seat left.
const personSeated = computed(() => seated.value.some((player) => player.agent === undefined));
const canInvite = computed(() => isChair.value && props.room.agents && personSeated.value && left.value > 0);
const hasAgents = computed(() => props.room.players.some((player) => player.agent));
const agentName = computed(() => t('agents.personas.reviewer1'));
// While the AI players are offline, the invitation is held back, and a tap says so.
const invite = () =>
  props.room.agentsOnline ? act('room:addAgent', { persona: 'reviewer1', seat: null }) : toastError('agents_offline');

// The chair's settings and word lists, kept until they are saved, as in the first game's desk: each
// snapshot brings the room's anew, so they are compared by their contents.
const roomSettings = computed(() => data.value.settings);
const chosenSettings = ref<ImpostorSettings>({ ...roomSettings.value });
const settingsValid = ref(true);
const settingsChanged = computed(() => !sameSettings(chosenSettings.value, roomSettings.value));
watch(roomSettings, (settings, before) => {
  if (!sameSettings(settings, before)) chosenSettings.value = { ...settings };
});

const roomFields = computed(() => [...(props.room.fields ?? [])].sort().join());
const chosenFields = ref<string[]>([...(props.room.fields ?? [])]);
const chosenRandom = ref(props.room.randomFields ?? false);
watch(roomFields, () => (chosenFields.value = [...(props.room.fields ?? [])]));
watch(
  () => props.room.randomFields ?? false,
  (random) => (chosenRandom.value = random),
);
const drawsWords = computed(() => !chosenSettings.value.setter);
const fieldsChanged = computed(
  () =>
    drawsWords.value &&
    ([...chosenFields.value].sort().join() !== roomFields.value ||
      chosenRandom.value !== (props.room.randomFields ?? false)),
);

const unsaved = computed(() => !locked.value && (settingsChanged.value || fieldsChanged.value));
const savable = computed(
  () => settingsValid.value && (!drawsWords.value || chosenFields.value.length > 0 || chosenRandom.value),
);
const save = () =>
  act('room:settings', {
    fields: chosenFields.value,
    randomFields: chosenRandom.value,
    settings: chosenSettings.value,
  });

const starting = ref(false);
async function start() {
  starting.value = true;
  try {
    if (unsaved.value && !(await save()).ok) return;
    await act('room:start', { round: props.room.round });
  } finally {
    starting.value = false;
  }
}

watch(isChair, (chair) => chair && loadFields(), { immediate: true });

const problems = computed(() => data.value.startProblems);
const unsavable = computed(() => unsaved.value && !savable.value);
const ready = computed(() => problems.value.length === 0 && !unsavable.value);
const readiness = computed(() => {
  const first = problems.value[0];
  if (first) return problemText(first);
  return t(unsavable.value ? 'lobby.unsavable' : 'lobby.ready');
});
const isMe = (player: PlayerView) => player.id === props.room.me;
const isChairOf = (player: PlayerView) => player.id === props.room.chairId;
</script>

<template>
  <section class="lobby">
    <Teleport defer :to="`#${ROOM_ACTIONS}`">
      <EmoteButton />
    </Teleport>
    <LobbyHead :room="room" :is-chair="isChair" />

    <StartDock
      v-if="(isChair || mayInviteFriends) && !finished"
      :readiness="readiness"
      :ready="ready"
      :member="!isChair"
    >
      <template #line>
        <InvitedFriends v-if="mayInviteFriends" :room="room" @open="invitingFriends = true" />
      </template>
      <UiButton v-if="mayInviteFriends" class="invite-friends" size="small" @click="invitingFriends = true">
        {{ t('friends.invite') }}
      </UiButton>
      <UiButton v-if="isChair" variant="primary" size="small" :disabled="!ready || starting" @click="start">
        {{ t('lobby.start') }}
      </UiButton>
    </StartDock>
    <InviteFriends :open="invitingFriends" :room="room" @close="invitingFriends = false" />

    <MatchResults v-if="finished" :room="room" />

    <div class="sections">
      <div class="column">
        <MatchTable v-if="match && !finished" :room="room" />
        <SetterForm v-if="isSetter && !finished" :words="data.setterWords" :language="room.language" />

        <section class="players panel">
          <h2 class="section-title">
            {{ t('games.impostor.lobby.players') }}
            <small class="count num">{{
              t('games.impostor.lobby.count', { count: seated.length, max: MAX_PLAYERS, min: MIN_PLAYERS })
            }}</small>
          </h2>
          <ul v-if="seated.length" class="names">
            <li v-for="player in seated" :key="player.id">
              <PlayerName :player="player" :me="isMe(player)" :chair="isChairOf(player)" stacked />
            </li>
          </ul>
          <p class="vacant">
            {{ left > 0 ? t('games.impostor.lobby.left', { count: left }, left) : t('games.impostor.lobby.full') }}
          </p>
          <InviteAgent v-if="canInvite" :name="agentName" :held="!room.agentsOnline" @click="invite" />
          <UiButton v-if="!isSetter && !isSeated && left > 0" size="small" @click="sit(true)">
            {{ t('games.impostor.lobby.play') }}
          </UiButton>
        </section>

        <section v-if="setter && !isSetter" class="setter-line panel">
          <h2 class="section-title">{{ t('games.impostor.lobby.setter') }}</h2>
          <PlayerName :player="setter" :me="false" :chair="true" stacked />
          <p class="hint">{{ t('games.impostor.lobby.setterNote') }}</p>
        </section>

        <section class="spectators panel">
          <h2 class="section-title">{{ t('lobby.roles.spectator') }}</h2>
          <ul v-if="spectators.length" class="names inline">
            <li v-for="player in spectators" :key="player.id">
              <PlayerName :player="player" :me="isMe(player)" :chair="isChairOf(player)" stacked />
            </li>
          </ul>
          <p v-else class="vacant">{{ t('lobby.nobody') }}</p>
          <UiButton v-if="isSeated && !isSetter" size="small" @click="sit(false)">{{ t('lobby.watch') }}</UiButton>
          <p v-if="room.screens > 0" class="screens">
            {{ t('lobby.screens', { count: room.screens }) }}
            <UiButton v-if="isChair" size="small" variant="quiet" @click="act('room:dismiss')">
              {{ t('lobby.dismissScreens') }}
            </UiButton>
          </p>
        </section>

        <p v-if="data.settings.anonymous" class="footnote">
          {{ t(match ? 'games.impostor.lobby.numbersNoteMatch' : 'games.impostor.lobby.numbersNote') }}
        </p>
        <template v-if="room.agents || hasAgents">
          <p class="footnote">{{ t('lobby.agentLevel') }}</p>
          <p class="footnote">{{ t('lobby.agentNote') }}</p>
        </template>
      </div>
      <div class="column">
        <section v-if="isChair && !finished" class="desk panel">
          <h2 class="section-title">{{ t('lobby.desk') }}</h2>
          <p v-if="locked" class="hint">{{ t('match.locked') }}</p>
          <template v-else>
            <SourceChoice v-model="chosenSettings" />
            <FieldFold
              v-if="drawsWords"
              v-model="chosenFields"
              v-model:random="chosenRandom"
              :fields="fields"
              :language="room.language"
              game="impostor"
              each-game
            />
            <h3 class="label">{{ t('settings.title') }}</h3>
            <SettingsForm v-model="chosenSettings" v-model:valid="settingsValid" :language="room.language" />
          </template>
          <div v-if="unsaved" class="save">
            <UiButton size="small" :disabled="!savable" @click="save">{{ t('lobby.save') }}</UiButton>
            <p class="hint">{{ t('lobby.saveHint') }}</p>
          </div>
          <ul v-if="problems.length" class="problems">
            <li v-for="item in problems" :key="item.problem">{{ problemText(item) }}</li>
          </ul>
        </section>
        <section v-if="!isChair || locked" class="rules panel">
          <h2 class="section-title">{{ t('settings.title') }}</h2>
          <SettingsSummary :settings="data.settings" :language="room.language" />
        </section>
        <section v-if="!isChair && !finished" class="waiting panel">
          <ul class="problems">
            <li v-for="item in problems" :key="item.problem">{{ problemText(item) }}</li>
          </ul>
          <p>{{ t('lobby.waiting') }}</p>
        </section>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sections {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
}

.panel {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.section-title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 var(--space-2);
}

.count {
  color: var(--ink-2);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

/* The lists of names are as wide as their panel, so that a long name is cut short rather than
   widening it; in the spectators' row, a name takes at most the row. */
.names {
  display: flex;
  flex-direction: column;
  align-self: stretch;
  margin: 0;
  padding: 0;
  list-style: none;
}

.names.inline {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 0 var(--space-4);
}

.names.inline li {
  min-width: 0;
  max-width: 100%;
}

.vacant {
  color: var(--ink-2);
  font-weight: var(--weight-bold);
}

.screens {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 var(--space-3);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.footnote,
.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.desk {
  align-items: stretch;
}

.label {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
}

.save {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.problems {
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--red-deep);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.waiting p {
  font-weight: var(--weight-bold);
}

.column {
  display: contents;
}

/* Two columns from a computer's width, as in the first game's waiting room: the players and the
   spectators on the left, the desk or the settings on the right. */
@media (min-width: 64rem) {
  .sections {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0 var(--space-5);
    align-items: start;
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
}
</style>

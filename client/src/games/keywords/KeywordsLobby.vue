<script setup lang="ts">
import { BOARD_SIZE, sameSettings, type KeywordsSettings, type PlayerView, type RoomView } from '@reviewer2/shared';
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import FieldPicker from '../../core/components/FieldPicker.vue';
import PlayerMenu from '../../core/components/PlayerMenu.vue';
import PlayerName from '../../core/components/PlayerName.vue';
import ShareTools from '../../core/components/ShareTools.vue';
import UiButton from '../../core/components/UiButton.vue';
import { fields, loadFields } from '../../core/fields';
import { act } from '../../core/socket';
import SettingsForm from './SettingsForm.vue';
import SettingsSummary from './SettingsSummary.vue';
import { useKeywords } from './useKeywords';

// The waiting room: the two groups with their PI and students, the spectators and the screens,
// the room's settings, and the chair's desk with the word lists, the settings, the shuffle and
// the start button.
const props = defineProps<{ room: RoomView }>();
const { t } = useI18n();
const room = toRef(props, 'room');
const { data, mySeat, isChair, groups, spectators, sit } = useKeywords(room);

const managing = ref<PlayerView | null>(null);

// The chair's choice of word lists, which is only sent when they save it. Every snapshot brings
// the room's lists as a new array, so they are compared by their contents: an unsaved choice
// survives the snapshots that others cause by taking seats or coming and going.
const roomFields = computed(() => [...props.room.fields].sort().join());
const chosenFields = ref<string[]>([...props.room.fields]);
const fieldsChanged = computed(() => [...chosenFields.value].sort().join() !== roomFields.value);

watch(roomFields, () => (chosenFields.value = [...props.room.fields]));

// The chair's settings, kept the same way until they are saved with the word lists.
const roomSettings = computed(() => data.value.settings);
const chosenSettings = ref<KeywordsSettings>({ ...roomSettings.value });
const settingsValid = ref(true);
const settingsChanged = computed(() => !sameSettings(chosenSettings.value, roomSettings.value));

watch(roomSettings, (settings, before) => {
  if (!sameSettings(settings, before)) chosenSettings.value = { ...settings };
});

const unsaved = computed(() => fieldsChanged.value || settingsChanged.value);
const savable = computed(() => chosenFields.value.length > 0 && settingsValid.value);
const save = () => act('room:settings', { fields: chosenFields.value, settings: chosenSettings.value });

// The game starts with the word lists and the settings that the chair sees at the desk, so what
// they have changed there is saved first. A change that the server refuses stops the start.
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

// Only the chair's desk shows the word lists, so only the chair asks for them.
watch(isChair, (chair) => chair && loadFields(), { immediate: true });

const problems = computed(() => data.value.startProblems);
const isMe = (player: PlayerView) => player.id === props.room.me;
const isChairOf = (player: PlayerView) => player.id === props.room.chairId;
const manageable = (player: PlayerView) => isChair.value && !isMe(player);
</script>

<template>
  <section class="lobby">
    <header class="lobby-head">
      <p class="kicker">{{ t('home.games.keywords.name') }} &middot; {{ t('lobby.kicker') }}</p>
      <ShareTools :code="room.code" />
    </header>

    <div class="sections">
      <div class="groups">
        <section v-for="group in groups" :key="group.team" class="group" :class="group.team">
          <h2 class="section-title">{{ t(`lobby.group.${group.team}`) }}</h2>
          <dl>
            <dt>{{ t('lobby.roles.captain') }}</dt>
            <dd class="seat-line">
              <PlayerName
                v-if="group.captain"
                :player="group.captain"
                :me="isMe(group.captain)"
                :chair="isChairOf(group.captain)"
                :manageable="manageable(group.captain)"
                @manage="managing = $event"
              />
              <span v-else class="vacant">{{ t('lobby.vacant') }}</span>
              <UiButton v-if="!group.captain" size="small" @click="sit(group.team, 'captain')">
                {{ t('lobby.takeCaptain') }}
              </UiButton>
            </dd>
            <dt>{{ t('lobby.roles.guesser') }}</dt>
            <dd>
              <ul v-if="group.guessers.length" class="names">
                <li v-for="player in group.guessers" :key="player.id">
                  <PlayerName
                    :player="player"
                    :me="isMe(player)"
                    :chair="isChairOf(player)"
                    :manageable="manageable(player)"
                    @manage="managing = $event"
                  />
                </li>
              </ul>
              <p v-else class="vacant">{{ t('lobby.nobody') }}</p>
              <UiButton
                v-if="!(mySeat?.team === group.team && mySeat.role === 'guesser')"
                size="small"
                @click="sit(group.team, 'guesser')"
              >
                {{ t('lobby.joinAsGuesser') }}
              </UiButton>
            </dd>
          </dl>
        </section>
      </div>

      <section class="spectators">
        <h2 class="section-title">{{ t('lobby.roles.spectator') }}</h2>
        <ul v-if="spectators.length" class="names inline">
          <li v-for="player in spectators" :key="player.id">
            <PlayerName
              :player="player"
              :me="isMe(player)"
              :chair="isChairOf(player)"
              :manageable="manageable(player)"
              @manage="managing = $event"
            />
          </li>
        </ul>
        <p v-else class="vacant">{{ t('lobby.nobody') }}</p>
        <UiButton v-if="mySeat?.role !== 'spectator'" size="small" @click="sit(null, 'spectator')">
          {{ t('lobby.watch') }}
        </UiButton>
        <p v-if="room.screens > 0" class="screens">
          {{ t('lobby.screens', { count: room.screens }) }}
          <UiButton v-if="isChair" size="small" variant="quiet" @click="act('room:dismiss')">
            {{ t('lobby.dismissScreens') }}
          </UiButton>
        </p>
      </section>

      <p class="footnote">{{ t('lobby.captainNote') }}</p>

      <section v-if="!isChair" class="rules">
        <h2 class="section-title">{{ t('settings.title') }}</h2>
        <SettingsSummary :settings="data.settings" :language="room.language" />
      </section>

      <section v-if="isChair" class="desk">
        <h2 class="section-title">{{ t('lobby.desk') }}</h2>
        <h3 class="label">{{ t('lobby.fields') }}</h3>
        <p v-if="!fields" class="hint">{{ t('create.loadingFields') }}</p>
        <FieldPicker v-else v-model="chosenFields" :fields="fields" :language="room.language" :needed="BOARD_SIZE" />
        <h3 class="label">{{ t('settings.title') }}</h3>
        <SettingsForm v-model="chosenSettings" v-model:valid="settingsValid" :language="room.language" />
        <div v-if="unsaved" class="save">
          <UiButton size="small" :disabled="!savable" @click="save">{{ t('lobby.save') }}</UiButton>
          <p class="hint">{{ t('lobby.saveHint') }}</p>
        </div>
        <ul class="problems">
          <li v-for="item in problems" :key="`${item.problem}-${item.team}`">
            {{ t(`lobby.problems.${item.problem}`, { group: t(`lobby.group.${item.team}`) }) }}
          </li>
          <li v-if="!problems.length" class="ready">{{ t('lobby.ready') }}</li>
        </ul>
        <div class="desk-actions">
          <UiButton @click="act('room:shuffle')">{{ t('lobby.shuffle') }}</UiButton>
          <UiButton
            variant="primary"
            :disabled="problems.length > 0 || starting || (unsaved && !savable)"
            @click="start"
          >
            {{ t('lobby.start') }}
          </UiButton>
        </div>
      </section>
      <section v-else class="waiting">
        <ul class="problems">
          <li v-for="item in problems" :key="`${item.problem}-${item.team}`">
            {{ t(`lobby.problems.${item.problem}`, { group: t(`lobby.group.${item.team}`) }) }}
          </li>
        </ul>
        <p>{{ t('lobby.waiting') }}</p>
      </section>
    </div>

    <PlayerMenu :player="managing" @close="managing = null" />
  </section>
</template>

<style scoped>
.lobby-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5) 0 var(--space-4);
}

.groups {
  display: grid;
  gap: 0 var(--space-6);
}

.group,
.spectators,
.rules,
.desk,
.waiting {
  padding: var(--space-4) 0;
  border-top: 1px solid var(--rule);
}

.group {
  padding-left: var(--space-3);
  border-left: 3px solid var(--rule);
}

.group.red {
  border-left-color: var(--red);
}

.group.blue {
  border-left-color: var(--blue);
}

dl {
  display: grid;
  grid-template-columns: 5.5rem 1fr;
  gap: var(--space-3) var(--space-3);
  margin: var(--space-3) 0 0;
}

/* Lined up with the middle of the 44 px row that a name or a button makes. */
dt {
  padding-top: 11px;
  color: var(--ink-3);
  font-size: var(--text-sm);
  font-variant-caps: all-small-caps;
  letter-spacing: 0.06em;
}

dd {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  min-width: 0;
}

.seat-line {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
}

.names {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.names.inline {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 0 var(--space-4);
  margin: var(--space-2) 0;
}

.vacant {
  color: var(--ink-3);
}

dd .vacant {
  display: flex;
  align-items: center;
  min-height: 44px;
}

.spectators .vacant {
  margin: var(--space-3) 0 var(--space-2);
}

.screens {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 var(--space-3);
  margin: var(--space-3) 0 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.footnote {
  padding: var(--space-3) 0;
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.label {
  margin-top: var(--space-3);
  color: var(--ink-2);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: 500;
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.rules .section-title {
  margin-bottom: var(--space-3);
}

.desk .label + .settings-form {
  margin-top: var(--space-2);
}

.save {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  margin-top: var(--space-3);
}

.problems {
  margin: var(--space-3) 0;
  padding: 0;
  list-style: none;
  color: var(--red);
  font-size: var(--text-sm);
}

.problems .ready {
  color: var(--ink-2);
}

.desk-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.waiting p {
  color: var(--ink-2);
}

@media (min-width: 48rem) {
  .groups {
    grid-template-columns: 1fr 1fr;
  }
}

/* Chinese has no true italics, and slanted characters look broken. */
.vacant:lang(en) {
  font-style: italic;
}
</style>

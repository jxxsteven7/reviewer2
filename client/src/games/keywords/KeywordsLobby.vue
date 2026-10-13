<script setup lang="ts">
import {
  BOARD_SIZE,
  MAX_CUSTOM_INPUT,
  otherTeam,
  parseCustomWords,
  SPECTATOR,
  sameSettings,
  type KeywordsSettings,
  type PlayerView,
  type RoomView,
  type StartProblem,
  type Team,
} from '@reviewer2/shared';
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import FieldPicker from '../../core/components/FieldPicker.vue';
import MatchResults from '../../core/components/MatchResults.vue';
import MatchTable from '../../core/components/MatchTable.vue';
import PlayerMenu from '../../core/components/PlayerMenu.vue';
import PlayerName from '../../core/components/PlayerName.vue';
import ShareTools from '../../core/components/ShareTools.vue';
import EmoteButton from '../../core/components/EmoteButton.vue';
import UiButton from '../../core/components/UiButton.vue';
import { fields, loadFields } from '../../core/fields';
import { errorKey } from '../../core/errors';
import { formatList } from '../../core/i18n';
import { mayManage } from '../../core/manage';
import { act } from '../../core/socket';
import RoleBanner from './RoleBanner.vue';
import SettingsForm from './SettingsForm.vue';
import SettingsSummary from './SettingsSummary.vue';
import { useKeywords } from './useKeywords';

// The waiting room: the banner that says where the viewer sits, the two groups with their PI and
// students, the spectators and the screens, the room's settings, and the chair's desk with the
// word lists, the chair's own words, the settings, the shuffle and the start button.
//
// In a match, the match's table comes first, or its final ranking once it is over, and while the
// match has locked the settings the chair sees the rules under their desk. When the server
// draws the groups as the game starts, the players are one list rather than two groups; when the
// groups are fixed, everyone is offered the seats of their own group only. The word lists and the
// settings stay as they are once a game of the match has counted.
const props = defineProps<{ room: RoomView }>();
const { t, locale } = useI18n();
const room = toRef(props, 'room');
const { data, mySeat, mySide, isChair, groups, spectators, sit } = useKeywords(room);

const match = computed(() => props.room.match);
const finished = computed(() => match.value !== null && match.value.status !== 'on');
const locked = computed(() => match.value?.status === 'on' && match.value.played > 0);
const lineup = computed(() => data.value.lineup);
// Everyone who plays, when the groups are drawn as the game starts.
const pool = computed(() =>
  groups.value.flatMap((group) => [...(group.captain ? [group.captain] : []), ...group.guessers]),
);
// A player who joins the pool sits in the smaller group, which only matters until the draw.
const joinPool = () => sit(seatedIn('red') <= seatedIn('blue') ? 'red' : 'blue', 'guesser');
// How many others sit in a group. With fixed groups, a player is offered the seats of their own
// group alone, and a newcomer, who has none yet, those of the group with fewer players, or of
// either when both have as many; the server holds to the same rule.
const seatedIn = (team: Team) =>
  Object.entries(data.value.seats).filter(([id, seat]) => id !== room.value.me && seat.team === team).length;
function mayTake(team: Team): boolean {
  if (lineup.value !== 'fixed') return true;
  if (mySide.value !== null) return mySide.value === team;
  return seatedIn(team) <= seatedIn(otherTeam(team));
}
const problemText = (item: StartProblem) =>
  item.problem === 'needs_players'
    ? t('lobby.problems.needs_players', { missing: item.missing })
    : t(`lobby.problems.${item.problem}`, { group: t(`lobby.group.${item.team}`) });
const problemKey = (item: StartProblem) => `${item.problem}-${'team' in item ? item.team : item.missing}`;

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

// The chair's own words, as the text they are typed as, kept the same way (docs/games/
// keywords.md#custom-words). The server sends the chair the words it has, one per line.
const roomWords = computed(() => (props.room.customWords ?? []).join('\n'));
const wordsText = ref(roomWords.value);
watch(roomWords, (text) => (wordsText.value = text));
// A public room takes no words of the chair's own (custom_words_private), and the editor goes
// when the room is listed: so does whatever was typed in it and not saved.
watch(
  () => props.room.public,
  (listed) => {
    if (listed) wordsText.value = roomWords.value;
  },
);
const words = computed(() => parseCustomWords(wordsText.value));
const wordsChanged = computed(() => words.value.words.join('\n') !== roomWords.value);
const wordsValid = computed(() => words.value.tooLong.length === 0 && !words.value.tooMany);
const tooLong = computed(() => formatList(locale.value, words.value.tooLong));

const unsaved = computed(() => !locked.value && (fieldsChanged.value || settingsChanged.value || wordsChanged.value));
// With enough words of the chair's own, the room needs no word list at all.
const savable = computed(
  () =>
    (chosenFields.value.length > 0 || words.value.words.length >= BOARD_SIZE) &&
    settingsValid.value &&
    wordsValid.value,
);
// The words go along only when they changed, so that the server doesn't read them again for a
// setting.
const save = () =>
  act('room:settings', {
    fields: chosenFields.value,
    settings: chosenSettings.value,
    ...(wordsChanged.value ? { words: wordsText.value } : {}),
  });

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
const manageable = (player: PlayerView) => mayManage(props.room, player);
</script>

<template>
  <section class="lobby">
    <RoleBanner :seat="mySeat ?? SPECTATOR" :game="null" :chair="isChair">
      <EmoteButton />
    </RoleBanner>
    <header class="lobby-head">
      <p class="kicker">
        {{ t('home.games.keywords.name') }} &middot; {{ t('lobby.kicker') }}
        <span v-if="room.public" class="public">{{ t('room.public') }}</span>
      </p>
      <ShareTools :code="room.code" />
    </header>

    <MatchResults v-if="finished" :room="room" />

    <div class="sections">
      <div class="column">
        <MatchTable v-if="match && !finished" :room="room" />

        <section v-if="lineup === 'draw'" class="pool">
          <h2 class="section-title">{{ t('match.drawn') }}</h2>
          <ul v-if="pool.length" class="names inline">
            <li v-for="player in pool" :key="player.id">
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
          <UiButton v-if="mySeat?.role === 'spectator'" size="small" @click="joinPool">{{ t('match.play') }}</UiButton>
          <p class="hint">{{ t('match.drawnNote') }}</p>
        </section>

        <div v-else class="groups">
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
                <UiButton v-if="!group.captain && mayTake(group.team)" size="small" @click="sit(group.team, 'captain')">
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
                  v-if="!(mySeat?.team === group.team && mySeat.role === 'guesser') && mayTake(group.team)"
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

        <p class="footnote">
          {{ lineup === 'fixed' ? t('match.fixedNote') : t('lobby.captainNote') }}
        </p>
      </div>
      <div class="column">
        <section v-if="isChair && !finished" class="desk">
          <h2 class="section-title">{{ t('lobby.desk') }}</h2>
          <p v-if="locked" class="hint">{{ t('match.locked') }}</p>
          <template v-else>
            <h3 class="label">{{ t('lobby.fields') }}</h3>
            <p v-if="!fields" class="hint">{{ t('create.loadingFields') }}</p>
            <FieldPicker
              v-else
              v-model="chosenFields"
              :fields="fields"
              :language="room.language"
              :needed="BOARD_SIZE"
            />
            <h3 class="label">
              <label for="custom-words">{{ t('settings.customWords') }}</label>
            </h3>
            <p v-if="room.public" class="hint">{{ t(errorKey('custom_words_private')) }}</p>
            <template v-else>
              <textarea
                id="custom-words"
                v-model="wordsText"
                class="words"
                rows="4"
                :maxlength="MAX_CUSTOM_INPUT"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
              ></textarea>
              <p v-if="words.tooLong.length" class="problem">
                {{ t('settings.customWordsTooLong', { words: tooLong }) }}
              </p>
              <p v-if="words.tooMany" class="problem">{{ t('settings.customWordsTooMany') }}</p>
              <p class="hint">
                {{ t('settings.customWordsCount', { count: words.words.length }, words.words.length) }} &middot;
                {{ t('settings.customWordsHint') }}
              </p>
            </template>
            <h3 class="label">{{ t('settings.title') }}</h3>
            <SettingsForm v-model="chosenSettings" v-model:valid="settingsValid" :language="room.language" />
          </template>
          <div v-if="unsaved" class="save">
            <UiButton size="small" :disabled="!savable" @click="save">{{ t('lobby.save') }}</UiButton>
            <p class="hint">{{ t('lobby.saveHint') }}</p>
          </div>
          <ul class="problems">
            <li v-for="item in problems" :key="problemKey(item)">{{ problemText(item) }}</li>
            <li v-if="!problems.length" class="ready">{{ t('lobby.ready') }}</li>
          </ul>
          <p v-if="lineup === 'free'" class="hint shuffle-hint">{{ t('lobby.shuffleHint') }}</p>
          <div class="desk-actions">
            <UiButton v-if="lineup === 'free'" @click="act('room:shuffle')">{{ t('lobby.shuffle') }}</UiButton>
            <UiButton
              variant="primary"
              :disabled="problems.length > 0 || starting || (unsaved && !savable)"
              @click="start"
            >
              {{ t('lobby.start') }}
            </UiButton>
          </div>
        </section>
        <section v-if="!isChair || locked" class="rules">
          <h2 class="section-title">{{ t('settings.title') }}</h2>
          <SettingsSummary :settings="data.settings" :language="room.language" :custom-words="room.customWordCount" />
        </section>
        <section v-if="!isChair && !finished" class="waiting">
          <ul class="problems">
            <li v-for="item in problems" :key="problemKey(item)">{{ problemText(item) }}</li>
          </ul>
          <p>{{ t('lobby.waiting') }}</p>
        </section>
      </div>
    </div>

    <PlayerMenu :player="managing" :room="room" @close="managing = null" />
  </section>
</template>

<style scoped>
.lobby-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4) 0;
}

.lobby-head .kicker {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--weight-display);
  font-synthesis: none;
}

.public {
  display: inline-block;
  margin-left: var(--space-1);
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--on-ink);
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  line-height: 1.6;
  vertical-align: middle;
}

.sections {
  display: grid;
  gap: var(--space-4);
}

.groups {
  display: grid;
  gap: var(--space-4);
}

.group,
.pool,
.spectators,
.rules,
.desk,
.waiting {
  padding: var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

.group.red .section-title {
  color: var(--red-deep);
}

.group.blue .section-title {
  color: var(--blue-deep);
}

dl {
  display: grid;
  grid-template-columns: 4rem minmax(0, 1fr);
  gap: var(--space-3) var(--space-3);
  margin: var(--space-3) 0 0;
}

/* Lined up with the middle of the 44 px row that a name or a button makes. */
dt {
  padding-top: 11px;
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-black);
  letter-spacing: 0.04em;
  text-transform: uppercase;
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
  color: var(--ink-2);
  font-weight: var(--weight-bold);
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
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.footnote {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.label {
  margin-top: var(--space-3);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
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

.words {
  width: 100%;
  margin-top: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--paper);
  color: var(--ink);
  font: inherit;
  font-size: max(16px, var(--text-md));
  resize: vertical;
}

.words:focus-visible {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.problem {
  color: var(--red-deep);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
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
  color: var(--red-deep);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.problems .ready {
  color: var(--ink);
}

.shuffle-hint {
  margin-bottom: var(--space-3);
}

.desk-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.waiting p {
  font-weight: var(--weight-bold);
}

@media (min-width: 40rem) {
  .groups {
    grid-template-columns: 1fr 1fr;
  }
}

/* On a phone the sections are one column, the two below being no boxes of their own. */
.column {
  display: contents;
}

/* Two columns: a match's table, the groups (or the pool), the spectators and the footnote on the
   left; on the right the chair's desk, or the rules, or both while a match has locked the
   settings, the desk first, in the page's own order, so that the start button is at hand for the
   eye, the keyboard and a screen reader alike. Each column stacks its sections from the top,
   whatever the other holds. */
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

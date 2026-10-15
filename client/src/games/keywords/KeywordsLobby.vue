<script setup lang="ts">
import {
  BOARD_SIZE,
  MAX_CUSTOM_INPUT,
  otherTeam,
  parseCustomWords,
  sameSettings,
  type KeywordsSettings,
  type PlayerView,
  type RoomView,
  type StartProblem,
  type Team,
} from '@reviewer2/shared';
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import FieldFold from '../../core/components/FieldFold.vue';
import InviteFriends from '../../core/components/InviteFriends.vue';
import InvitedFriends from '../../core/components/InvitedFriends.vue';
import MatchResults from '../../core/components/MatchResults.vue';
import MatchTable from '../../core/components/MatchTable.vue';
import PlayerName from '../../core/components/PlayerName.vue';
import ShareTools from '../../core/components/ShareTools.vue';
import EmoteButton from '../../core/components/EmoteButton.vue';
import UiButton from '../../core/components/UiButton.vue';
import UiSheet from '../../core/components/UiSheet.vue';
import { account } from '../../core/account';
import { fields, loadFields } from '../../core/fields';
import { errorKey } from '../../core/errors';
import { formatList } from '../../core/i18n';
import { act, reconnecting } from '../../core/socket';
import { ROOM_ACTIONS } from '../../core/useRoomPage';
import { useStickyHeight } from '../../core/useStickyHeight';
import SettingsForm from './SettingsForm.vue';
import SettingsSummary from './SettingsSummary.vue';
import { useKeywords } from './useKeywords';

// The waiting room: the two groups with their PI and students, the viewer marked among them, the
// spectators and the screens, the room's settings, and the chair's desk with the word lists, the
// chair's own words and the settings. The reaction button is in the room's masthead, which stays at
// the top of the screen in the waiting room (RoomPage.vue). The chair's start bar stands above it
// all and stays under the masthead as the page scrolls, so that the start button is at hand
// from the first screen to the foot of the desk: whether everyone needed is seated, or the first
// thing still missing, and under it the shuffle, the invitation to friends for an account, and the
// start button, sharing their row evenly however many there are. A member with an account who
// doesn't chair the room has a bar of their own there, on one row where it fits, with the same
// line and the invitation alone; a guest, who can't invite anyone, has none. The tag beside the
// heading says whether the room is public, and the chair switches it there, as in the room menu.
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
const problemText = (item: StartProblem) => {
  if (item.problem === 'needs_players') return t('lobby.problems.needs_players', { missing: item.missing });
  if (!('team' in item)) return t(`lobby.problems.${item.problem}`);
  return t(`lobby.problems.${item.problem}`, { group: t(`lobby.group.${item.team}`) });
};
const problemKey = (item: StartProblem) =>
  [item.problem, 'team' in item ? item.team : 'missing' in item ? item.missing : ''].join('-');

// The chair invites AI players where the room may have them (docs/games/keywords.md#ai-players): a
// group's PI, in its empty seat, and one of its students, as long as the group has no AI student,
// once a person sits in a group. A game with them needs every time limit on, which the chair is
// reminded of beside the seats while one is off.
const personSeated = computed(() =>
  props.room.players.some((player) => player.agent === undefined && data.value.seats[player.id]?.team),
);
// An account may invite its friends into the room, online or not, from the start bar
// (docs/architecture.md#friends).
const mayInviteFriends = computed(() => account.summary !== null);
const invitingFriends = ref(false);
const canInvite = computed(() => isChair.value && props.room.agents && lineup.value === 'free' && personSeated.value);
const hasAgents = computed(() => props.room.players.some((player) => player.agent));
const timersOff = computed(() => {
  const { firstClueTime, clueTime, guessTime } = data.value.settings;
  return firstClueTime === 0 || clueTime === 0 || guessTime === 0;
});
const agentName = computed(() => t('agents.personas.reviewer1'));
const invite = (team: Team, role: 'captain' | 'guesser') =>
  act('room:addAgent', { persona: 'reviewer1', seat: { team, role } });

// The chair's choice of word lists, and of whether every game draws them anew, which is only sent
// when they save it. Every snapshot brings the room's lists as a new array, so they are compared
// by their contents: an unsaved choice survives the snapshots that others cause by taking seats or
// coming and going.
const roomFields = computed(() => [...props.room.fields].sort().join());
const chosenFields = ref<string[]>([...props.room.fields]);
const chosenRandom = ref(props.room.randomFields);
const fieldsChanged = computed(
  () => [...chosenFields.value].sort().join() !== roomFields.value || chosenRandom.value !== props.room.randomFields,
);

watch(roomFields, () => (chosenFields.value = [...props.room.fields]));
watch(
  () => props.room.randomFields,
  (random) => (chosenRandom.value = random),
);

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
    (chosenFields.value.length > 0 || chosenRandom.value || words.value.words.length >= BOARD_SIZE) &&
    settingsValid.value &&
    wordsValid.value,
);
// The words go along only when they changed, so that the server doesn't read them again for a
// setting.
const save = () =>
  act('room:settings', {
    fields: chosenFields.value,
    randomFields: chosenRandom.value,
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
// What the start bar says on its one line: the first thing still missing, which the desk lists in
// full; or, with everyone seated, that what was changed at the desk can't be saved, which the desk
// marks and which keeps the start button off too; or else that the room is ready.
const unsavable = computed(() => unsaved.value && !savable.value);
const ready = computed(() => problems.value.length === 0 && !unsavable.value);
const readiness = computed(() => {
  const first = problems.value[0];
  if (first) return problemText(first);
  return t(unsavable.value ? 'lobby.unsavable' : 'lobby.ready');
});
// The bar's height goes into the page's scroll padding, so that a field of the desk that takes the
// focus comes into view below it, however many rows the bar has.
const dock = ref<HTMLElement | null>(null);
useStickyHeight(dock);

// The chair switches the room between public and private from the tag beside the heading, as in
// the room menu, and without asking again. Listing it takes an account: a guest is told so, with
// the way to log in or register and come back to the room (AccountPage), where the server finds
// them in their seat, the chair's included.
const needsAccount = ref(false);
const signIn = computed(() => ({ path: '/account', query: { next: `/room/${props.room.code}` } }));
function switchVisibility() {
  if (!props.room.public && !account.summary) {
    needsAccount.value = true;
    return;
  }
  void act('room:public', { public: !props.room.public });
}
const isMe = (player: PlayerView) => player.id === props.room.me;
const isChairOf = (player: PlayerView) => player.id === props.room.chairId;
</script>

<template>
  <section class="lobby">
    <Teleport defer :to="`#${ROOM_ACTIONS}`">
      <EmoteButton />
    </Teleport>
    <header class="lobby-head">
      <p class="kicker">
        {{ t('home.games.keywords.name') }} &middot; {{ t('lobby.kicker') }}
        <button v-if="isChair" type="button" class="visibility" @click="switchVisibility">
          <span class="tag" :class="{ listed: room.public }">{{
            t(room.public ? 'room.public' : 'room.private')
          }}</span>
          <span class="sr-only">{{ t(room.public ? 'room.makePrivate' : 'room.makePublic') }}</span>
        </button>
        <span v-else-if="room.public" class="public">{{ t('room.public') }}</span>
      </p>
      <ShareTools :room="room" />
    </header>

    <div
      v-if="(isChair || mayInviteFriends) && !finished"
      ref="dock"
      class="start-dock"
      :class="{ 'below-banner': reconnecting }"
    >
      <div class="start-bar" :class="{ member: !isChair }">
        <div class="ready-line">
          <p class="readiness" :class="{ ready }">{{ readiness }}</p>
          <InvitedFriends v-if="mayInviteFriends" :room="room" @open="invitingFriends = true" />
        </div>
        <div class="start-actions">
          <UiButton v-if="isChair && lineup === 'free'" size="small" @click="act('room:shuffle')">{{
            t('lobby.shuffle')
          }}</UiButton>
          <UiButton v-if="mayInviteFriends" class="invite-friends" size="small" @click="invitingFriends = true">
            {{ t('friends.invite') }}
          </UiButton>
          <UiButton v-if="isChair" variant="primary" size="small" :disabled="!ready || starting" @click="start">
            {{ t('lobby.start') }}
          </UiButton>
        </div>
      </div>
    </div>
    <InviteFriends :open="invitingFriends" :room="room" @close="invitingFriends = false" />

    <MatchResults v-if="finished" :room="room" />

    <div class="sections">
      <div class="column">
        <MatchTable v-if="match && !finished" :room="room" />

        <section v-if="lineup === 'draw'" class="pool">
          <h2 class="section-title">{{ t('match.drawn') }}</h2>
          <ul v-if="pool.length" class="names inline">
            <li v-for="player in pool" :key="player.id">
              <PlayerName :player="player" :me="isMe(player)" :chair="isChairOf(player)" />
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
                />
                <span v-else class="vacant">{{ t('lobby.vacant') }}</span>
                <UiButton v-if="!group.captain && mayTake(group.team)" size="small" @click="sit(group.team, 'captain')">
                  {{ t('lobby.takeCaptain') }}
                </UiButton>
                <UiButton
                  v-if="!group.captain && canInvite"
                  size="small"
                  variant="quiet"
                  @click="invite(group.team, 'captain')"
                >
                  {{ t('lobby.inviteAgent', { name: agentName }) }}
                </UiButton>
              </dd>
              <dt>{{ t('lobby.roles.guesser') }}</dt>
              <dd>
                <ul v-if="group.guessers.length" class="names">
                  <li v-for="player in group.guessers" :key="player.id">
                    <PlayerName :player="player" :me="isMe(player)" :chair="isChairOf(player)" />
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
                <UiButton
                  v-if="canInvite && !group.guessers.some((player) => player.agent)"
                  size="small"
                  variant="quiet"
                  @click="invite(group.team, 'guesser')"
                >
                  {{ t('lobby.inviteAgent', { name: agentName }) }}
                </UiButton>
              </dd>
            </dl>
          </section>
          <p v-if="canInvite && timersOff" class="footnote">{{ t('lobby.problems.needs_timers') }}</p>
        </div>

        <section class="spectators">
          <h2 class="section-title">{{ t('lobby.roles.spectator') }}</h2>
          <ul v-if="spectators.length" class="names inline">
            <li v-for="player in spectators" :key="player.id">
              <PlayerName :player="player" :me="isMe(player)" :chair="isChairOf(player)" />
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
        <p v-if="room.agents || hasAgents" class="footnote">{{ t('lobby.agentNote') }}</p>
        <p v-if="room.agents" class="footnote">{{ t('lobby.takeoverNote') }}</p>
      </div>
      <div class="column">
        <section v-if="isChair && !finished" class="desk">
          <h2 class="section-title">{{ t('lobby.desk') }}</h2>
          <p v-if="locked" class="hint">{{ t('match.locked') }}</p>
          <template v-else>
            <FieldFold
              v-model="chosenFields"
              v-model:random="chosenRandom"
              :fields="fields"
              :language="room.language"
              :needed="BOARD_SIZE"
              each-game
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
          <ul v-if="problems.length" class="problems">
            <li v-for="item in problems" :key="problemKey(item)">{{ problemText(item) }}</li>
          </ul>
          <p v-if="lineup === 'free'" class="hint shuffle-hint">{{ t('lobby.shuffleHint') }}</p>
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

    <UiSheet :open="needsAccount" :title="t('room.makePublic')" @close="needsAccount = false">
      <div class="needs-account">
        <p>{{ t('room.publicNeedsAccount') }}</p>
        <RouterLink v-slot="{ href, navigate }" :to="signIn" custom>
          <UiButton variant="primary" :href="href" @click="navigate">{{ t('room.signIn') }}</UiButton>
        </RouterLink>
      </div>
    </UiSheet>
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

.public,
.tag {
  display: inline-block;
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--on-ink);
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  line-height: 1.6;
}

.public {
  margin-left: var(--space-1);
  vertical-align: middle;
}

/* The chair's tag is a sticker to tap, 44 px high to the finger (docs/design.md): white while the
   room is private, ink and flat once it is listed, as the others see it. */
.visibility {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin: calc(-1 * var(--space-2)) 0;
  padding: 0 var(--space-1);
  border: 0;
  background: none;
  color: inherit;
  vertical-align: middle;
  cursor: pointer;
  touch-action: manipulation;
}

.visibility .tag {
  padding: 2px var(--space-3);
  border: var(--line-thin) solid var(--ink);
  background: var(--paper);
  box-shadow: var(--shadow-1);
  color: var(--ink);
  transition:
    transform var(--motion),
    box-shadow var(--motion);
}

.visibility .tag.listed {
  background: var(--ink);
  box-shadow: none;
  color: var(--on-ink);
}

.visibility:active .tag {
  transform: translate(var(--shift-1), var(--shift-1));
  box-shadow: none;
}

.visibility:active .tag.listed {
  transform: none;
}

/* The chair's start bar, which stays at the top of the screen as the page scrolls, under the
   room's masthead, which stays there too in the waiting room (--pinned-height, PageMasthead.vue),
   and under the banner while the page reconnects, as the game's clock does. Its background reaches the edges of
   the screen and covers its own sticker's shadow, so that nothing shows through beside it. A field
   of the desk that the page brings into view stays below it: the bar's height, as measured
   (useStickyHeight), and the banner's go into the page's scroll padding. */
.start-dock {
  position: sticky;
  top: var(--pinned-height, 0px);
  z-index: 5;
  margin-bottom: var(--space-2);
  padding: var(--space-2) 0 var(--space-3);
  background: var(--bg);
  box-shadow: 0 0 0 100vmax var(--bg);
  clip-path: inset(0 -100vmax);
}

.start-dock.below-banner {
  top: calc(var(--banner-height) + var(--pinned-height, 0px));
}

:global(html:has(.start-dock)) {
  scroll-padding-top: calc(var(--banner-height) + var(--pinned-height, 0px) + var(--sticky-height, 8rem));
}

/* One line for whether the room is ready, and the buttons under it, or beside it where there is
   room. The chair's buttons share their row evenly, two or three of them, or one that takes the
   row, and a long word wraps inside its button; on a wide screen they stand beside the line, all
   as wide. A member's bar keeps its line and its one button on one row where they fit, the line
   wrapping rather than cut off. */
.start-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

/* The line, with the avatars of the friends invited at its right end. */
.ready-line {
  display: flex;
  flex: 1 1 14rem;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.readiness {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--red-deep);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.readiness.ready {
  color: var(--ink);
}

.start-actions {
  display: grid;
  flex: 1 1 100%;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  gap: var(--space-2);
}

.start-bar:not(.member) .ready-line {
  flex-basis: 100%;
}

.start-actions > .button {
  padding: 0 var(--space-2);
  white-space: normal;
  text-align: center;
}

.start-bar.member {
  column-gap: var(--space-2);
  padding-right: var(--space-3);
  padding-left: var(--space-3);
}

.member .ready-line {
  flex: 1 1 8rem;
}

.member .readiness {
  white-space: normal;
}

.member .start-actions {
  flex: none;
}

.member .start-actions > .button {
  padding: 0 var(--space-3);
}

@media (min-width: 40rem) {
  .start-bar:not(.member) .ready-line {
    flex: 1 1 14rem;
  }

  .start-bar:not(.member) .start-actions {
    flex: 0 1 auto;
    grid-auto-columns: 10rem;
  }
}

.needs-account {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
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

.desk .field-fold {
  margin-top: var(--space-3);
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
  margin-top: var(--space-3);
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

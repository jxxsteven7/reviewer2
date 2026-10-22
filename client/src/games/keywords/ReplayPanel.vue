<script setup lang="ts">
import { actionsOf, type ReplayAction, type ShownReplay } from '@reviewer2/shared/keywords';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AgentProfileCard from '../../core/components/AgentProfileCard.vue';
import PlayerAvatar from '../../core/components/PlayerAvatar.vue';
import ProfileCard from '../../core/components/ProfileCard.vue';
import UiButton from '../../core/components/UiButton.vue';
import UiSheet from '../../core/components/UiSheet.vue';
import { formatList } from '../../core/i18n';
import { nameOf, usernameAfter } from '../../core/names';

// The panel that an avatar opens in a replay (ReplayViewer.vue), in the look of the room's
// (PlayerPanel.vue), with nothing of the chair's: for an account, its brief profile card and the
// way to the whole page; for an AI player, its own page; for a guest and a deleted account, the
// avatar under the title that names them. For everyone, the way to their moves in the game, a
// sheet of its own over the panel, which it hides until the way back (UiSheet.vue), as the whole
// page does: as a PI, each clue, the cards meant and how far the group got with it; as a student,
// each card revealed and whether it was right (actionsOf in shared/src/games/keywords/replay.ts).
// A tap on a move closes the panel and takes the replay to its step (`go`).
const props = defineProps<{ replay: ShownReplay; playerId: string | null }>();
const emit = defineEmits<{ close: []; go: [step: number] }>();
const { t, locale } = useI18n();
const INFINITY = '∞';

const person = computed(() => (props.playerId === null ? null : (props.replay.people[props.playerId] ?? null)));
const name = computed(() => (person.value ? nameOf(person.value) : ''));
// The username follows the name that the viewer gives a friend, on the panel and the whole page, as
// in a room (PlayerPanel.vue).
const username = computed(() =>
  person.value?.handle === undefined ? null : usernameAfter({ name: name.value, username: person.value.name ?? '' }),
);
const reading = ref(false);
const acting = ref(false);
// Each player starts afresh, on the panel.
watch(
  () => props.playerId,
  () => {
    reading.value = false;
    acting.value = false;
  },
);
const actions = computed(() => (props.playerId === null ? [] : actionsOf(props.replay, props.playerId)));

const word = (card: number) => props.replay.cards[card]?.word ?? '';
const outcome = (right: boolean, color: string) =>
  right ? t('replay.right') : t(`replay.wrong.${color === 'neutral' || color === 'reviewer2' ? color : 'team'}`);

// What a move says, line by line, after its turn.
function linesOf(action: ReplayAction): string[] {
  if (action.kind === 'guess') {
    return [t('replay.actions.revealed', { word: word(action.card), outcome: outcome(action.right, action.color) })];
  }
  if (action.word === null) return [t('replay.noClue')];
  const count = action.count === 'unlimited' ? INFINITY : action.count;
  const lines = [t('replay.clue', { word: action.word, count })];
  if (action.targets.length > 0) {
    lines.push(t('game.meant', { words: formatList(locale.value, action.targets.map(word)) }));
  }
  lines.push(t('replay.actions.found', { found: action.found, guesses: action.guesses }));
  if (action.stopped) {
    const { card, color } = action.stopped;
    lines.push(t('replay.actions.stopped', { word: word(card), outcome: outcome(false, color) }));
  } else if (action.timedOut) {
    lines.push(t('replay.timedOut'));
  }
  return lines;
}
</script>

<template>
  <UiSheet :open="person !== null" :title="name" :subtitle="username" @close="emit('close')">
    <div v-if="person" class="panel-body">
      <ProfileCard v-if="person.handle" :handle="person.handle" brief :named="false" />
      <AgentProfileCard v-else-if="person.agent" :persona="person.agent" />
      <PlayerAvatar
        v-else
        :name="name"
        :initial="person.deleted ? t('replay.deletedInitial') : null"
        :guest="person.guest"
        :avatar="person.avatar"
        size="large"
      />
      <div class="actions">
        <UiButton @click="acting = true">{{ t('replay.actions.open') }}</UiButton>
        <UiButton v-if="person.handle" @click="reading = true">{{ t('room.panel.fullPage') }}</UiButton>
      </div>
    </div>
  </UiSheet>

  <UiSheet
    :open="person !== null && reading"
    :title="name"
    :subtitle="username"
    :back="t('room.panel.back')"
    @back="reading = false"
    @close="emit('close')"
  >
    <ProfileCard v-if="person?.handle" :handle="person.handle" :named="false" />
  </UiSheet>

  <UiSheet
    :open="person !== null && acting"
    :title="t('replay.actions.title', { name })"
    :back="t('room.panel.back')"
    @back="acting = false"
    @close="emit('close')"
  >
    <p v-if="actions.length === 0" class="hint">{{ t('replay.actions.none') }}</p>
    <ol v-else class="moves">
      <li v-for="action in actions" :key="action.step">
        <button type="button" class="move" :class="action.team" @click="emit('go', action.step)">
          <span class="turn">{{
            t('replay.turn', { turn: action.turn, group: t(`games.keywords.groups.${action.team}`) })
          }}</span>
          <span v-for="line in linesOf(action)" :key="line">{{ line }}</span>
        </button>
      </li>
    </ol>
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

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.moves {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Each move on a block in its group's tint, as the replay's step is, which a tap goes to. */
.move {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  width: 100%;
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-card);
  background: var(--paper-2);
  color: var(--ink);
  font: inherit;
  font-size: var(--text-sm);
  text-align: start;
  cursor: pointer;
}

.move.red {
  background: var(--red-tint);
}

.move.blue {
  background: var(--blue-tint);
}

.move:active {
  transform: translate(1px, 1px);
}

.move:focus-visible {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.turn {
  font-weight: var(--weight-black);
}
</style>

<script setup lang="ts">
import { MAX_AGENT_WAIT_MS, type AgentPersona } from '@reviewer2/shared';
import { AGENT_GUESS_THINKING_MS, type GuessRule, type KeywordsView, type Seat } from '@reviewer2/shared/keywords';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useUrgentTitle } from '../../core/head';
import { bannerFor } from './banner';
import ClockBar from '../../core/components/ClockBar.vue';
import WhoseTurn from '../../core/components/WhoseTurn.vue';
import WordSticker from '../../core/components/WordSticker.vue';
import { periodOf } from './clock';
import GroupBars, { type Group } from './GroupBars.vue';

// Whose turn it is, in which phase, with the current clue, how much time the phase has left and
// how many cards each group still has to find, on the whose-turn strip above the board
// (WhoseTurn.vue). Under the free guess
// rule, a clue's number sets no limit, so there is none to show. The game page shows the clock
// apart, under the strip, where it can stay at the top of the screen (KeywordsGame).
//
// For a member of the room, the `seat` they are in: the strip says first, in small type in the
// color of their group, who they are, and then, in the display fonts, in the current group's
// color, what is going on for them now (banner.ts), such as "Your turn to guess!"; on their move
// the tab's title says so too, for a player who has gone to another tab while they wait. A big
// screen, which nobody sits at, says what the current group is doing.
//
// While it is their group's turn, in either phase, the strip takes their group's tint, so that a
// player sees at a glance that the game waits for their side; the clock is red only while they
// themselves have to act (ClockBar.vue).
//
// While an AI makes the move (`agent`, banner.ts), the strip says to everyone that it is thinking,
// and under that, in grey, for how long it may: most of the longest wait the agent is given before
// a clue, 20 seconds before a guess, and no longer than the phase has.
//
// In the tutorial (`demo`), where the game is invented, the strip leaves the tab's title alone,
// and its clock stands at what the step gives, since no server will end the phase.
//
// Under it, the two groups' bars (GroupBars.vue).
const props = withDefaults(
  defineProps<{
    game: KeywordsView;
    guessRule: GuessRule;
    seat?: Seat | null;
    agent?: AgentPersona | null;
    clockApart?: boolean;
    groups?: Group[];
    me?: string | null;
    demo?: boolean;
  }>(),
  { seat: null, agent: null, clockApart: false, groups: () => [], me: null, demo: false },
);
const { t } = useI18n();

const group = computed(() => t(`games.keywords.groups.${props.game.team}`));
const banner = computed(() => (props.seat ? bannerFor(props.seat, props.game, props.agent) : null));
const ours = computed(() => props.seat?.team === props.game.team && props.game.phase !== 'over');
const who = computed(() => {
  if (!props.seat) return null;
  const { team, role } = props.seat;
  if (team === null) return t('banner.spectator');
  return t('banner.seat', { group: t(`games.keywords.groups.${team}`), role: t(`banner.roles.${role}`) });
});
const agentName = computed(() => (props.agent ? t(`agents.personas.${props.agent}`) : ''));
const line = computed(() => {
  if (!banner.value) {
    return props.agent
      ? t('banner.lines.agentThinking', { name: agentName.value })
      : t(`game.phase.${props.game.phase}`, { group: group.value });
  }
  const about = banner.value.group;
  return t(`banner.lines.${banner.value.line}`, {
    group: about ? t(`games.keywords.groups.${about}`) : '',
    name: agentName.value,
  });
});
const seconds = computed(() => {
  const most = props.game.phase === 'clue' ? MAX_AGENT_WAIT_MS : AGENT_GUESS_THINKING_MS;
  return Math.ceil(Math.min(most, props.game.clock?.total ?? most) / 1000);
});
const note = computed(() => (props.agent ? t('banner.agentHint', { seconds: seconds.value }) : null));
const count = computed(() => {
  const value = props.game.clue?.count;
  return value === 'unlimited' ? '\u221e' : String(value ?? '');
});

useUrgentTitle(() => (banner.value?.urgent && !props.demo ? t('banner.tabTitle') : null));
</script>

<template>
  <WhoseTurn
    :line="line"
    :note="note"
    :turn="t('game.turn', { turn: game.turn })"
    :who="who"
    :who-tint="seat?.team ?? null"
    :tint="game.phase === 'over' ? null : game.team"
    :ours="ours"
  >
    <p v-if="game.clue" class="clue">
      <span class="label">{{ t('game.clue') }}</span>
      <WordSticker>{{ game.clue.word }}</WordSticker>
      <span class="count num">{{ count }}</span>
      <span v-if="guessRule === 'standard'" class="left num">
        {{ game.guessesLeft === null ? t('game.noLimit') : t('game.guessesLeft', { count: game.guessesLeft }) }}
      </span>
    </p>
    <template #after>
      <ClockBar
        v-if="game.clock && !clockApart"
        :clock="game.clock"
        :period="periodOf(game)"
        :frozen="game.paused || demo"
        :mine="banner?.urgent"
      />
      <GroupBars :groups="groups" :remaining="game.remaining" :me="me" />
    </template>
  </WhoseTurn>
</template>

<style scoped>
.clue {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.clue .label {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

/* The clue's number on an ink disc beside it. */
.clue .count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--ink);
  color: var(--on-ink);
  font-size: var(--text-xl);
  font-weight: var(--weight-display);
}

.clue .left {
  margin-left: auto;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}
</style>

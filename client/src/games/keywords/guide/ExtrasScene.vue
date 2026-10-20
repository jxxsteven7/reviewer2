<script setup lang="ts">
import { defaultSettings, type Language, type Mark, type Team } from '@reviewer2/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import EmoteButton from '../../../core/components/EmoteButton.vue';
import UiButton from '../../../core/components/UiButton.vue';
import { useSpot, type SpotTarget } from '../../../core/guide/spot';
import ClockBar, { periodOf } from '../ClockBar.vue';
import ClueLog from '../ClueLog.vue';
import DecisionLetter from '../DecisionLetter.vue';
import GroupChat from '../GroupChat.vue';
import GuessBar from '../GuessBar.vue';
import KeywordsBoard from '../KeywordsBoard.vue';
import TurnStrip from '../TurnStrip.vue';
import { CARDS, cardSpot, demoOf, demoRoom, ME, piStep, studentStep } from './demo';

// A step of "More in a game": the parts of the game page that the step is about, from the invented
// game (demo.ts), with Mira as a student in the red group. Only to look at: the group chat of an
// invented room, the marks on the board, the bar with the clock, the chair's button to pause and
// the reactions, the button for an extension, and the way to the replay once the game is over.
const props = defineProps<{ chapter: string; step: number }>();
const { t, locale } = useI18n();
const language = computed(() => locale.value as Language);
const settings = computed(() => defaultSettings(language.value));
const demo = computed(() => demoOf(t));

// Red's students guess "Astronomy, 3", with two cards found.
const guessing = computed(() => {
  const view = studentStep(demo.value, 6).view;
  return { ...view, clock: { left: 74_000, total: 120_000 } };
});
// While blue guesses, red's students have marked three cards.
const marking = computed(() => studentStep(demo.value, 8).view);
const MARKS = new Map<number, Mark>([
  [CARDS.pValue, 'theirs'],
  [CARDS.galaxy, 'ours'],
  [CARDS.deadline, 'r2'],
]);
const over = computed(() => piStep(demo.value, 8).view);

const room = computed(() =>
  demoRoom(t, language.value, {
    seats: {
      [ME]: { team: 'red', role: 'guesser' },
      ava: { team: 'red', role: 'guesser' },
      theo: { team: 'red', role: 'captain' },
      lin: { team: 'blue', role: 'captain' },
    },
    game: {
      ...guessing.value,
      chat: [
        { id: 1, player: 'ava', turn: 1, text: t('guide.demo.chat.1') },
        { id: 2, player: ME, turn: 1, text: t('guide.demo.chat.2') },
        { id: 3, player: 'ava', turn: 1, text: t('guide.demo.chat.3') },
      ],
    },
  }),
);
const seat = { team: 'red' as Team, role: 'guesser' as const };
const groups = computed(() => {
  const name = (id: string) => room.value.players.find((player) => player.id === id)?.name ?? '';
  const member = (id: string) => ({ id, name: name(id), username: id === ME ? 'mira' : id, online: true });
  return [
    { team: 'red' as Team, captain: member('theo'), guessers: [member(ME), member('ava')] },
    { team: 'blue' as Team, captain: member('lin'), guessers: [] },
  ];
});

const SPOTS: Record<number, SpotTarget> = {
  1: { selector: '.chat-panel .message:last-child', finger: 'point' },
  2: cardSpot(CARDS.deadline, 'point'),
  3: { selector: '.emote-button .button', finger: 'point' },
  4: { selector: '.extend', finger: 'point' },
  5: { selector: '.pause', finger: 'point' },
  6: { selector: '.review', finger: 'point' },
};
const root = ref<HTMLElement | null>(null);
useSpot(root, () => SPOTS[props.step] ?? null);
</script>

<template>
  <div ref="root" class="extras-scene" inert>
    <GroupChat v-if="step === 1" :room="room" :sending="false" draft="" panel />

    <template v-else-if="step === 2">
      <TurnStrip :game="marking" :guess-rule="settings.guessRule" :seat="seat" :groups="groups" :me="ME" demo />
      <KeywordsBoard
        :cards="marking.cards"
        :selectable="false"
        :selected="null"
        :lang="language === 'zh' ? 'zh-CN' : 'en'"
        :notes="MARKS"
        team="red"
      />
      <p class="gestures">{{ t('game.gestures.mark') }}</p>
    </template>

    <template v-else-if="step < 6">
      <TurnStrip
        :game="guessing"
        :guess-rule="settings.guessRule"
        :seat="seat"
        :groups="groups"
        :me="ME"
        clock-apart
        demo
      />
      <div class="bar">
        <ClockBar v-if="guessing.clock" :clock="guessing.clock" :period="periodOf(guessing)" frozen mine />
        <UiButton class="pause" size="small">{{ t('game.pause') }}</UiButton>
        <EmoteButton />
      </div>
      <div class="actions">
        <GuessBar :game="guessing" :selected="null" />
        <UiButton v-if="step === 4" class="extend" size="small">{{ t('game.extend') }}</UiButton>
      </div>
    </template>

    <template v-else>
      <DecisionLetter :game="over" side="red" :is-chair="false" compact />
      <UiButton class="review" variant="quiet" size="small">{{ t('game.review') }}</UiButton>
      <ClueLog :game="over" />
    </template>
  </div>
</template>

<style scoped>
.extras-scene {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.extras-scene > :deep(.strip) {
  margin: 0;
}

.extras-scene > :deep(.chat-panel) {
  padding: var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

/* The bar under the strip, as the game keeps it at the top of the screen. */
.bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.bar > .clock {
  flex: 1;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.actions > .extend,
.review {
  align-self: flex-start;
}

.gestures {
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>

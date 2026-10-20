<script setup lang="ts">
import { clueCounts, defaultSettings, type Language, type Mark, type Team } from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { spot, useSpot } from '../../../core/guide/spot';
import ClueLog from '../ClueLog.vue';
import CluePanel from '../CluePanel.vue';
import DecisionLetter from '../DecisionLetter.vue';
import GuessBar from '../GuessBar.vue';
import KeywordsBoard from '../KeywordsBoard.vue';
import TurnStrip from '../TurnStrip.vue';
import { CARDS, demoOf, ME, piStep, studentStep } from './demo';

// A step of "Playing a student" or "Playing the PI" (demo.ts): the game's own strip, board and play
// area, from the invented game, as the reader's seat in the red group sees it. Nothing in it acts
// on its own: a tap on what the finger is at takes the reader to the next step, and a tap anywhere
// else does nothing, so that nothing is ever sent. Only the clue may be typed, and its checks are
// the game's own. Where the finger holds a card down, the card's menu of marks is the game's own
// too, and a tap on the card marks it as the other group's; the mark stays for the steps after.
const props = defineProps<{ chapter: string; step: number }>();
const emit = defineEmits<{ next: [] }>();
const { t, locale } = useI18n();
const language = computed(() => locale.value as Language);
const settings = computed(() => defaultSettings(language.value));
const demo = computed(() => demoOf(t));
const scene = computed(() =>
  props.chapter === 'pi' ? piStep(demo.value, props.step) : studentStep(demo.value, props.step),
);
const game = computed(() => scene.value.view);
const seat = computed(() => ({ team: 'red' as Team, role: scene.value.role }));

// Who sits where: the reader in the red group, Reviewer 1 in the other seats.
const groups = computed(() => {
  const ai = (id: string) => ({ id, name: demo.value.reviewer1, agent: 'reviewer1', online: true });
  const me = { id: ME, name: demo.value.me, username: 'mira', online: true };
  const captain = scene.value.role === 'captain';
  return [
    { team: 'red' as Team, captain: captain ? me : ai('r1-red-pi'), guessers: [captain ? ai('r1-red-student') : me] },
    { team: 'blue' as Team, captain: ai('r1-blue-pi'), guessers: [ai('r1-blue-student')] },
  ];
});
const waiting = computed(() => {
  const group = t(`lobby.group.${game.value.team}`);
  return game.value.phase === 'clue' ? t('game.waitClue', { group }) : t('game.waitGuess', { group });
});
const counts = computed(() => clueCounts(settings.value.guessRule, game.value.remaining.red));

// The clue as the PI writes it, from what the step gives.
const word = ref('');
watch(scene, (now) => (word.value = now.word ?? ''), { immediate: true });

// The mark that the reader made on the card the finger held down, which stays from then on.
const marked = ref<Mark | null>(null);
const marks = computed(() => {
  const all = new Map(scene.value.marks);
  if (marked.value && props.step >= 8 && props.chapter === 'student') all.set(CARDS.pValue, marked.value);
  return all;
});
const holding = computed(() => scene.value.spot?.finger === 'hold' && marked.value === null);

const root = ref<HTMLElement | null>(null);
useSpot(root, () => (holding.value || scene.value.spot?.finger !== 'hold' ? scene.value.spot : null));

function mark(card: number, chosen: Mark) {
  if (card === CARDS.pValue) marked.value = chosen;
}

function onClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('input')) return;
  event.stopPropagation();
  event.preventDefault();
  const current = spot.value;
  if (!current || !target || !current.el.contains(target)) return;
  if (current.finger === 'hold') mark(CARDS.pValue, 'theirs');
  else emit('next');
}

function onGive() {
  if (scene.value.spot?.selector.includes('.clue-panel')) emit('next');
}
</script>

<template>
  <div ref="root" class="play-scene" @click.capture="onClick">
    <DecisionLetter v-if="game.result" :game="game" side="red" :is-chair="false" compact />
    <TurnStrip v-else :game="game" :guess-rule="settings.guessRule" :seat="seat" :groups="groups" :me="ME" />
    <ClueLog v-if="scene.panel === 'log'" :game="game" />
    <KeywordsBoard
      v-else
      :cards="game.cards"
      :selectable="scene.panel === 'guess' || scene.panel === 'clue'"
      :selected="scene.selected ?? null"
      :choosers="scene.choosers"
      :lang="language === 'zh' ? 'zh-CN' : 'en'"
      :targeting="scene.role === 'captain' ? 'red' : null"
      :targets="scene.targets"
      :notes="marks"
      :quiet-notes="scene.role === 'captain'"
      team="red"
      :gestures="holding"
      :turned="scene.turned ?? null"
      @mark="mark"
    />
    <div v-if="scene.panel !== 'log'" class="play">
      <GuessBar v-if="scene.panel === 'guess'" :game="game" :selected="scene.selected ?? null" />
      <p v-else-if="scene.panel !== 'clue' && !game.result" class="status">{{ waiting }}</p>
      <p v-if="scene.panel === 'marking' && !game.result" class="gestures">{{ t('game.gestures.mark') }}</p>
      <CluePanel
        v-if="scene.panel === 'clue' || scene.panel === 'draft'"
        v-model:word="word"
        :game="game"
        :counts="counts"
        :settings="settings"
        :language="language"
        :targets="scene.targets"
        :can-give="scene.panel === 'clue'"
        team="red"
        @give="onGive"
      />
    </div>
  </div>
</template>

<style scoped>
.play-scene {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.play-scene > :deep(.strip) {
  margin: 0;
}

.play {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.status {
  font-weight: var(--weight-bold);
}

.gestures {
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>

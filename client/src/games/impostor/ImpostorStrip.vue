<script setup lang="ts">
import type { ImpostorView } from '@reviewer2/shared/impostor';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import WhoseTurn from '../../core/components/WhoseTurn.vue';
import WordSticker from '../../core/components/WordSticker.vue';
import { useUrgentTitle } from '../../core/head';

// The hidden word game's whose-turn strip (WhoseTurn.vue): who the viewer is, by number, and once
// they are out what they were; or that they set the words, or watch. Then what happens now, for
// them: their turn to describe, whose turn it is, the vote, the revote among the tied, a guess of
// the students' word, or a report that holds the clock. The round on the right. Under it, the
// viewer's own word, which only they see; for the PI, that they have none; for the setter, both
// words; for a spectator with the god view, both words and whose they are. A game with AI players
// says so, without saying which numbers they are, and that it brings nobody points. On the viewer's
// move the tab's title says so too, for a player who has gone to another tab while they wait.
const props = withDefaults(
  defineProps<{ game: ImpostorView; setter?: boolean; agents?: number; mustAct?: boolean }>(),
  { setter: false, agents: 0, mustAct: false },
);
const { t } = useI18n();

const me = computed(() => props.game.you);
const mySeat = computed(() => props.game.seats.find((seat) => seat.number === me.value?.number) ?? null);
const out = computed(() => mySeat.value !== null && mySeat.value.fate !== 'alive');

const who = computed(() => {
  if (props.setter) return t('games.impostor.strip.setter');
  if (!me.value) return t('games.impostor.strip.spectator');
  if (out.value && me.value.role) {
    return t('games.impostor.strip.youOut', {
      number: me.value.number,
      role: t(`games.impostor.roles.${me.value.role}`),
    });
  }
  return t('games.impostor.strip.you', { number: me.value.number });
});

const line = computed(() => {
  const { game } = props;
  const mine = me.value?.number;
  if (game.report) return t('games.impostor.strip.report');
  switch (game.phase) {
    case 'describe':
    case 'tie': {
      const kind = game.phase === 'tie' ? 'tie' : 'describe';
      if (game.speaker !== null && game.speaker === mine) return t(`games.impostor.strip.${kind}Mine`);
      return t(`games.impostor.strip.${kind}`, { number: game.speaker ?? 0 });
    }
    case 'vote':
    case 'revote': {
      if (game.myVote === undefined && game.candidates.length > 0 && mine !== undefined && !out.value) {
        const tied = game.phase === 'revote' && game.tied.includes(mine);
        if (!tied) return t(`games.impostor.strip.${game.phase}Mine`);
      }
      return t(`games.impostor.strip.${game.phase}`);
    }
    case 'comeback':
      if (game.comeback !== null && game.comeback === mine) return t('games.impostor.strip.comebackMine');
      return t('games.impostor.strip.comeback', { number: game.comeback ?? 0 });
    default:
      return t('games.impostor.strip.over');
  }
});

useUrgentTitle(() => (props.mustAct ? t('banner.tabTitle') : null));
</script>

<template>
  <WhoseTurn :line="line" :turn="t('games.impostor.strip.round', { round: game.round })" :who="who">
    <p v-if="setter && game.setterWords" class="words">
      <span class="label">{{ t('games.impostor.strip.setterWords') }}</span>
      <WordSticker v-for="word in game.setterWords" :key="word">{{ word }}</WordSticker>
    </p>
    <p v-else-if="me && me.word" class="words">
      <span class="label">{{ t('games.impostor.strip.word') }}</span>
      <WordSticker>{{ me.word.word }}</WordSticker>
      <span class="hint">{{ t('games.impostor.strip.onlyYou') }}</span>
    </p>
    <p v-else-if="me" class="hint">{{ t('games.impostor.strip.noWord') }}</p>
    <p v-else-if="game.words" class="hint">
      {{ t('games.impostor.strip.godView', { student: game.words.student, reviewer2: game.words.reviewer2 }) }}
    </p>
    <p v-if="agents > 0" class="hint">{{ t('games.impostor.strip.agents', { count: agents }, agents) }}</p>
  </WhoseTurn>
</template>

<style scoped>
.words {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.label {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}
</style>

<script setup lang="ts">
import { otherTeam, type GameResult, type Team } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../core/components/UiButton.vue';

// The result, written as an editor's decision letter: accepted for the group that found all its
// keywords, rejected for the group that revealed Reviewer 2, or withdrawn by the chair.
const props = defineProps<{ result: GameResult; isChair: boolean }>();
const emit = defineEmits<{ again: [] }>();
const { t } = useI18n();

const group = (team: Team) => t(`lobby.group.${team}`);

const letter = computed(() => {
  const { winner, reason } = props.result;
  if (reason === 'withdrawn' || winner === null) {
    return { verdict: t('game.letter.withdrawn'), tone: 'withdrawn', body: t('game.letter.withdrawnBody') };
  }
  if (reason === 'reviewer2') {
    const loser = otherTeam(winner);
    return {
      verdict: t('game.letter.rejected'),
      tone: loser,
      body: t('game.letter.reviewer2', { group: group(loser), winner: group(winner) }),
    };
  }
  return { verdict: t('game.letter.accepted'), tone: winner, body: t('game.letter.found', { group: group(winner) }) };
});
</script>

<template>
  <article class="letter" :class="letter.tone">
    <p class="kicker">{{ t('game.letter.title') }}</p>
    <h2 class="verdict">{{ letter.verdict }}</h2>
    <p class="body">{{ letter.body }}</p>
    <p class="signature">{{ t('game.letter.signature') }}</p>
    <UiButton v-if="isChair" variant="primary" @click="emit('again')">{{ t('game.letter.again') }}</UiButton>
    <p v-else class="wait">{{ t('game.letter.waitAgain') }}</p>
  </article>
</template>

<style scoped>
.letter {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  margin: var(--space-4) 0;
  padding: var(--space-4);
  border: 1px solid var(--ink);
  border-radius: var(--radius-card);
}

.verdict {
  font-size: var(--text-3xl);
}

.red .verdict {
  color: var(--red);
}

.blue .verdict {
  color: var(--blue);
}

.withdrawn .verdict {
  color: var(--ink-2);
}

.body {
  max-width: 34rem;
  font-family: var(--font-serif);
  font-size: var(--text-lg);
}

.signature {
  align-self: flex-end;
  margin-bottom: var(--space-2);
  color: var(--ink-2);
  font-family: var(--font-serif);
}

.signature:lang(en) {
  font-style: italic;
}

.wait {
  color: var(--ink-3);
  font-size: var(--text-sm);
}
</style>

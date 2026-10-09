<script setup lang="ts">
import { otherTeam, type KeywordsView, type Team } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../core/components/UiButton.vue';
import { letterNumber, lettersFor, verdictFor } from './letters';

// The result, written as each group's decision letter from a conference that doesn't exist
// (letters.ts). A player reads their own group's letter; a spectator and a screen read both, the
// winner's first. A withdrawn game has one letter for everyone. `side` is the group the viewer
// plays for, if any. `busy` holds "Play again" while a press of it is on its way, and `compact`
// makes the letters smaller for a big screen, where they sit above the board.
const props = withDefaults(
  defineProps<{ game: KeywordsView; side: Team | null; isChair: boolean; busy?: boolean; compact?: boolean }>(),
  { busy: false, compact: false },
);
const emit = defineEmits<{ again: [] }>();
const { t } = useI18n();

const group = (team: Team) => t(`lobby.group.${team}`);

const letters = computed(() => {
  const { result, remaining, gameId } = props.game;
  if (!result) return [];
  if (result.reason === 'withdrawn' || result.winner === null) {
    const number = letterNumber(gameId, null, 'withdrawn');
    return [{ team: null, verdict: 'withdrawn', body: t(`game.letter.bodies.withdrawn.${number}`) }];
  }
  const { winner } = result;
  const teams = props.side ? [props.side] : [winner, otherTeam(winner)];
  return teams.map((team) => {
    const verdict = verdictFor(result, remaining, team);
    const other = otherTeam(team);
    const body = t(`game.letter.bodies.${lettersFor(verdict, result)}.${letterNumber(gameId, team, verdict)}`, {
      group: group(team),
      other: group(other),
      left: remaining[other],
    });
    return { team, verdict, body };
  });
});
</script>

<template>
  <section class="decision" :class="{ compact }">
    <div class="letters" :class="{ both: letters.length > 1 }">
      <article v-for="letter in letters" :key="letter.team ?? 'all'" class="letter" :class="letter.team ?? 'withdrawn'">
        <p class="kicker">
          {{ letter.team ? t('game.letter.titleFor', { group: group(letter.team) }) : t('game.letter.title') }}
        </p>
        <h2 class="verdict">{{ t(`game.letter.verdicts.${letter.verdict}`) }}</h2>
        <p class="body">{{ letter.body }}</p>
        <p class="signature">{{ t('game.letter.signature') }}</p>
      </article>
    </div>
    <UiButton v-if="isChair" variant="primary" :disabled="busy" @click="emit('again')">
      {{ t('game.letter.again') }}
    </UiButton>
    <p v-else class="wait">{{ t('game.letter.waitAgain') }}</p>
  </section>
</template>

<style scoped>
.decision {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  margin: var(--space-4) 0;
}

.letters {
  display: grid;
  gap: var(--space-3);
  width: 100%;
}

.letter {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px solid var(--ink);
  border-radius: var(--radius-card);
}

.letter.red {
  border-left: 4px solid var(--red);
}

.letter.blue {
  border-left: 4px solid var(--blue);
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

.compact .letter {
  gap: var(--space-1);
  padding: var(--space-3);
}

.compact .verdict {
  font-size: var(--text-2xl);
}

.compact .body {
  font-size: var(--text-md);
}

@media (min-width: 48rem) {
  .letters.both {
    grid-template-columns: 1fr 1fr;
  }
}
</style>

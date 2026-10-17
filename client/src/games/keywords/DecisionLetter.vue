<script setup lang="ts">
import { otherTeam, type KeywordsView, type MatchView, type Team } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import TitleInfo from '../../core/components/TitleInfo.vue';
import UiButton from '../../core/components/UiButton.vue';
import { letterNumber, lettersFor, verdictFor } from './letters';

// The result, written as each group's decision letter from a conference that doesn't exist
// (letters.ts). A player reads their own group's letter; a spectator and a screen read both, the
// winner's first. A withdrawn game has one letter for everyone. `side` is the group the viewer
// plays for, if any. `busy` holds "Play again" while a press of it is on its way, and `compact`
// makes the letters smaller for a big screen, where they sit above the board. In a match, "Play
// again" is the way to its next game, and a match that is over has none: its ranking, below the
// letters, says what comes next. A tap on the decision says what it means (TitleInfo.vue), except
// on a big screen, which nobody taps.
const props = withDefaults(
  defineProps<{
    game: KeywordsView;
    side: Team | null;
    isChair: boolean;
    busy?: boolean;
    compact?: boolean;
    match?: MatchView | null;
  }>(),
  { busy: false, compact: false, match: null },
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
        <h2 class="verdict">
          <TitleInfo :title="{ kind: 'verdict', verdict: letter.verdict }" :still="compact" :class="letter.team" />
        </h2>
        <p class="body">{{ letter.body }}</p>
        <p class="signature">{{ t('game.letter.signature') }}</p>
      </article>
    </div>
    <template v-if="!match">
      <UiButton v-if="isChair" variant="primary" :disabled="busy" @click="emit('again')">
        {{ t('game.letter.again') }}
      </UiButton>
      <p v-else class="wait">{{ t('game.letter.waitAgain') }}</p>
    </template>
    <template v-else-if="match.status === 'on'">
      <UiButton v-if="isChair" variant="primary" :disabled="busy" @click="emit('again')">
        {{ t('match.next') }}
      </UiButton>
      <p v-else class="wait">{{ t('match.waitNext') }}</p>
    </template>
  </section>
</template>

<style scoped>
.decision {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  margin: var(--space-3) 0;
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
  padding: var(--space-5) var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

.kicker {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--paper-2);
  font-size: var(--text-xs);
}

.red .kicker {
  background: var(--red-tint);
  color: var(--red-deep);
}

.blue .kicker {
  background: var(--blue-tint);
  color: var(--blue-deep);
}

.verdict {
  font-size: var(--text-3xl);
}

.red .verdict {
  color: var(--red-deep);
}

.blue .verdict {
  color: var(--blue-deep);
}

.withdrawn .verdict {
  color: var(--ink-2);
}

.body {
  max-width: 34rem;
  font-size: var(--text-lg);
  line-height: 1.6;
}

.signature {
  align-self: flex-end;
  font-weight: var(--weight-bold);
}

.wait {
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.compact .letter {
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
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

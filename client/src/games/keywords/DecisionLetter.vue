<script setup lang="ts">
import { type MatchView } from '@reviewer2/shared';
import { otherTeam, type KeywordsView, type Team } from '@reviewer2/shared/keywords';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ResultLetter, { type Letter } from '../../core/components/ResultLetter.vue';
import TitleInfo from '../../core/components/TitleInfo.vue';
import { letterNumber, lettersFor, verdictFor } from './letters';

// The result, written as each group's decision letter from a conference that doesn't exist
// (letters.ts), on the letters that every game ends with (ResultLetter.vue). A player reads their
// own group's letter; a spectator and a screen read both, the winner's first. A withdrawn game has
// one letter for everyone. `side` is the group the viewer plays for, if any. A tap on the decision
// says what it means (TitleInfo.vue), except on a big screen, which nobody taps (`compact`).
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

const group = (team: Team) => t(`games.keywords.groups.${team}`);

const letters = computed<(Letter & { verdict: string })[]>(() => {
  const { result, remaining, gameId } = props.game;
  if (!result) return [];
  if (result.reason === 'withdrawn' || result.winner === null) {
    const number = letterNumber(gameId, null, 'withdrawn');
    return [
      {
        key: 'all',
        kicker: t('games.keywords.letter.title'),
        tint: null,
        grey: true,
        verdict: 'withdrawn',
        body: t(`games.keywords.letter.bodies.withdrawn.${number}`),
      },
    ];
  }
  const { winner } = result;
  const teams = props.side ? [props.side] : [winner, otherTeam(winner)];
  return teams.map((team) => {
    const verdict = verdictFor(result, remaining, team);
    const other = otherTeam(team);
    const body = t(
      `games.keywords.letter.bodies.${lettersFor(verdict, result)}.${letterNumber(gameId, team, verdict)}`,
      {
        group: group(team),
        other: group(other),
        left: remaining[other],
      },
    );
    return {
      key: team,
      kicker: t('games.keywords.letter.titleFor', { group: group(team) }),
      tint: team,
      verdict,
      body,
    };
  });
});
const verdictOf = (letter: Letter) => (letter as Letter & { verdict: string }).verdict;
</script>

<template>
  <ResultLetter
    :letters="letters"
    :signature="t('games.keywords.letter.signature')"
    :again="t('games.keywords.letter.again')"
    :wait-again="t('games.keywords.letter.waitAgain')"
    :is-chair="isChair"
    :busy="busy"
    :compact="compact"
    :match="match"
    @again="emit('again')"
  >
    <template #verdict="{ letter }">
      <TitleInfo
        :title="{ kind: 'verdict', game: 'keywords', verdict: verdictOf(letter) }"
        :still="compact"
        :class="letter.tint"
      />
    </template>
  </ResultLetter>
</template>

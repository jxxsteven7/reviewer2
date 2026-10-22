<script setup lang="ts">
import type { MatchView } from '@reviewer2/shared';
import type { ImpostorView } from '@reviewer2/shared/impostor';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ResultLetter, { type Letter } from '../../core/components/ResultLetter.vue';
import { formatList } from '../../core/i18n';

// The hidden word game's result, on the letter that every game ends with (ResultLetter.vue): one
// letter for everyone, since the players play alone, its pill beige and naming the viewer's role,
// if they played. The decision is how the game ended (docs/games/impostor.md#winning), the text who
// had which word and who won; a game that the chair ended early, or that a Reviewer 2 left, came to
// nothing, and its decision is grey.
const props = withDefaults(
  defineProps<{ game: ImpostorView; isChair: boolean; busy?: boolean; compact?: boolean; match?: MatchView | null }>(),
  { busy: false, compact: false, match: null },
);
const emit = defineEmits<{ again: [] }>();
const { t, locale } = useI18n();

const numbers = (role: string) =>
  formatList(
    locale.value,
    props.game.seats
      .filter((seat) => seat.role === role)
      .map((seat) => t('games.impostor.number', { number: seat.number })),
  );

const letter = computed<Letter & { headline: string }>(() => {
  const { result, you, words } = props.game;
  const kicker = you?.role
    ? t('games.impostor.letter.titleFor', { role: t(`games.impostor.roles.${you.role}`) })
    : t('games.impostor.letter.title');
  const reason = result?.reason ?? 'withdrawn';
  const comeback = props.game.guesses.find((guess) => guess.correct);
  const body = t(`games.impostor.letter.bodies.${reason}`, {
    reviewer2: numbers('reviewer2'),
    pi: numbers('pi'),
    word: words?.reviewer2 ?? '',
    student: words?.student ?? '',
    number: comeback ? t('games.impostor.number', { number: comeback.number }) : '',
    role: result?.winner ? t(`games.impostor.roles.${result.winner}`) : '',
  });
  return {
    key: 'all',
    kicker,
    tint: null,
    grey: !result?.winner,
    body,
    headline: t(`games.impostor.letter.results.${reason}`),
  };
});
const headline = (shown: Letter) => (shown as Letter & { headline: string }).headline;
</script>

<template>
  <ResultLetter
    :letters="[letter]"
    :signature="t('games.impostor.letter.signature')"
    :again="t('games.impostor.letter.again')"
    :wait-again="t('games.impostor.letter.waitAgain')"
    :is-chair="isChair"
    :busy="busy"
    :compact="compact"
    :match="match"
    @again="emit('again')"
  >
    <template #verdict="{ letter: shown }">{{ headline(shown) }}</template>
  </ResultLetter>
</template>

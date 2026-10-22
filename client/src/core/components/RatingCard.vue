<script setup lang="ts">
import type { RatingView } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import { act } from '../socket';
import { useBusy } from '../useBusy';
import CloseButton from './CloseButton.vue';
import SendFeedback from './SendFeedback.vue';

// How the game that has just ended was (docs/architecture.md#ratings), on a panel under the
// result, in either game: the question, what is rated, such as the pair of words, if the game names
// it, and the game's options, as choices that turn yellow when chosen and may be changed while the
// room shows the game. The round × dismisses the question, which is kept as no rating and goes
// away. "Say something" opens the usual feedback, with the game attached (SendFeedback.vue).
const props = defineProps<{ gameId: string; rating: RatingView; question: string; rated?: string | null }>();
const { t } = useI18n();
const { busy, run } = useBusy();

const rate = (rating: string | null) => run(() => act('room:rate', { gameId: props.gameId, rating }));
</script>

<template>
  <section class="rating panel" :aria-label="question">
    <header>
      <h2 class="question">{{ question }}</h2>
      <CloseButton :label="t('rating.dismiss')" :disabled="busy" @click="rate(null)" />
    </header>
    <p v-if="rated" class="rated">{{ rated }}</p>
    <div class="options" role="radiogroup" :aria-label="question">
      <label v-for="option in rating.options" :key="option" :class="{ chosen: rating.rating === option }">
        <input
          type="radio"
          class="sr-only"
          :name="`rating-${gameId}`"
          :value="option"
          :checked="rating.rating === option"
          :disabled="busy"
          @change="rate(option)"
        />
        <span>{{ t(`rating.options.${option}`) }}</span>
      </label>
    </div>
    <p class="hint">{{ t('rating.hint') }}</p>
    <SendFeedback page="room" variant="secondary" size="normal" :game-id="gameId">{{ t('rating.say') }}</SendFeedback>
  </section>
</template>

<style scoped>
.rating {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.question {
  font-size: var(--text-xl);
}

.rated {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: var(--weight-display);
  text-align: center;
  overflow-wrap: anywhere;
}

/* The options, two to a row, as choices: an outline, no shadow, yellow when chosen. */
.options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}

.options label {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 var(--space-3);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
  font-weight: var(--weight-black);
  cursor: pointer;
}

.options label.chosen {
  background: var(--bg);
}

.options label:has(input:focus-visible) {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.rating > :deep(.button) {
  width: 100%;
}
</style>

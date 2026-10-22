<script setup lang="ts">
import type { RatingView } from '@reviewer2/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { act } from '../socket';
import { useBusy } from '../useBusy';
import CloseButton from './CloseButton.vue';
import SendFeedback from './SendFeedback.vue';
import UiButton from './UiButton.vue';

// How the game that has just ended was (docs/architecture.md#ratings), on a panel under the
// result, in either game: the question, what is rated, such as the pair of words, if the game names
// it, and the game's options. A tap on one sends it at once, with nothing else to submit, so the
// options are buttons that stay on (`aria-pressed`), the chosen one yellow, rather than radios,
// whose arrow keys would send a rating for every option they pass; it may be changed while the room
// shows the game. Until one is chosen, a grey hint says what the round × does: it dismisses the
// question, which is kept as no rating and goes away. Once one is chosen, a line in ink says it was
// noted, and the × only closes the card on this device, keeping the rating. "Say something" opens
// the usual feedback, with the game attached (SendFeedback.vue).
const props = defineProps<{ gameId: string; rating: RatingView; question: string; rated?: string | null }>();
const { t } = useI18n();
const { busy, run } = useBusy();

const chosen = computed(() => props.rating.rating !== null);
// The game whose card the viewer closed after rating it, so that the next game's card shows.
const closed = ref<string | null>(null);

const rate = (rating: string | null) => run(() => act('room:rate', { gameId: props.gameId, rating }));
const choose = (option: string) => {
  if (props.rating.rating !== option) void rate(option);
};
const close = () => {
  if (chosen.value) closed.value = props.gameId;
  else void rate(null);
};
</script>

<template>
  <section v-if="closed !== gameId" class="rating panel" :aria-label="question">
    <header>
      <h2 class="question">{{ question }}</h2>
      <CloseButton :label="t(chosen ? 'rating.close' : 'rating.dismiss')" :disabled="busy" @click="close" />
    </header>
    <p v-if="rated" class="rated">{{ rated }}</p>
    <div class="options" role="group" :aria-label="question">
      <UiButton
        v-for="option in rating.options"
        :key="option"
        :class="{ chosen: rating.rating === option }"
        :aria-pressed="rating.rating === option"
        :disabled="busy"
        @click="choose(option)"
      >
        {{ t(`rating.options.${option}`) }}
      </UiButton>
    </div>
    <p :class="chosen ? 'noted' : 'hint'" role="status">{{ t(chosen ? 'rating.noted' : 'rating.hint') }}</p>
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

/* The options, two to a row, as secondary buttons, with room between them for the shadows and
   the pills' narrower padding, so that a label wraps only where it must; the chosen one is yellow. */
.options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

.options .button {
  padding: 0 var(--space-3);
}

.options .button.chosen:not(:disabled) {
  background: var(--bg);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

/* Once a rating is chosen, the hint gives way to a line in ink, small and bold, that says so. */
.noted {
  color: var(--ink);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.rating > :deep(.button) {
  width: 100%;
}
</style>

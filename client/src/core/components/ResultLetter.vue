<script setup lang="ts">
import type { MatchView } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import type { Tint } from '../tints';
import UiButton from './UiButton.vue';

// The result of a game, in every game, as a decision letter (docs/rules/display.md#a-games-room):
// a panel for each letter, with a pill that says whom it is for, in the tint of their side if the
// game has one, the decision in the display font, which the game puts in the `verdict` slot, the
// text and the signature; the decision of a game that came to nothing is grey. Under the letters,
// the chair's main button for what comes next, "Play again" (`again`), and for everyone else a grey
// line saying that the chair decides (`waitAgain`). In a match, the button leads to its next game,
// and a match that is over has none: its ranking, below the letters, says what comes next. `busy`
// holds the button while a press of it is on its way, and `compact` makes the letters smaller for a
// big screen, where they sit above the board, and for the tutorial.
export interface Letter {
  key: string;
  kicker: string;
  tint: Tint | null;
  grey?: boolean;
  body: string;
}
withDefaults(
  defineProps<{
    letters: Letter[];
    signature: string;
    again: string;
    waitAgain: string;
    isChair: boolean;
    busy?: boolean;
    compact?: boolean;
    match?: MatchView | null;
  }>(),
  { busy: false, compact: false, match: null },
);
const emit = defineEmits<{ again: [] }>();
const { t } = useI18n();
</script>

<template>
  <section class="decision" :class="{ compact }">
    <div class="letters" :class="{ both: letters.length > 1 }">
      <article v-for="letter in letters" :key="letter.key" class="letter" :class="[letter.tint, { grey: letter.grey }]">
        <p class="kicker">{{ letter.kicker }}</p>
        <h2 class="verdict"><slot name="verdict" :letter="letter" /></h2>
        <p class="body">{{ letter.body }}</p>
        <p class="signature">{{ signature }}</p>
      </article>
    </div>
    <template v-if="!match">
      <UiButton v-if="isChair" variant="primary" :disabled="busy" @click="emit('again')">{{ again }}</UiButton>
      <p v-else class="wait">{{ waitAgain }}</p>
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

.grey .verdict {
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

<script setup lang="ts">
import { checkClue, MAX_CLUE_NUMBER, type ClueCount, type KeywordsView } from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../core/components/UiButton.vue';
import { errorKey } from '../../core/errors';

// The PI's clue: one word and a number. The same check that the server runs shows problems
// while the PI types, and warns about words that may be forms of a word on the board.
const props = defineProps<{ game: KeywordsView }>();
const emit = defineEmits<{ give: [word: string, count: ClueCount] }>();
const { t, locale } = useI18n();

const word = ref('');
const count = ref<ClueCount>(1);
const INFINITY = '\u221e';
const counts: ClueCount[] = [...Array.from({ length: MAX_CLUE_NUMBER + 1 }, (_, i) => i), 'unlimited'];

watch(
  () => props.game.turn,
  () => {
    word.value = '';
    count.value = 1;
  },
);

const check = computed(() => checkClue(word.value, props.game.cards));
const problem = computed(() =>
  check.value.problem && check.value.problem !== 'clue_empty' ? t(errorKey(check.value.problem)) : '',
);
const warning = computed(() => {
  if (check.value.problem || check.value.similar.length === 0) return '';
  const words = check.value.similar.map((index) => `\u201c${props.game.cards[index]?.word}\u201d`);
  const list =
    typeof Intl.ListFormat === 'function'
      ? new Intl.ListFormat(locale.value, { type: 'conjunction' }).format(words)
      : words.join(', ');
  return t('game.similar', { words: list });
});

function give() {
  if (check.value.problem) return;
  emit('give', word.value.trim(), count.value);
}
</script>

<template>
  <form class="clue-panel" @submit.prevent="give">
    <label class="label" for="clue-word">{{ t('game.clueInput') }}</label>
    <input
      id="clue-word"
      v-model="word"
      class="word"
      maxlength="24"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      enterkeyhint="send"
      :aria-invalid="problem ? 'true' : undefined"
    />
    <p v-if="problem" class="problem">{{ problem }}</p>
    <p v-else-if="warning" class="warning">{{ warning }}</p>
    <p class="label">{{ t('game.clueNumber') }}</p>
    <div class="counts" role="radiogroup" :aria-label="t('game.clueNumber')">
      <button
        v-for="option in counts"
        :key="String(option)"
        type="button"
        role="radio"
        class="count mono"
        :class="{ chosen: count === option }"
        :aria-checked="count === option"
        :aria-label="option === 'unlimited' ? t('game.unlimited') : String(option)"
        @click="count = option"
      >
        {{ option === 'unlimited' ? INFINITY : option }}
      </button>
    </div>
    <UiButton variant="primary" type="submit" :disabled="check.problem !== null">{{ t('game.sendClue') }}</UiButton>
  </form>
</template>

<style scoped>
.clue-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.label {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.word {
  min-height: 44px;
  padding: 0 var(--space-3);
  border: 1px solid var(--ink);
  border-radius: var(--radius-control);
  font-family: var(--font-serif);
  font-size: max(16px, var(--text-lg));
}

.word[aria-invalid='true'] {
  border-color: var(--red);
}

.problem {
  color: var(--red);
  font-size: var(--text-sm);
}

.warning {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.counts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.count {
  flex: 1 1 0;
  min-width: 0;
  max-width: 44px;
  min-height: 40px;
  padding: 0;
  border: 1px solid var(--ink-3);
  border-radius: var(--radius-control);
  background: var(--paper);
  font-size: var(--text-md);
  cursor: pointer;
}

.count.chosen {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--paper);
}

.clue-panel > :deep(button[type='submit']) {
  align-self: flex-start;
  margin-top: var(--space-1);
}
</style>

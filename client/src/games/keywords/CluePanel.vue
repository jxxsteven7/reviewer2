<script setup lang="ts">
import {
  checkClue,
  clueCounts,
  clueOptions,
  MAX_CLUE_INPUT,
  type ClueCount,
  type ClueMatch,
  type ClueMatchKind,
  type KeywordsSettings,
  type KeywordsView,
  type Language,
} from '@reviewer2/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../core/components/UiButton.vue';
import { errorKey } from '../../core/errors';
import { formatList } from '../../core/i18n';

// The PI's clue: a word, or as many words as the room allows, and a number. The same check that
// the server runs shows problems while the PI types, and warns about clues that come close to a
// word on the board. The numbers on offer are the ones that the room's guess rule allows. The
// panel is mounted for one clue: it goes away once the clue is given. `busy` holds the button
// while a clue is on its way.
const props = withDefaults(
  defineProps<{ game: KeywordsView; settings: KeywordsSettings; language: Language; busy?: boolean }>(),
  { busy: false },
);
const emit = defineEmits<{ give: [word: string, count: ClueCount] }>();
const { t, locale } = useI18n();

const word = ref('');
const count = ref<ClueCount>(1);
const INFINITY = '\u221e';
const counts = computed(() => clueCounts(props.settings.guessRule, props.game.remaining[props.game.team]));

const check = computed(() => checkClue(word.value, props.game.cards, clueOptions(props.settings, props.language)));

// A card the clue runs into, named by its word in quotation marks, with the translation after
// it in brackets when that is what the clue matched: the Chinese word for "journal", and then
// "(Journal)", when "journals" is typed in a Chinese room. A form that the word lists give is the
// clue itself, so the card's word is enough.
function nameOf({ card, text, kind }: ClueMatch): string {
  const shown = props.game.cards[card]?.word ?? text;
  return shown === text || kind === 'form' ? `\u201c${shown}\u201d` : `\u201c${shown}\u201d (${text})`;
}

// What the panel says about a card, by the kind of match: for a conflict, which refuses the clue,
// and for a warning. The rest of the kinds say what 'same' and 'similar' say.
const PROBLEMS: Partial<Record<ClueMatchKind, string>> = {
  form: 'game.formOnBoard',
  character: 'game.characterOnBoard',
};
const WARNINGS: Partial<Record<ClueMatchKind, string>> = {
  form: 'game.formWarning',
  character: 'game.characterWarning',
  inside: 'game.insideWarning',
};
const warningOf = (match: ClueMatch) => WARNINGS[match.kind] ?? 'game.similar';

const problem = computed(() => {
  const { problem, conflict } = check.value;
  if (!problem || problem === 'clue_empty') return '';
  // The room's limit on the length of a clue shows below the input all the time.
  return conflict ? t(PROBLEMS[conflict.kind] ?? 'game.onBoard', { word: nameOf(conflict) }) : t(errorKey(problem));
});

// One line for each kind of warning, naming the cards of that kind.
const warnings = computed(() => {
  if (check.value.problem) return [];
  const keys = [...new Set(check.value.similar.map(warningOf))];
  return keys.map((key) => {
    const cards = check.value.similar.filter((match) => warningOf(match) === key);
    return t(key, { words: formatList(locale.value, cards.map(nameOf)) });
  });
});

function give() {
  if (check.value.problem || props.busy) return;
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
      :maxlength="MAX_CLUE_INPUT"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      enterkeyhint="send"
      aria-describedby="clue-limit"
      :aria-invalid="problem ? 'true' : undefined"
    />
    <p v-if="problem" class="problem">{{ problem }}</p>
    <p v-for="warning in warnings" v-else :key="warning" class="warning">{{ warning }}</p>
    <p id="clue-limit" class="limit">{{ t(`game.clueLimit.${language}`, { count: settings.clueLength }) }}</p>
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
    <UiButton variant="primary" type="submit" :disabled="check.problem !== null || busy">{{
      t('game.sendClue')
    }}</UiButton>
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

.limit {
  color: var(--ink-3);
  font-size: var(--text-xs);
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

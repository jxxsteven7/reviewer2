<script setup lang="ts">
import {
  checkClue,
  clueOptions,
  MAX_CLUE_INPUT,
  type ClueCount,
  type ClueMatch,
  type ClueMatchKind,
  type KeywordsSettings,
  type KeywordsView,
  type Language,
  type Team,
} from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../core/components/UiButton.vue';
import { errorKey } from '../../core/errors';
import { formatList } from '../../core/i18n';

// The PI's clue: a word, or as many words as the room allows, and a number. The same check that
// the server runs shows problems while the PI types, and warns about clues that come close to a
// word on the board. The numbers on offer, `counts`, are the ones that the room's guess rule
// allows the PI's group, which the game works out. `busy` holds the button while a clue is on
// its way.
//
// The PI may mark on the board the cards the clue is meant for (`targets`, in the order marked),
// which nobody sees until the game is over (docs/games/keywords.md#the-clue). A line at the top
// asks for them, loud until the PI has marked a card: a sticker in the tint of the PI's group,
// `team`, with a small "Tips" tag at its start, which screen readers skip. Then it is a quiet line
// that counts and names them. Nothing more asks for marks: a clue may go without any. The number
// follows how many are marked, until the PI picks a number themselves.
//
// The word and the number picked are models, so that the game can keep them as a draft while the
// PI prepares the clue ahead of their turn, when `canGive` is false: the panel then says that
// only the PI sees the draft, and holds the button until the turn comes, as the keyboard's enter
// key, which then says "done" rather than "send". `gone` names the marked
// cards that were revealed meanwhile, whose marks the game took away, as it takes back a number
// picked that is no longer on offer.
const props = withDefaults(
  defineProps<{
    game: KeywordsView;
    counts: ClueCount[];
    settings: KeywordsSettings;
    language: Language;
    busy?: boolean;
    targets?: number[];
    canGive?: boolean;
    gone?: string[];
    team?: Team | null;
  }>(),
  { busy: false, targets: () => [], canGive: true, gone: () => [], team: null },
);
const emit = defineEmits<{ give: [word: string, count: ClueCount] }>();
const word = defineModel<string>('word', { default: '' });
// The number the PI picked, or null while it follows the marked cards.
const picked = defineModel<ClueCount | null>('count', { default: null });
const { t, locale } = useI18n();

const DEFAULT_COUNT = 1;
const INFINITY = '\u221e';
const count = computed<ClueCount>(() => {
  if (picked.value !== null) return picked.value;
  const marked = props.targets.length;
  return marked > 0 && props.counts.includes(marked) ? marked : DEFAULT_COUNT;
});
const quoted = (cards: readonly string[]) =>
  formatList(
    locale.value,
    cards.map((card) => t('game.quoted', { word: card })),
  );
const marked = computed(() => quoted(props.targets.map((card) => props.game.cards[card]?.word ?? '')));

const check = computed(() => checkClue(word.value, props.game.cards, clueOptions(props.settings, props.language)));

// A card the clue runs into, named by its word in quotation marks, with the translation after
// it in brackets when that is what the clue matched: the Chinese word for "journal", and then
// "(Journal)", when "journals" is typed in a Chinese room, and the same for a form that the word
// lists give, such as "(Computer vision)" after the card "CV" when "vision" is typed.
function nameOf({ card, text }: ClueMatch): string {
  const shown = props.game.cards[card]?.word ?? text;
  return shown === text ? `\u201c${shown}\u201d` : `\u201c${shown}\u201d (${text})`;
}

// What the panel says about a card, by the kind of match: for a conflict, which refuses the clue,
// and for a warning. The rest of the kinds say what 'same' and 'similar' say.
const PROBLEMS: Partial<Record<ClueMatchKind, string>> = {
  form: 'game.formOnBoard',
  character: 'game.characterOnBoard',
  inside: 'game.insideOnBoard',
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
  if (check.value.problem || props.busy || !props.canGive) return;
  emit('give', word.value.trim(), count.value);
}
</script>

<template>
  <form class="clue-panel" :class="{ draft: !canGive }" @submit.prevent="give">
    <p v-if="!canGive" class="ahead">{{ t('game.prepareNote') }}</p>
    <p class="targets" :class="targets.length === 0 ? ['none', team] : null" aria-live="polite">
      <span v-if="targets.length === 0" class="tips" aria-hidden="true">{{ t('game.tips') }}</span>
      {{
        targets.length === 0
          ? t('game.targetsHint')
          : t('game.targetsMarked', { count: targets.length, words: marked }, targets.length)
      }}
    </p>
    <p v-if="gone.length > 0" class="gone" role="status">
      {{ t('game.targetGone', { words: quoted(gone) }, gone.length) }}
    </p>
    <label class="label" for="clue-word">{{ t('game.clueInput') }}</label>
    <input
      id="clue-word"
      v-model="word"
      class="word"
      :maxlength="MAX_CLUE_INPUT"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      :enterkeyhint="canGive ? 'send' : 'done'"
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
        class="count num"
        :class="{ chosen: count === option }"
        :aria-checked="count === option"
        :aria-label="option === 'unlimited' ? t('game.unlimited') : String(option)"
        @click="picked = option"
      >
        {{ option === 'unlimited' ? INFINITY : option }}
      </button>
    </div>
    <UiButton variant="primary" type="submit" :disabled="check.problem !== null || busy || !canGive">{{
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
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

/* The line at the top while the PI prepares the clue ahead of their turn: only they see the draft. */
.ahead {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

/* Until a card is marked, the line stands out as a sticker in the tint of the PI's group, with a
   small outlined "Tips" tag, which is for the eye alone and looks like no count of anything; then it
   is a quiet line that names the cards. */
.targets {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

/* A marked card that was revealed meanwhile: the mark went, and this says so. */
.gone {
  color: var(--ink);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.targets.none {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-card);
  background: var(--paper);
  box-shadow: var(--shadow-2);
  color: var(--ink);
  font-weight: var(--weight-bold);
}

.targets.none.red {
  background: var(--red-tint);
}

.targets.none.blue {
  background: var(--blue-tint);
}

.tips {
  flex: none;
  padding: 0 var(--space-2);
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-number);
  font-size: var(--text-xs);
  font-weight: var(--weight-black);
  line-height: 1.6;
}

.word {
  min-height: 50px;
  padding: 0 var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--paper);
  color: var(--ink);
  font: inherit;
  font-size: max(16px, var(--text-lg));
  font-weight: var(--weight-black);
}

.word:focus-visible {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.word[aria-invalid='true'] {
  border-color: var(--red-deep);
}

.problem {
  color: var(--red-deep);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.warning {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.limit {
  color: var(--ink-2);
  font-size: var(--text-xs);
}

/* The numbers on offer, as round stickers. */
.counts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.count {
  flex: 1 1 0;
  min-width: 0;
  max-width: 48px;
  min-height: 44px;
  padding: 0;
  border: var(--line) solid var(--ink);
  border-radius: 50%;
  background: var(--paper);
  box-shadow: var(--shadow-1);
  color: var(--ink);
  font-size: var(--text-lg);
  font-weight: var(--weight-display);
  cursor: pointer;
  transition:
    transform var(--motion),
    box-shadow var(--motion);
}

.count:active,
.count.chosen {
  transform: translate(var(--shift-1), var(--shift-1));
  box-shadow: none;
}

.count.chosen {
  background: var(--ink);
  color: var(--on-ink);
}

.clue-panel > :deep(button[type='submit']) {
  align-self: flex-start;
  margin-top: var(--space-1);
}
</style>

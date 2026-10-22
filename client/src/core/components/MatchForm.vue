<script setup lang="ts">
import { MATCH_GAMES, matchGamesValid, type MatchRules } from '@reviewer2/shared';
import { computed, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { games } from '../../games';
import UiField from './UiField.vue';

// The rules of a match of a game, for the room setup and for the chair's next match: how many
// games, and the game's own options, in the game's form (GameScreens.match), such as whether the
// first game's groups stay the same. A game that takes only a few numbers of games, as the second
// game's 3, 5 or 7, offers them as pills to pick; otherwise the number is typed, so it can be wrong
// while it is being typed: the form says so, and `valid` says whether the rules can be sent. The
// server checks them again.
const props = defineProps<{ game: string }>();
const model = defineModel<MatchRules>({ required: true });
const valid = defineModel<boolean>('valid', { default: true });
const { t } = useI18n();
const id = useId();
const Options = computed(() => games[props.game]?.match?.Options);
const choices = computed(() => games[props.game]?.match?.choices ?? null);

// A whole number as it is typed, full-width digits from a Chinese keyboard included, or NaN.
function parse(text: string): number {
  const plain = text.normalize('NFKC').trim();
  return /^\d{1,3}$/.test(plain) ? Number(plain) : Number.NaN;
}

const typed = ref(String(model.value.games));
function type(text: string) {
  typed.value = text;
  model.value = { ...model.value, games: parse(text) };
}
watch(model, (rules) => {
  if (!Object.is(parse(typed.value), rules.games)) typed.value = String(rules.games);
});

const gamesValid = computed(() =>
  choices.value ? choices.value.includes(model.value.games) : matchGamesValid(model.value.games),
);
watch(gamesValid, (ok) => (valid.value = ok), { immediate: true });

const options = computed({
  get: () => model.value.options,
  set: (changed: unknown) => (model.value = { ...model.value, options: changed }),
});
</script>

<template>
  <div class="match-form">
    <fieldset v-if="choices">
      <legend>{{ t('match.games') }}</legend>
      <div class="options">
        <label v-for="count in choices" :key="count" :class="{ chosen: model.games === count }">
          <input
            type="radio"
            :name="`${id}-games`"
            :value="count"
            :checked="model.games === count"
            @change="model = { ...model, games: count }"
          />
          {{ t('match.gamesChoice', { count }) }}
        </label>
      </div>
    </fieldset>
    <div v-else class="number">
      <UiField
        :model-value="typed"
        :label="t('match.games')"
        :hint="t('match.gamesRange', MATCH_GAMES)"
        :error="gamesValid ? undefined : t('match.gamesProblem', MATCH_GAMES)"
        inputmode="numeric"
        :maxlength="3"
        @update:model-value="type"
      />
    </div>
    <component :is="Options" v-if="Options" v-model="options" />
  </div>
</template>

<style scoped>
.match-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.number {
  max-width: 16rem;
}

/* The numbers of games to pick, as pills, as the first game's options are (MatchOptions.vue). */
fieldset {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

legend {
  margin-bottom: var(--space-2);
  padding: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.options label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: 0 var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
  font-weight: var(--weight-bold);
  cursor: pointer;
}

.options label.chosen {
  background: var(--bg);
}

.options label:focus-within {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.options input {
  margin: 0;
  accent-color: var(--ink);
}
</style>

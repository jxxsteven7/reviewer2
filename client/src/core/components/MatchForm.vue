<script setup lang="ts">
import { MATCH_GAMES, MATCH_GROUPINGS, MATCH_TEAMS, matchGamesValid, type MatchRules } from '@reviewer2/shared';
import { computed, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import UiField from './UiField.vue';

// The rules of a match, for the room setup and for the chair's next match: how many games, whether
// the groups stay the same, and how they are made, for the first game or after every game. The
// number is typed, so it can be wrong while it is being typed: the form says so, and `valid` says
// whether the rules can be sent. The server checks them again.
const model = defineModel<MatchRules>({ required: true });
const valid = defineModel<boolean>('valid', { default: true });
const { t } = useI18n();
const id = useId();

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

const gamesValid = computed(() => matchGamesValid(model.value.games));
watch(gamesValid, (ok) => (valid.value = ok), { immediate: true });

const choose = (changes: Partial<MatchRules>) => (model.value = { ...model.value, ...changes });
</script>

<template>
  <div class="match-form">
    <div class="number">
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

    <fieldset>
      <legend>{{ t('match.teams') }}</legend>
      <div class="options">
        <label v-for="teams in MATCH_TEAMS" :key="teams" :class="{ chosen: model.teams === teams }">
          <input
            type="radio"
            :name="`${id}-teams`"
            :value="teams"
            :checked="model.teams === teams"
            @change="choose({ teams })"
          />
          {{ t(`match.teamsChoice.${teams}`) }}
        </label>
      </div>
      <p class="hint">{{ t(`match.teamsHint.${model.teams}`) }}</p>
    </fieldset>

    <fieldset>
      <legend>{{ t(`match.grouping.${model.teams}`) }}</legend>
      <div class="options">
        <label v-for="grouping in MATCH_GROUPINGS" :key="grouping" :class="{ chosen: model.grouping === grouping }">
          <input
            type="radio"
            :name="`${id}-grouping`"
            :value="grouping"
            :checked="model.grouping === grouping"
            @change="choose({ grouping })"
          />
          {{ t(`match.groupingChoice.${grouping}`) }}
        </label>
      </div>
      <p class="hint">{{ t(`match.groupingHint.${model.grouping}`) }}</p>
    </fieldset>
  </div>
</template>

<style scoped>
.match-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

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
  color: var(--ink-2);
  font-size: var(--text-sm);
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
  padding: 0 var(--space-3);
  border: 1px solid var(--ink-3);
  border-radius: var(--radius-control);
  cursor: pointer;
}

.options label.chosen {
  border-color: var(--ink);
  box-shadow: inset 0 0 0 1px var(--ink);
}

.options label:focus-within {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.options input {
  accent-color: var(--ink);
}

.hint {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.number {
  max-width: 16rem;
}
</style>

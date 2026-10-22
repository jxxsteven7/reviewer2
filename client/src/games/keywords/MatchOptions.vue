<script setup lang="ts">
import { MATCH_GROUPINGS, MATCH_TEAMS, type KeywordsMatchOptions } from '@reviewer2/shared/keywords';
import { useId } from 'vue';
import { useI18n } from 'vue-i18n';

// The first game's options for a match (shared/src/games/keywords/match.ts), in the match form
// (MatchForm.vue): whether the groups stay the same, and how they are made, for the first game or
// after every game.
const model = defineModel<KeywordsMatchOptions>({ required: true });
const { t } = useI18n();
const id = useId();

const choose = (changes: Partial<KeywordsMatchOptions>) => (model.value = { ...model.value, ...changes });
</script>

<template>
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
</template>

<style scoped>
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

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>

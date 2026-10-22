<script setup lang="ts">
import { MATCH_GROUPINGS, MATCH_TEAMS, type KeywordsMatchOptions } from '@reviewer2/shared/keywords';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import PillChoice from '../../core/components/PillChoice.vue';

// The first game's options for a match (shared/src/games/keywords/match.ts), in the match form
// (MatchForm.vue): whether the groups stay the same, and how they are made, for the first game or
// after every game, each as pills (PillChoice.vue) with a hint on the choice under them.
const model = defineModel<KeywordsMatchOptions>({ required: true });
const { t } = useI18n();

const teams = computed({
  get: () => model.value.teams,
  set: (teams: KeywordsMatchOptions['teams']) => (model.value = { ...model.value, teams }),
});
const grouping = computed({
  get: () => model.value.grouping,
  set: (grouping: KeywordsMatchOptions['grouping']) => (model.value = { ...model.value, grouping }),
});
const teamChoices = computed(() => MATCH_TEAMS.map((value) => ({ value, label: t(`match.teamsChoice.${value}`) })));
const groupingChoices = computed(() =>
  MATCH_GROUPINGS.map((value) => ({ value, label: t(`match.groupingChoice.${value}`) })),
);
</script>

<template>
  <PillChoice v-model="teams" :legend="t('match.teams')" :options="teamChoices">
    <p class="hint">{{ t(`match.teamsHint.${model.teams}`) }}</p>
  </PillChoice>
  <PillChoice v-model="grouping" :legend="t(`match.grouping.${model.teams}`)" :options="groupingChoices">
    <p class="hint">{{ t(`match.groupingHint.${model.grouping}`) }}</p>
  </PillChoice>
</template>

<style scoped>
.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>

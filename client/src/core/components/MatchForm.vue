<script setup lang="ts">
import { MATCH_GAMES, matchGamesValid, type MatchRules } from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { games } from '../../games';
import UiField from './UiField.vue';

// The rules of a match of a game, for the room setup and for the chair's next match: how many
// games, and the game's own options, in the game's form (GameScreens.match), such as whether the
// first game's groups stay the same. The number is typed, so it can be wrong while it is being
// typed: the form says so, and `valid` says whether the rules can be sent. The server checks them
// again.
const props = defineProps<{ game: string }>();
const model = defineModel<MatchRules>({ required: true });
const valid = defineModel<boolean>('valid', { default: true });
const { t } = useI18n();
const Options = computed(() => games[props.game]?.match?.Options);

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

const options = computed({
  get: () => model.value.options,
  set: (changed: unknown) => (model.value = { ...model.value, options: changed }),
});
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
</style>

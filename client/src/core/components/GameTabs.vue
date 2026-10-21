<script setup lang="ts">
import { useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { games } from '../../games';
import { GAME_INFO } from '../../games/info';

// The tabs of a record, one for each game, in the games' order, with no tab for all of them: the
// records of two games are never added up (docs/architecture.md#game-records). Each is a pill to
// pick, which turns yellow when chosen, as every choice does (docs/rules/display.md).
const model = defineModel<string>({ required: true });
const { t } = useI18n();
const name = useId();
const shown = GAME_INFO.filter((info) => games[info.id] !== undefined);
</script>

<template>
  <div class="game-tabs" role="radiogroup" :aria-label="t('account.profile.gameTabs')">
    <label v-for="info in shown" :key="info.id">
      <input v-model="model" type="radio" class="sr-only" :name="name" :value="info.id" />
      <span>{{ t(`games.${info.id}.name`) }}</span>
    </label>
  </div>
</template>

<style scoped>
.game-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

label {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
  font-weight: var(--weight-black);
  cursor: pointer;
}

label:has(input:checked) {
  background: var(--bg);
}

label:has(input:focus-visible) {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}
</style>

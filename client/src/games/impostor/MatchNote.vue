<script setup lang="ts">
import { useI18n } from 'vue-i18n';

// The second game has no options of its own for a match, only a line in the match form
// (MatchForm.vue) on what a match of it keeps the same and what it deals anew.
defineModel<unknown>();
const { t } = useI18n();
</script>

<template>
  <p class="hint">{{ t('games.impostor.match.note') }}</p>
</template>

<style scoped>
.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>

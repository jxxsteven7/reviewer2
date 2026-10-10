<script setup lang="ts">
import { TIME_SETTINGS, type KeywordsSettings, type Language } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';

// The settings of a room, for everyone to read: in the waiting room for all but the chair, who
// changes them at the desk, and in the rules during a game.
defineProps<{ settings: KeywordsSettings; language: Language }>();
const { t } = useI18n();

const time = (seconds: number) => (seconds === 0 ? t('settings.noLimit') : t('settings.seconds', { count: seconds }));
</script>

<template>
  <dl class="settings-summary">
    <dt>{{ t('settings.guessRule') }}</dt>
    <dd>{{ t(`settings.guess.${settings.guessRule}`) }}</dd>
    <dt>{{ t('settings.clueRule') }}</dt>
    <dd>{{ t(`settings.clue.${settings.clueRule}`) }}</dd>
    <dt>{{ t(`settings.clueLength.${language}`) }}</dt>
    <dd>{{ t('settings.upTo', { count: settings.clueLength }) }}</dd>
    <template v-for="key in TIME_SETTINGS" :key="key">
      <dt>{{ t(`settings.${key}`) }}</dt>
      <dd>{{ time(settings[key]) }}</dd>
    </template>
  </dl>
</template>

<style scoped>
.settings-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2) var(--space-4);
  margin: 0;
  font-size: var(--text-sm);
}

dt {
  color: var(--ink-2);
  font-weight: var(--weight-bold);
}

dd {
  margin: 0;
  font-weight: var(--weight-black);
  text-align: right;
}
</style>

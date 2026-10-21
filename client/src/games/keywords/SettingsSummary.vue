<script setup lang="ts">
import { type Language } from '@reviewer2/shared';
import { TIME_SETTINGS, type KeywordsSettings } from '@reviewer2/shared/keywords';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import SummaryList from '../../core/components/SummaryList.vue';

// The settings of a room, for everyone to read (SummaryList.vue): in the waiting room for all but
// the chair, who changes them at the desk, and in the rules during a game. The chair's own words
// are counted, never shown: nobody knows them before they are on the board.
const props = withDefaults(defineProps<{ settings: KeywordsSettings; language: Language; customWords?: number }>(), {
  customWords: 0,
});
const { t } = useI18n();

const time = (seconds: number) => (seconds === 0 ? t('settings.noLimit') : t('settings.seconds', { count: seconds }));
const rows = computed(() => {
  const { settings, customWords } = props;
  return [
    { key: 'guess-rule', label: t('settings.guessRule'), value: t(`settings.guess.${settings.guessRule}`) },
    { key: 'clue-rule', label: t('settings.clueRule'), value: t(`settings.clue.${settings.clueRule}`) },
    {
      key: 'clue-length',
      label: t(`settings.clueLength.${props.language}`),
      value: t('settings.upTo', { count: settings.clueLength }),
    },
    ...TIME_SETTINGS.map((key) => ({ key, label: t(`settings.${key}`), value: time(settings[key]) })),
    {
      key: 'extensions',
      label: t('settings.extensions'),
      value: t(`settings.extension.${settings.extensions ? 'on' : 'off'}`),
    },
    {
      key: 'custom-words',
      label: t('settings.customWords'),
      value:
        customWords > 0
          ? t('settings.customWordsCount', { count: customWords }, customWords)
          : t('settings.customWordsNone'),
    },
  ];
});
</script>

<template>
  <SummaryList :rows="rows" />
</template>

<script setup lang="ts">
import type { Language } from '@reviewer2/shared';
import type { ImpostorSettings } from '@reviewer2/shared/impostor';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import SummaryList from '../../core/components/SummaryList.vue';

// The settings of a room of the hidden word game, for everyone to read (SummaryList.vue): where the
// words come from, the seats shown by number, the PI, the guess after being voted out, the god
// view, the time limits and how long a description may be.
const props = defineProps<{ settings: ImpostorSettings; language: Language }>();
const { t } = useI18n();

const time = (seconds: number) => (seconds === 0 ? t('settings.noLimit') : t('settings.seconds', { count: seconds }));
const onOff = (on: boolean) => t(`games.impostor.settings.${on ? 'on' : 'off'}`);
const rows = computed(() => {
  const { settings } = props;
  return [
    {
      key: 'source',
      label: t('games.impostor.source.title'),
      value: t(`games.impostor.source.${settings.setter ? 'setter' : 'library'}`),
    },
    { key: 'anonymous', label: t('games.impostor.settings.anonymous'), value: onOff(settings.anonymous) },
    { key: 'pi', label: t('games.impostor.settings.pi'), value: onOff(settings.pi) },
    { key: 'comeback', label: t('games.impostor.settings.comeback'), value: onOff(settings.comeback) },
    { key: 'god-view', label: t('games.impostor.settings.godView'), value: onOff(settings.godView) },
    { key: 'describe-time', label: t('games.impostor.settings.describeTime'), value: time(settings.describeTime) },
    { key: 'vote-time', label: t('games.impostor.settings.voteTime'), value: time(settings.voteTime) },
    {
      key: 'length',
      label: t(`games.impostor.settings.length.${props.language}`),
      value: t('settings.upTo', { count: settings.length }),
    },
  ];
});
</script>

<template>
  <SummaryList :rows="rows" />
</template>

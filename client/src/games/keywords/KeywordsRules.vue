<script setup lang="ts">
import type { Language } from '@reviewer2/shared';
import type { KeywordsSettings } from '@reviewer2/shared/keywords';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import RulesSheet from '../../core/components/RulesSheet.vue';
import { rulesSections } from './rules';
import SettingsSummary from './SettingsSummary.vue';

// The first game's "How to play" (RulesSheet.vue): its settings, its rules in their own sections
// (rules.ts), as this room plays them, and the way to the tutorial.
const props = withDefaults(
  defineProps<{
    settings: KeywordsSettings;
    language: Language;
    customWords?: number;
    link?: boolean;
    defaults?: boolean;
  }>(),
  { customWords: 0, link: false, defaults: false },
);
const { t } = useI18n();
const sections = computed(() => rulesSections(t, props.settings, props.language));
</script>

<template>
  <RulesSheet :sections="sections" :link="link" :defaults="defaults" guide>
    <SettingsSummary :settings="settings" :language="language" :custom-words="customWords" />
  </RulesSheet>
</template>

<script setup lang="ts">
import type { Language } from '@reviewer2/shared';
import type { ImpostorSettings } from '@reviewer2/shared/impostor';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import RulesSheet from '../../core/components/RulesSheet.vue';
import { rulesSections } from './rules';
import SettingsSummary from './SettingsSummary.vue';

// The hidden word game's "How to play" (RulesSheet.vue): its settings, then its rules in their own
// sections (rules.ts), as this room plays them. The game has no tutorial yet.
const props = withDefaults(
  defineProps<{ settings: ImpostorSettings; language: Language; link?: boolean; defaults?: boolean }>(),
  { link: false, defaults: false },
);
const { t } = useI18n();
const sections = computed(() => rulesSections(t, props.settings, props.language));
</script>

<template>
  <RulesSheet :sections="sections" :link="link" :defaults="defaults">
    <SettingsSummary :settings="settings" :language="language" />
  </RulesSheet>
</template>

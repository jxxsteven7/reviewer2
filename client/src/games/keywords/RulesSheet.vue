<script setup lang="ts">
import { TIME_SETTINGS, type KeywordsSettings, type Language } from '@reviewer2/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../core/components/UiButton.vue';
import UiSheet from '../../core/components/UiSheet.vue';
import SettingsSummary from './SettingsSummary.vue';

// "How to play", in the rules' own sections, as this room plays them: its guess rule, its clue
// rule and its time limits, with all of its settings at the top.
const props = defineProps<{ settings: KeywordsSettings; language: Language }>();
const { t } = useI18n();
const open = ref(false);

const timed = computed(() => TIME_SETTINGS.some((key) => props.settings[key] > 0));
const sections = computed(() => [
  { title: t('rules.goalTitle'), text: [t('rules.goal')] },
  { title: t('rules.rolesTitle'), text: [t('rules.roles')] },
  { title: t('rules.turnTitle'), text: [t(`rules.turn.${props.settings.guessRule}`)] },
  { title: t('rules.revealTitle'), text: [t('rules.reveal')] },
  {
    title: t('rules.clueTitle'),
    text: [
      t(`rules.clue.${props.language}`, { count: props.settings.clueLength }, props.settings.clueLength),
      t('rules.clueCommon'),
      t(`rules.clueRule.${props.settings.clueRule}`),
    ],
  },
  { title: t('rules.timeTitle'), text: [timed.value ? t('rules.time') : t('rules.noTime')] },
  { title: t('rules.endTitle'), text: [t('rules.end')] },
]);
</script>

<template>
  <UiButton variant="quiet" size="small" @click="open = true">{{ t('rules.title') }}</UiButton>
  <UiSheet :open="open" :title="t('rules.title')" @close="open = false">
    <div class="rules sections">
      <section>
        <h3 class="section-title">{{ t('settings.title') }}</h3>
        <SettingsSummary class="summary" :settings="settings" :language="language" />
      </section>
      <section v-for="section in sections" :key="section.title">
        <h3 class="section-title">{{ section.title }}</h3>
        <p v-for="line in section.text" :key="line">{{ line }}</p>
      </section>
    </div>
  </UiSheet>
</template>

<style scoped>
.rules {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.rules .section-title {
  font-size: var(--text-md);
}

.rules p {
  margin-top: var(--space-1);
  color: var(--ink-2);
}

.summary {
  margin-top: var(--space-2);
}
</style>

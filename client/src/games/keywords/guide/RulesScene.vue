<script setup lang="ts">
import { type Language } from '@reviewer2/shared';
import { defaultSettings } from '@reviewer2/shared/keywords';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { rulesSections } from '../rules';

// A step of "The rules in brief": the section of "How to play" (rules.ts) that the step sums up, as
// a new room in the page's language plays the game.
const props = defineProps<{ chapter: string; step: number }>();
const { t, locale } = useI18n();
const section = computed(() => {
  const language = locale.value as Language;
  return rulesSections(t, defaultSettings(language), language)[props.step - 1] ?? null;
});
</script>

<template>
  <section v-if="section" class="rules-scene">
    <h3 class="section-title">{{ section.title }}</h3>
    <p v-for="line in section.text" :key="line">{{ line }}</p>
  </section>
</template>

<style scoped>
.rules-scene {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

.section-title {
  font-size: var(--text-lg);
}

p {
  line-height: 1.55;
}
</style>

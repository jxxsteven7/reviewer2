<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../core/components/UiButton.vue';
import UiSheet from '../../core/components/UiSheet.vue';

// "How to play", in the rules' own sections.
const { t } = useI18n();
const open = ref(false);
const sections = ['goal', 'roles', 'turn', 'reveal', 'clue', 'end'];
</script>

<template>
  <UiButton variant="quiet" size="small" @click="open = true">{{ t('rules.title') }}</UiButton>
  <UiSheet :open="open" :title="t('rules.title')" @close="open = false">
    <div class="rules sections">
      <section v-for="section in sections" :key="section">
        <h3 class="section-title">{{ t(`rules.${section}Title`) }}</h3>
        <p>{{ t(`rules.${section}`) }}</p>
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
</style>

<script setup lang="ts">
import { FEEDBACK_KINDS } from '@reviewer2/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import PlayerAvatar from '../../components/PlayerAvatar.vue';
import { useSpot, type SpotTarget } from '../spot';
import ScenePart from './ScenePart.vue';

// A step of "Giving feedback": the kinds that the feedback panel offers, and an invented entry of the
// contributions on the home page, one of Mira's. Only to look at.
const props = defineProps<{ chapter: string; step: number }>();
const { t } = useI18n();
const me = computed(() => t('guide.demo.me'));

const SPOTS: Record<number, SpotTarget> = {
  1: { selector: '.kinds .choice', finger: 'point' },
  2: { selector: '.entry', finger: 'point' },
};
const root = ref<HTMLElement | null>(null);
useSpot(root, () => SPOTS[props.step] ?? null);
</script>

<template>
  <div ref="root" class="feedback-scene" inert>
    <ScenePart v-if="step === 1" :title="t('feedback.title')">
      <fieldset class="kinds">
        <legend>{{ t('feedback.kind') }}</legend>
        <label v-for="option in FEEDBACK_KINDS" :key="option" class="choice">
          <input type="radio" name="guide-kind" :checked="option === 'idea'" />
          <span>{{ t(`feedback.kinds.${option}`) }}</span>
        </label>
      </fieldset>
      <p class="note">{{ t('feedback.notes.idea') }}</p>
    </ScenePart>

    <ScenePart v-else :title="t('contributions.title')">
      <h3 class="kind">{{ t('contributions.kinds.idea') }}</h3>
      <p class="entry">
        <PlayerAvatar :name="me" />
        <span class="name">{{ me }}</span>
        <span class="what">{{ t('guide.demo.contribution') }}</span>
      </p>
    </ScenePart>
  </div>
</template>

<style scoped>
.kinds {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: 0;
}

.kinds legend {
  margin-bottom: var(--space-2);
  font-weight: var(--weight-bold);
}

/* A kind as the panel draws it, a pill a little smaller than a button. */
.choice {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 40px;
  padding: 0 var(--space-3) 0 var(--space-2);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.choice:has(input:checked) {
  background: var(--bg);
}

.choice input {
  margin: 0;
  accent-color: var(--ink);
}

.note {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.kind {
  font-size: var(--text-md);
}

.entry {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
}

.entry .name {
  font-weight: var(--weight-black);
}

.entry .what {
  flex-basis: 100%;
}
</style>

<script setup lang="ts">
import { type Language } from '@reviewer2/shared';
import { BOARD_SIZE, defaultSettings } from '@reviewer2/shared/keywords';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import FieldFold from '../../../core/components/FieldFold.vue';
import { fields, loadFields } from '../../../core/fields';
import { useSpot, type SpotTarget } from '../../../core/guide/spot';
import SettingsForm from '../SettingsForm.vue';

// A step of "Room settings": the game's form of settings, with the defaults of a room in the page's
// language, and the choice of word lists, as a new room has them. Only to look at.
const props = defineProps<{ chapter: string; step: number }>();
const { locale } = useI18n();
const language = computed(() => locale.value as Language);
const settings = ref(defaultSettings(language.value));
watch(language, (now) => (settings.value = defaultSettings(now)));
const chosen = ref(['general']);
const random = ref(false);
loadFields();

const SPOTS: Record<number, string> = {
  1: '.settings-form fieldset:nth-of-type(1) .options',
  2: '.settings-form fieldset:nth-of-type(2) .options',
  3: '.settings-form .number input',
  4: '.settings-form fieldset:nth-of-type(3) .times',
  5: '.lists',
};
const root = ref<HTMLElement | null>(null);
useSpot(root, (): SpotTarget | null => {
  const selector = SPOTS[props.step];
  return selector ? { selector, finger: 'point' } : null;
});
</script>

<template>
  <div ref="root" class="settings-scene" inert>
    <section v-if="step < 5" class="frame">
      <SettingsForm v-model="settings" :language="language" />
    </section>
    <section v-else class="frame lists">
      <FieldFold
        v-model="chosen"
        v-model:random="random"
        :fields="fields"
        :language="language"
        :needed="BOARD_SIZE"
        each-game
      />
    </section>
  </div>
</template>

<style scoped>
.frame {
  padding: var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}
</style>

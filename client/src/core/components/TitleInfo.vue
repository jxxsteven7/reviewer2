<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useLanguage } from '../i18n';
import { titleExplanation, titleName, type TitleRef } from '../titles';
import UiSheet from './UiSheet.vue';

// A title that a tap explains (titles.ts, docs/architecture.md#titles): the title as its place
// shows it, in the slot, or else its name, as a button that opens a sheet with the name, what the
// title is and how it is won. Its place gives it its look; the button adds only a dotted
// underline, which says that there is more to read. `still` shows the title as plain text, as on
// a screen across a room, which nobody taps.
const props = defineProps<{ title: TitleRef; still?: boolean }>();
const { t } = useI18n();
const language = useLanguage();
const open = ref(false);
const name = computed(() => titleName(t, props.title, language.value));
const explanation = computed(() => titleExplanation(t, props.title));
</script>

<template>
  <span v-if="still"
    ><slot>{{ name }}</slot></span
  >
  <button v-else type="button" class="title-info" aria-haspopup="dialog" @click="open = true">
    <slot>{{ name }}</slot>
    <!-- The sheet is moved to the end of the page, out of the button. -->
    <UiSheet :open="open" :title="name" @close="open = false">
      <div class="explanation">
        <p v-for="(paragraph, index) in explanation" :key="index">{{ paragraph }}</p>
      </div>
    </UiSheet>
  </button>
</template>

<style scoped>
/* Weaker than any class of the place the title is in, which gives it its look. */
:where(.title-info) {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-align: inherit;
  text-transform: inherit;
  cursor: pointer;
}

.title-info {
  text-decoration: underline dotted;
  text-decoration-thickness: 2px;
  text-underline-offset: 0.2em;
}

.explanation {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  line-height: 1.6;
}
</style>

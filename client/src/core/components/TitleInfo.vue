<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useLanguage } from '../i18n';
import { titleExplanation, titleName, titleTone, type TitleRef } from '../titles';
import UiSheet from './UiSheet.vue';

// A title that a tap explains (titles.ts, docs/architecture.md#titles): the title as its place
// shows it, in the slot, or else its name, as a button that opens a sheet with the name, what the
// title is and how it is won. Its place gives it its look (docs/design.md): a pill, a badge or a
// tag has the small hard shadow and the press of a button, which its place adds with `press
// press-small`; a title in text, which its place marks `word`, takes the color of its news, blue
// for good and red for bad, and every title that isn't a pill darkens under a pointer or a press.
// `still` shows the title as plain text, as on a screen across a room, which nobody taps.
const props = defineProps<{ title: TitleRef; still?: boolean }>();
const { t } = useI18n();
const language = useLanguage();
const open = ref(false);
const name = computed(() => titleName(t, props.title, language.value));
const explanation = computed(() => titleExplanation(t, props.title));
const tone = computed(() => titleTone(props.title));
</script>

<template>
  <span v-if="still"
    ><slot>{{ name }}</slot></span
  >
  <button v-else type="button" class="title-info" :class="tone" aria-haspopup="dialog" @click="open = true">
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

/* A title that isn't a pill, in a heading or a line of text, eases its color and, pressed, moves
   down a pixel, as the pills move into their shadows; its place darkens it under a pointer or a
   press, in the color it gave it. */
.title-info:not(.pill, .badge, .tag, .author) {
  transition:
    color var(--motion),
    transform var(--motion);
}

.title-info:not(.pill, .badge, .tag, .author):active {
  transform: translateY(1px);
}

/* A title in text, in bold and the color of its news. */
.word {
  font-weight: var(--weight-black);
}

.word.good {
  color: var(--blue-deep);
}

.word.bad {
  color: var(--red-deep);
}

@media (hover: hover) {
  .word.good:hover {
    color: var(--blue-deeper);
  }

  .word.bad:hover {
    color: var(--red-deeper);
  }
}

.word.good:active {
  color: var(--blue-deeper);
}

.word.bad:active {
  color: var(--red-deeper);
}

.explanation {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  line-height: 1.6;
}
</style>

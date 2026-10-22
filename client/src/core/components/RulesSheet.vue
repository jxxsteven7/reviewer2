<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import { GUIDE_PATH } from '../guide/progress';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';

// "How to play", for every game (docs/rules/display.md#a-games-room): the room's settings first, as
// the game's summary in the slot shows them, then the rules in the game's own sections, and at the
// end, for a game with a tutorial, the way to it, for a player who would rather be shown: in a room
// it opens in a tab of its own, so that the game goes on in this one.
//
// In a room it opens from a quiet button. On the home page it opens from a `link`, the small word
// "Rules" beside the game's name, with the `defaults`, as a new room has them, and a word that each
// room may change them.
withDefaults(
  defineProps<{
    sections: { title: string; text: string[] }[];
    link?: boolean;
    defaults?: boolean;
    guide?: boolean;
  }>(),
  { link: false, defaults: false, guide: false },
);
const { t } = useI18n();
const open = ref(false);

const route = useRoute();
const inRoom = computed(() => route.path.startsWith('/room/'));
</script>

<template>
  <button v-if="link" type="button" class="rules-link" aria-haspopup="dialog" @click="open = true">
    {{ t('rules.link') }}
  </button>
  <UiButton v-else variant="quiet" size="small" @click="open = true">{{ t('rules.title') }}</UiButton>
  <UiSheet :open="open" :title="t('rules.title')" @close="open = false">
    <div class="rules sections">
      <p v-if="defaults" class="defaults">{{ t('rules.defaults') }}</p>
      <section>
        <h3 class="section-title">{{ t(defaults ? 'rules.defaultsTitle' : 'settings.title') }}</h3>
        <div class="summary"><slot /></div>
      </section>
      <section v-for="section in sections" :key="section.title">
        <h3 class="section-title">{{ section.title }}</h3>
        <p v-for="line in section.text" :key="line">{{ line }}</p>
      </section>
      <RouterLink
        v-if="guide"
        class="guide-link text-link"
        :to="GUIDE_PATH"
        :target="inRoom ? '_blank' : undefined"
        :rel="inRoom ? 'noopener' : undefined"
        @click="open = false"
        >{{ t('guide.rulesLink') }}</RouterLink
      >
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
  font-size: var(--text-lg);
}

.rules p {
  margin-top: var(--space-1);
  color: var(--ink-2);
}

.summary {
  margin-top: var(--space-2);
}

.guide-link {
  align-self: flex-start;
  font-weight: var(--weight-bold);
}

.rules .defaults {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
  color: var(--ink);
  font-size: var(--text-sm);
}

/* The small word beside the game's name: underlined text in the text font, whose box reaches 44 px
   high, and wide, out of sight, and which follows the name's last line. */
.rules-link {
  position: relative;
  margin-left: var(--space-2);
  padding: 0;
  border: 0;
  background: none;
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  line-height: 1.2;
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 0.2em;
  white-space: nowrap;
  vertical-align: baseline;
  cursor: pointer;
}

.rules-link::before {
  content: '';
  position: absolute;
  inset: calc(50% - 22px) -8px;
}
</style>

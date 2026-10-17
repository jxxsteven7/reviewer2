<script setup lang="ts">
import type { DuoTitle } from '@reviewer2/shared';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import TitleInfo from './TitleInfo.vue';

// The friend titles of one friend on the friends list (docs/architecture.md#friend-duos), as pills
// on one line: as many as fit, and the others folded into a "+N" pill, which a tap unfolds where it
// stands. Each title opens its explanation, as everywhere. The pills are measured once they are
// drawn, all of them, and the line again whenever its width changes, as when a phone turns; a
// browser that lays nothing out, as in a test, shows every title.
const props = defineProps<{ titles: readonly DuoTitle[] }>();
const { t, locale } = useI18n();
const row = ref<HTMLElement | null>(null);
const shown = ref(props.titles.length);
const unfolded = ref(false);
const folded = computed(() => props.titles.length - shown.value);
let widths: number[] = [];
let foldWidth = 0;

// How many pills fit on the line, with the fold after them when some don't.
function fit(): void {
  const line = row.value;
  if (!line || unfolded.value || widths.length === 0) return;
  const room = line.clientWidth;
  const gap = parseFloat(getComputedStyle(line).columnGap) || 0;
  const width = (count: number) => widths.slice(0, count).reduce((sum, each) => sum + each + gap, 0);
  if (room === 0 || width(widths.length) - gap <= room) {
    shown.value = widths.length;
    return;
  }
  let count = widths.length - 1;
  while (count > 0 && width(count) + foldWidth > room) count -= 1;
  shown.value = count;
}

async function measure(): Promise<void> {
  shown.value = props.titles.length;
  await nextTick();
  const line = row.value;
  if (!line) return;
  widths = [...line.querySelectorAll<HTMLElement>(':scope > .title')].map((item) => item.offsetWidth);
  foldWidth = line.querySelector<HTMLElement>(':scope > .fold')?.offsetWidth ?? 0;
  fit();
}

let watching: ResizeObserver | null = null;
onMounted(() => {
  void measure();
  if (typeof ResizeObserver === 'function' && row.value) {
    watching = new ResizeObserver(() => fit());
    watching.observe(row.value);
  }
});
onBeforeUnmount(() => watching?.disconnect());
watch([() => props.titles.join(), locale], () => {
  unfolded.value = false;
  void measure();
});
</script>

<template>
  <ul ref="row" class="folded-titles">
    <li v-for="(title, index) in titles" v-show="unfolded || index < shown" :key="title" class="title">
      <TitleInfo :title="{ kind: 'duo', duo: title }" class="pill press press-small" />
    </li>
    <li v-if="!unfolded" class="fold" :class="{ idle: folded === 0 }">
      <button
        type="button"
        class="pill more press press-small"
        :aria-label="t('friends.moreTitles', { count: folded }, folded)"
        :aria-expanded="false"
        @click="unfolded = true"
      >
        +{{ folded || titles.length }}
      </button>
    </li>
  </ul>
</template>

<style scoped>
.folded-titles {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* A pill has the small hard shadow and the press of a button, which it is. Its box reaches above
   and below it, out of sight, to 44 px tall, centered on it; the rows are 12 px apart, more than the
   box reaches on either side, so that no pill's box lies over another's. */
.pill {
  position: relative;
  padding: 2px var(--space-2);
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--bg);
  box-shadow: var(--shadow-0);
  color: var(--ink);
  font: inherit;
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  line-height: 1.5;
  white-space: nowrap;
}

.pill::before {
  content: '';
  position: absolute;
  inset: calc(50% - 22px) 0;
}

.pill.more {
  background: var(--paper);
  cursor: pointer;
}

/* With nothing folded, the fold stays on the line out of sight, so that its width is known. */
.fold.idle {
  position: absolute;
  visibility: hidden;
}
</style>

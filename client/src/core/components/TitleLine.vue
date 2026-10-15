<script setup lang="ts">
import type { TitleCount } from '@reviewer2/shared';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import TitleInfo from './TitleInfo.vue';

// The titles that one game brought a player (docs/games/keywords.md#titles), as small yellow pills
// on one line beside the player's name: as many as fit, the first of them always whole, which the
// line asks room for, and the rest folded into a yellow "…" pill, which a tap unfolds, on as many
// lines as it takes; `open` says whether it is unfolded, for the place that folds it again. Each
// title opens its explanation, as everywhere (TitleInfo.vue). The pills are measured on a hidden
// copy of them all, and again whenever the line's width changes; a browser that lays nothing out,
// as in a test, shows every title.
const props = defineProps<{ titles: readonly TitleCount[] }>();
const open = defineModel<boolean>('open', { default: false });
const { t, locale } = useI18n();
const line = ref<HTMLElement | null>(null);
const copy = ref<HTMLElement | null>(null);
const shown = ref(props.titles.length);
const least = ref(0);

const labelOf = ({ title, count }: TitleCount) => {
  const name = t(`account.profile.titleNames.${title}`);
  return count > 1 ? t('account.profile.titleCount', { title: name, count }) : name;
};

function fit(): void {
  if (!line.value || !copy.value) return;
  const gap = parseFloat(getComputedStyle(line.value).columnGap) || 0;
  const widths = [...copy.value.querySelectorAll<HTMLElement>(':scope > .title')].map((pill) => pill.offsetWidth);
  const more = copy.value.querySelector<HTMLElement>(':scope > .more')?.offsetWidth ?? 0;
  const [first = 0] = widths;
  least.value = widths.length > 1 ? first + gap + more : first;
  const room = line.value.clientWidth;
  if (room === 0 || widths.reduce((sum, width) => sum + width + gap, -gap) <= room) {
    shown.value = widths.length;
    return;
  }
  let count = 1;
  let used = first;
  while (count < widths.length - 1 && used + gap + (widths[count] as number) + gap + more <= room) {
    used += gap + (widths[count] as number);
    count += 1;
  }
  shown.value = count;
}

let watching: ResizeObserver | null = null;
onMounted(() => {
  void nextTick(fit);
  if (typeof ResizeObserver === 'function' && line.value) {
    watching = new ResizeObserver(() => fit());
    watching.observe(line.value);
  }
});
onBeforeUnmount(() => watching?.disconnect());
watch([() => props.titles.map(({ title, count }) => `${title}${count}`).join(), locale], () => {
  shown.value = props.titles.length;
  void nextTick(fit);
});
</script>

<template>
  <span ref="line" class="title-line" :class="{ open }" :style="least ? { minWidth: `${least}px` } : undefined">
    <span ref="copy" class="copy" aria-hidden="true">
      <span v-for="item in titles" :key="item.title" class="pill title">{{ labelOf(item) }}</span>
      <span class="pill more">&hellip;</span>
    </span>
    <TitleInfo
      v-for="item in open ? titles : titles.slice(0, shown)"
      :key="item.title"
      :title="{ kind: 'award', title: item.title }"
      class="pill"
      >{{ labelOf(item) }}</TitleInfo
    >
    <button
      v-if="!open && shown < titles.length"
      type="button"
      class="pill more"
      :aria-label="t('match.allTitles')"
      @click.stop="open = true"
    >
      &hellip;
    </button>
  </span>
</template>

<style scoped>
/* The line clips nothing, so that a pill's focus ring and the reach of its tap stay in sight: the
   pills it shows fit by its measure. */
.title-line {
  position: relative;
  display: flex;
  flex: 1 1 0;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px;
  contain: inline-size;
}

.title-line.open {
  flex-wrap: wrap;
}

/* The hidden copy that the pills are measured on, in a box of no size, so that it takes no room
   and scrolls nothing sideways. */
.copy {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  gap: 4px;
  width: 0;
  height: 0;
  overflow: hidden;
  visibility: hidden;
  white-space: nowrap;
  pointer-events: none;
}

.pill {
  position: relative;
  flex: none;
  padding: 0 6px;
  border: 1.5px solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--bg);
  color: var(--ink);
  font: inherit;
  font-size: 11px;
  font-weight: var(--weight-bold);
  line-height: 1.5;
  white-space: nowrap;
  cursor: pointer;
}

/* The pill says that it can be tapped; no underline besides. */
.title-line > .pill {
  text-decoration: none;
}

.pill.more {
  min-width: 24px;
  padding: 0 5px;
  font-weight: var(--weight-black);
  letter-spacing: 0.05em;
}

/* A pill reaches 36px high to tap, out of sight. */
.title-line > .pill::before {
  content: '';
  position: absolute;
  inset: calc(50% - 18px) -2px;
}
</style>

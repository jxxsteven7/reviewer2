<script setup lang="ts">
import { nextRank, RANK_POINTS, RANKS, type Rank } from '@reviewer2/shared';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import UiSheet from './UiSheet.vue';

// The ladder of academic ranks (docs/architecture.md#academic-ranks), in a sheet: every rank from
// the kindergartner at the bottom to Reviewer 2 at the top, with the points it is held from, and
// the player's own rank marked, scrolled into view when the sheet opens. The rungs the player has
// climbed are solid. With `points`, the player's own on the account page, the marked rung says how
// far the next rank is; without, as on another player's public page, the ladder marks the rank
// alone, since the points never show there.
const props = defineProps<{ open: boolean; rank: Rank; points?: number | null }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

const own = computed(() => props.points !== null && props.points !== undefined);
const held = computed(() => RANKS.indexOf(props.rank));
// Top rung first.
const rungs = computed(() =>
  [...RANKS].reverse().map((rank) => ({
    rank,
    points: RANK_POINTS[rank],
    current: rank === props.rank,
    reached: RANKS.indexOf(rank) <= held.value,
  })),
);
// What the marked rung says under its name, on the player's own ladder: how far the next rank is,
// or that this is the top.
const progress = computed(() => {
  if (!own.value) return null;
  const next = nextRank(props.points as number);
  return next ? t('ranks.next', { points: next.points, rank: t(`ranks.names.${next.rank}`) }) : t('ranks.top');
});

const list = ref<HTMLElement | null>(null);
watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    // Not every browser that the tests run in has it.
    list.value?.querySelector<HTMLElement>('.current')?.scrollIntoView?.({ block: 'center' });
  },
);
</script>

<template>
  <UiSheet :open="open" :title="t('ranks.ladder.title')" @close="emit('close')">
    <ol ref="list" class="ladder">
      <li
        v-for="rung in rungs"
        :key="rung.rank"
        class="rung"
        :class="{ current: rung.current, reached: rung.reached }"
        :aria-current="rung.current ? 'true' : undefined"
      >
        <span class="mark" aria-hidden="true"></span>
        <span class="words">
          <span class="name">{{ t(`ranks.names.${rung.rank}`) }}</span>
          <span v-if="rung.current" class="sr-only">{{ t('ranks.ladder.current') }}</span>
          <span v-if="rung.current && progress" class="progress">{{ progress }}</span>
        </span>
        <span class="from num">{{ t('ranks.ladder.from', { points: rung.points }) }}</span>
      </li>
    </ol>
  </UiSheet>
</template>

<style scoped>
.ladder {
  --rail: 20px;
  position: relative;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* The rail that the rungs hang on. */
.ladder::before {
  content: '';
  position: absolute;
  top: 22px;
  bottom: 22px;
  left: calc(var(--rail) / 2 - var(--line-thin) / 2);
  width: var(--line-thin);
  background: var(--ink);
}

.rung {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 44px;
  padding: var(--space-1) var(--space-2) var(--space-1) 0;
  border-radius: var(--radius-card);
}

.mark {
  flex: none;
  box-sizing: border-box;
  width: var(--rail);
  height: var(--rail);
  border: var(--line) solid var(--ink);
  border-radius: 50%;
  background: var(--paper);
}

.reached .mark {
  background: var(--ink);
}

.current {
  margin: var(--space-1) 0;
  padding-right: var(--space-3);
  background: var(--bg);
  box-shadow: 0 0 0 var(--line) var(--ink);
}

.current .mark {
  background: var(--bg);
  box-shadow: inset 0 0 0 3px var(--paper);
}

.words {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.name {
  font-weight: var(--weight-bold);
}

.current .name {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--weight-display);
  font-synthesis: none;
}

.progress,
.from {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.from {
  flex: none;
}

.current .from {
  color: var(--ink);
}
</style>

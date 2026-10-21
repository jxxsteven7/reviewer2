<script setup lang="ts">
import { useId } from 'vue';
import { useFold } from '../useFold';

// A fold (docs/rules/display.md#panels-rows-and-tags): a sticker with the thinner outline and the
// small shadow whose whole title row is its button, with a marker in front that turns to point
// down as it opens. The title is in bold, with a `summary` under it in grey, as the word lists
// chosen, or an `aside` on its right, as how a round of a game went. What it folds is the slot,
// which unfolds and folds with its height eased (useFold.ts). Whether it is open binds with
// v-model:open.
defineProps<{ title: string; summary?: string | null; aside?: string | null }>();
const open = defineModel<boolean>('open', { default: false });
const id = useId();
const fold = useFold();
</script>

<template>
  <div class="fold-card">
    <button type="button" class="toggle" :aria-expanded="open" :aria-controls="`${id}-body`" @click="open = !open">
      <span class="text">
        <span class="title">{{ title }}</span>
        <span v-if="summary" class="summary">{{ summary }}</span>
      </span>
      <span v-if="aside" class="aside">{{ aside }}</span>
    </button>
    <Transition :css="false" v-bind="fold">
      <div v-show="open" :id="`${id}-body`" class="body">
        <slot />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* A sticker whose whole first line is the button, with its marker in front. */
.fold-card {
  align-self: stretch;
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-1);
}

.toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 52px;
  padding: var(--space-2) var(--space-4);
  border: 0;
  border-radius: calc(var(--radius-panel) - var(--line));
  background: none;
  color: var(--ink);
  font: inherit;
  text-align: start;
  cursor: pointer;
  touch-action: manipulation;
}

/* The marker turns to point down as the fold opens. */
.toggle::before {
  content: '\25B8';
  display: inline-block;
  font-size: var(--text-xs);
  transition: transform 220ms var(--ease-out);
}

.toggle[aria-expanded='true']::before {
  transform: rotate(90deg);
}

@media (hover: hover) {
  .toggle:hover {
    background: var(--paper-2);
  }
}

.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.title {
  font-weight: var(--weight-black);
  line-height: 1.3;
}

.summary {
  overflow: hidden;
  color: var(--ink-2);
  font-size: var(--text-sm);
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aside {
  flex: none;
  max-width: 60%;
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  text-align: end;
}

.body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-1) var(--space-4) var(--space-4);
}
</style>

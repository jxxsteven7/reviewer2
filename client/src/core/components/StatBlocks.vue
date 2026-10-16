<script setup lang="ts">
// Counts on small blocks of their own, side by side and as wide as each other, as the record of an
// account (RecordStats.vue) and the page of an AI player (AgentProfileCard.vue) show them: a label,
// a number, and under a rate how many it was counted over, in smaller type. The blocks of the
// record (`roles`) are six: the four of before and the rates in each role, which go on a second
// line of their own where four is all that fits, as on a phone or in a panel, and in one line of
// six where it fits, as on a wide account page; the blocks ask their own box, not the screen, since
// the same record sits in a narrow panel on a wide screen. A count under a rate may wrap between
// the number and its word, so that a long one grows the block rather than be cut.
export interface StatBlock {
  label: string;
  value: string;
  detail?: string;
}

defineProps<{ blocks: StatBlock[]; roles?: boolean }>();
</script>

<template>
  <div class="stat-blocks-box">
    <dl class="stat-blocks" :class="{ roles }">
      <div v-for="block in blocks" :key="block.label" class="block">
        <dt>{{ block.label }}</dt>
        <dd class="value num">{{ block.value }}</dd>
        <dd v-if="block.detail !== undefined" class="detail num">{{ block.detail }}</dd>
      </div>
    </dl>
  </div>
</template>

<style scoped>
.stat-blocks-box {
  container-type: inline-size;
}

.stat-blocks {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-2);
  margin: 0;
}

.block {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  min-width: 0;
  padding: var(--space-1) var(--space-2);
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-card);
  background: var(--paper);
}

dt {
  grid-column: 1 / -1;
  max-width: 100%;
  overflow: hidden;
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

dd {
  margin: 0;
}

.value {
  font-size: var(--text-xl);
  font-weight: var(--weight-display);
  line-height: 1.2;
}

.detail {
  color: var(--ink-2);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}

/* The six blocks of a record: the rates in each role on a line of their own under the four, each
   twice as wide, with its count beside the rate... */
.roles {
  grid-template-areas:
    'games rate matches won'
    'captain captain guesser guesser';
}

.roles .block:nth-child(3),
.roles .block:nth-child(4) {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  column-gap: var(--space-2);
}

.roles .block:nth-child(1) {
  grid-area: games;
}

.roles .block:nth-child(2) {
  grid-area: rate;
}

.roles .block:nth-child(3) {
  grid-area: captain;
}

.roles .block:nth-child(4) {
  grid-area: guesser;
}

.roles .block:nth-child(5) {
  grid-area: matches;
}

.roles .block:nth-child(6) {
  grid-area: won;
}

/* ...and in one line where six fit, each count under its rate. */
@container (min-width: 30rem) {
  .roles {
    grid-template-columns: repeat(6, minmax(0, 1fr));
    grid-template-areas: 'games rate captain guesser matches won';
  }

  .roles .block:nth-child(3),
  .roles .block:nth-child(4) {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

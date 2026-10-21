<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import SeatAvatar from './SeatAvatar.vue';

// Votes as the hidden word game shows them once they are revealed (docs/rules/display.md
// #the-second-game), in the record and in a report's result alike: a beige row each, with the
// number voted for, by its avatar, or the verdict, the count, and after an arrow the avatars of
// those who voted so; the row that decided, the player voted out or the report passed, ends in an
// ink pill that says so (`mark`). The small avatars open nothing, and have no shadow.
export interface Row {
  key: string;
  number?: number | null;
  label: string;
  voters: number[];
  mark?: string | null;
}
defineProps<{ rows: Row[] }>();
const { t } = useI18n();
</script>

<template>
  <ul class="vote-rows">
    <li v-for="row in rows" :key="row.key" class="row">
      <span class="lead">
        <SeatAvatar v-if="row.number" :number="row.number" />
        <span class="label num">{{ row.label }}</span>
      </span>
      <span v-if="row.voters.length" class="voters">
        <span class="arrow" aria-hidden="true">&larr;</span>
        <span class="sr-only">{{ t('games.impostor.record.votedBy') }}</span>
        <span class="avatars">
          <SeatAvatar v-for="voter in row.voters" :key="voter" :number="voter" />
        </span>
      </span>
      <span v-if="row.mark" class="mark tag-pill">{{ row.mark }}</span>
    </li>
  </ul>
</template>

<style scoped>
.vote-rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-3);
  min-height: 44px;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
}

.lead {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
  min-width: 5.5em;
}

.label {
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
}

.voters {
  display: inline-flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.arrow {
  color: var(--ink-2);
  font-weight: var(--weight-bold);
}

.avatars {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.mark {
  margin-inline-start: auto;
}
</style>

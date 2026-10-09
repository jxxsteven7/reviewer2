<script setup lang="ts">
import type { MatchView, RoomView } from '@reviewer2/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { act } from '../socket';
import { useBusy } from '../useBusy';
import PlayerAvatar from './PlayerAvatar.vue';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';

// The scores of a match, which everyone in the room sees: which game it is, and each player's
// place, total and points in the game in focus, as the server counted them. The game describes
// where the points came from, with `describe`, when it wants to, as between two games. The chair
// may end the match early from here.
const props = withDefaults(
  defineProps<{ room: RoomView; describe?: ((detail: unknown) => string) | null; endable?: boolean }>(),
  { describe: null, endable: true },
);
const { t } = useI18n();
const { busy, run } = useBusy();

const match = computed(() => props.room.match as MatchView);
const isChair = computed(() => props.room.me !== null && props.room.chairId === props.room.me);
// In the waiting room the points are those of the last game; otherwise of the game on or just
// ended.
const deltaLabel = computed(() => (props.room.phase === 'lobby' ? t('match.lastDelta') : t('match.delta')));

// A score with its sign, with a real minus sign, or a dash for none.
const signed = (points: number | null) => {
  if (points === null) return '\u2013';
  if (points > 0) return `+${points}`;
  return points < 0 ? `\u2212${-points}` : '0';
};
const total = (points: number) => (points < 0 ? `\u2212${-points}` : String(points));

const ending = ref(false);
async function end() {
  ending.value = false;
  await run(() => act('room:matchEnd', { matchId: match.value.id }));
}
</script>

<template>
  <section class="match-table">
    <header>
      <h2 class="section-title">{{ t('match.table') }}</h2>
      <p class="progress">{{ t('match.progress', { game: match.game, games: match.rules.games }) }}</p>
    </header>
    <p v-if="!match.standings.length" class="none">{{ t('match.none') }}</p>
    <table v-else>
      <thead>
        <tr>
          <th scope="col" class="rank">{{ t('match.rank') }}</th>
          <th scope="col">{{ t('match.player') }}</th>
          <th scope="col" class="number">{{ t('match.total') }}</th>
          <th scope="col" class="number">{{ deltaLabel }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(line, index) in match.standings"
          :key="line.playerId ?? `left-${index}`"
          :class="{ me: line.playerId !== null && line.playerId === room.me, left: line.left }"
        >
          <td class="rank">{{ line.rank ?? '\u2013' }}</td>
          <td class="who">
            <span class="name-line">
              <PlayerAvatar :name="line.name" :avatar="line.avatar" />
              <span class="name">{{ line.name }}</span>
              <span v-if="line.playerId !== null && line.playerId === room.me" class="mark">{{ t('room.you') }}</span>
              <span v-if="line.left" class="mark">{{ t('match.left') }}</span>
            </span>
            <span v-if="describe && line.detail !== undefined" class="detail">{{ describe(line.detail) }}</span>
          </td>
          <td class="number total">{{ total(line.total) }}</td>
          <td
            class="number delta"
            :class="{ up: line.delta !== null && line.delta > 0, down: line.delta !== null && line.delta < 0 }"
          >
            {{ signed(line.delta) }}
          </td>
        </tr>
      </tbody>
    </table>
    <slot />
    <UiButton
      v-if="endable && isChair && match.status === 'on'"
      class="end"
      variant="quiet"
      size="small"
      @click="ending = true"
    >
      {{ t('match.end') }}
    </UiButton>

    <UiSheet :open="ending" :title="t('match.end')" @close="ending = false">
      <div class="confirm">
        <p>{{ t('match.endConfirm') }}</p>
        <UiButton variant="danger" :disabled="busy" @click="end">{{ t('match.end') }}</UiButton>
        <UiButton variant="quiet" @click="ending = false">{{ t('lobby.manage.cancel') }}</UiButton>
      </div>
    </UiSheet>
  </section>
</template>

<style scoped>
.match-table {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-4) 0;
  border-top: 1px solid var(--rule);
}

header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
}

.progress {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.none {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

th {
  padding: var(--space-1) var(--space-2) var(--space-1) 0;
  border-bottom: 1px solid var(--ink);
  color: var(--ink-3);
  font-weight: 400;
  text-align: left;
  font-variant-caps: all-small-caps;
  letter-spacing: 0.06em;
}

td {
  padding: var(--space-1) var(--space-2) var(--space-1) 0;
  border-bottom: 1px solid var(--rule);
  vertical-align: middle;
}

th:last-child,
td:last-child {
  padding-right: 0;
}

.rank {
  width: 2.5rem;
}

.number {
  width: 3.5rem;
  text-align: right;
}

.who {
  min-width: 0;
}

.name-line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 36px;
  min-width: 0;
}

.name {
  overflow-wrap: anywhere;
}

.mark {
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.detail {
  display: block;
  padding-bottom: var(--space-1);
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.me .name {
  font-weight: 600;
}

.left {
  color: var(--ink-3);
}

.total {
  font-weight: 600;
}

.delta.up {
  color: var(--blue);
}

.delta.down {
  color: var(--red);
}

.end {
  margin-top: var(--space-1);
}

.confirm {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
</style>

<script setup lang="ts">
import type { MatchView, RoomView } from '@reviewer2/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { points, signedPoints } from '../points';
import { act } from '../socket';
import { useBusy } from '../useBusy';
import PlayerAvatar from './PlayerAvatar.vue';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';

// The scores of a match, which everyone in the room sees: which game it is, and each player's
// place, total and points in the game in focus, as the server counted them. The game describes
// where the points came from, with `describe`, when it wants to, as between two games. The chair
// may end the match early from here. In a narrow column the avatar, the name and the marks keep to
// one line, the name cut short with an ellipsis (its title has the whole), and the numbers keep
// their room.
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
          <td class="rank num">{{ line.rank ?? '\u2013' }}</td>
          <td class="who">
            <span class="name-line">
              <PlayerAvatar :name="line.name" :avatar="line.avatar" />
              <span class="name" :title="line.name">{{ line.name }}</span>
              <span v-if="line.playerId !== null && line.playerId === room.me" class="mark">{{ t('room.you') }}</span>
              <span v-if="line.left" class="mark">{{ t('match.left') }}</span>
            </span>
            <span v-if="describe && line.detail !== undefined" class="detail">{{ describe(line.detail) }}</span>
          </td>
          <td class="number total num">{{ points(line.total) }}</td>
          <td
            class="number delta num"
            :class="{ up: line.delta !== null && line.delta > 0, down: line.delta !== null && line.delta < 0 }"
          >
            {{ signedPoints(line.delta) }}
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
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
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
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.none {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

/* Each player on a block of their own; the viewer's own takes the table's yellow. */
table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0 var(--space-1);
  font-size: var(--text-sm);
}

th {
  padding: 0 var(--space-2) var(--space-1) 0;
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-black);
  letter-spacing: 0.04em;
  text-align: left;
  text-transform: uppercase;
}

td {
  padding: var(--space-1) var(--space-2) var(--space-1) 0;
  background: var(--paper-2);
  vertical-align: middle;
}

td:first-child {
  padding-left: var(--space-2);
  border-radius: var(--radius-card) 0 0 var(--radius-card);
}

th:last-child,
td:last-child {
  padding-right: var(--space-2);
  border-radius: 0 var(--radius-card) var(--radius-card) 0;
}

.me td {
  background: var(--bg);
}

.rank {
  width: 2.5rem;
  font-weight: var(--weight-display);
}

.number {
  width: 3.5rem;
  font-weight: var(--weight-display);
  text-align: right;
}

.who {
  min-width: 0;
}

.name-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px var(--space-2);
  min-height: 36px;
  min-width: 0;
  font-weight: var(--weight-bold);
}

.name {
  overflow-wrap: anywhere;
}

.mark {
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--on-ink);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  line-height: 1.6;
}

.detail {
  display: block;
  padding-bottom: var(--space-1);
  color: var(--ink-2);
  font-size: var(--text-xs);
}

.me .name {
  font-weight: var(--weight-black);
}

.left {
  color: var(--ink-2);
}

.total {
  font-size: var(--text-md);
}

.delta.up {
  color: var(--blue-deep);
}

.delta.down {
  color: var(--red-deep);
}

.end {
  margin-top: var(--space-1);
}

.confirm {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* In a narrow column, such as the fold under the board on a narrow phone, the name column takes
   what the numbers leave, and each line stays one line. The place column keeps room for its
   heading in capitals, which "PLACE" needs. */
@container (max-width: 17rem) {
  table {
    table-layout: fixed;
  }

  th.rank {
    width: 3rem;
  }

  th.number {
    width: 2.5rem;
  }

  th,
  td {
    padding-right: var(--space-1);
  }

  .name-line {
    flex-wrap: nowrap;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>

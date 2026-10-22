<script setup lang="ts">
import type { TitleCount } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { points, signedPoints } from '../points';
import type { ShownMatch, ShownRoom } from '../room';
import { useTitleFolds } from '../useTitleFolds';
import EndMatchButton from './EndMatchButton.vue';
import AvatarButton from './AvatarButton.vue';
import TitleLine from './TitleLine.vue';

// The scores of a match, which everyone in the room sees: which game it is, and each player's
// place, total and points in the game in focus, as the server counted them, one line each. The
// place and the player need no heading, which only a screen reader is told, so the place and the
// avatar stand at the line's left edge and the numbers take only the room they need. The viewer's
// own line is yellow, which says "you" to the eye; a screen reader hears it. Someone offline has
// the avatar of someone the room waits for (PlayerAvatar.vue). The game describes where the points
// came from, with `describe`, when it wants to, as between two games, and gives the titles that
// the game in focus brought each player so far, with `titlesOf`: they follow the name on its line
// (TitleLine.vue), the name cut short first where the line is short, and on a line of their own
// under it where even then the first title wouldn't fit whole. On a wide table, the description
// comes on the name's line too, and the titles at its right end. The chair may end the match early
// from here, unless the game puts that button elsewhere (`endable`).
//
// A game says what else the table shows: a line under its head, as why the game that has just
// ended doesn't count (`note`); no column of the game in focus during a game whose points come
// only at its end (`delta`); and, during a game whose players are only numbers, nobody as offline
// or gone, which could tell whose number had let time run out (`presence`): everyone who has
// played a game that counted is ranked then, the lines keep their order whoever leaves, and no
// avatar opens a panel.
const props = withDefaults(
  defineProps<{
    room: ShownRoom;
    describe?: ((detail: unknown) => string) | null;
    titlesOf?: ((playerId: string) => TitleCount[]) | null;
    endable?: boolean;
    note?: string | null;
    delta?: boolean;
    presence?: boolean;
  }>(),
  { describe: null, titlesOf: null, endable: true, note: null, delta: true, presence: true },
);
// A line's player while they are still in the room, whose panel a tap on the avatar opens.
const inRoom = (id: string | null) =>
  props.presence && id !== null && props.room.players.some((player) => player.id === id) ? id : null;
const offline = (id: string | null) =>
  props.presence && id !== null && props.room.players.some((player) => player.id === id && !player.online);
const { t } = useI18n();
const titles = (id: string | null) => (id !== null && props.titlesOf ? props.titlesOf(id) : []);
// The lines whose titles are unfolded; a tap on the line, but on a button, folds them again.
const { unfolded, setOpen, fold } = useTitleFolds();

const match = computed(() => props.room.match as ShownMatch);
const isChair = computed(() => props.room.me !== null && props.room.chairId === props.room.me);
// The lines as the server ranked them, or, where the table shows nobody as gone, ranked again over
// everyone who has played a game that counted, as the server ranks those still in the room, with
// ties in the order the players entered the match. The server lists those who have left after the
// others, so their lines would move when they left, which would tell who they are.
const lines = computed(() => {
  const { standings } = match.value;
  if (props.presence) return standings;
  const ranked = standings.filter((line) => line.games > 0);
  const rankOf = (total: number) => 1 + ranked.filter((other) => other.total > total).length;
  return standings
    .map((line) => ({ ...line, left: false, rank: line.games > 0 ? rankOf(line.total) : null }))
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.number - b.number);
});
// In the waiting room the points are those of the last game; otherwise of the game on or just
// ended.
const deltaLabel = computed(() => (props.room.phase === 'lobby' ? t('match.lastDelta') : t('match.delta')));
// English heads the column with one short word, "This" or "Last", which a screen reader hears whole.
const deltaHead = computed(() => (props.room.phase === 'lobby' ? t('match.lastDeltaShort') : t('match.deltaShort')));
</script>

<template>
  <section class="match-table">
    <header>
      <h2 class="section-title">{{ t('match.table') }}</h2>
      <p class="progress">{{ t('match.progress', { game: match.game, games: match.rules.games }) }}</p>
    </header>
    <p v-if="note" class="note">{{ note }}</p>
    <p v-if="!match.standings.length" class="none">{{ t('match.none') }}</p>
    <table v-else>
      <thead>
        <tr>
          <th scope="col" class="rank">
            <span class="sr-only">{{ t('match.rank') }}</span>
          </th>
          <th scope="col">
            <span class="sr-only">{{ t('match.player') }}</span>
          </th>
          <th scope="col" class="number">{{ t('match.total') }}</th>
          <th v-if="delta" scope="col" class="number" :aria-label="deltaLabel">{{ deltaHead }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(line, index) in lines"
          :key="line.playerId ?? `left-${index}`"
          :class="{ me: line.playerId !== null && line.playerId === room.me, left: line.left }"
          @click="fold(line.playerId, $event)"
        >
          <td class="rank num">{{ line.rank ?? '\u2013' }}</td>
          <td class="who">
            <span class="name-line">
              <AvatarButton
                :player-id="inRoom(line.playerId)"
                :name="line.name"
                :username="line.username"
                :guest="line.guest"
                :avatar="line.avatar"
                :waiting="offline(line.playerId)"
              />
              <span class="rest">
                <span class="name" :title="line.name">{{ line.name }}</span>
                <span v-if="line.playerId !== null && line.playerId === room.me" class="sr-only">{{
                  t('room.you')
                }}</span>
                <span v-if="line.left" class="mark">{{ t('match.left') }}</span>
                <span v-if="describe && line.detail !== undefined" class="detail inline">{{
                  describe(line.detail)
                }}</span>
                <TitleLine
                  v-if="titles(line.playerId).length"
                  :titles="titles(line.playerId)"
                  :open="unfolded.has(line.playerId ?? '')"
                  @update:open="setOpen(line.playerId ?? '', $event)"
                />
              </span>
            </span>
            <span v-if="describe && line.detail !== undefined" class="detail below">{{ describe(line.detail) }}</span>
          </td>
          <td class="number total num">{{ points(line.total) }}</td>
          <td
            v-if="delta"
            class="number delta num"
            :class="{ up: line.delta !== null && line.delta > 0, down: line.delta !== null && line.delta < 0 }"
          >
            {{ signedPoints(line.delta) }}
          </td>
        </tr>
      </tbody>
    </table>
    <slot />
    <EndMatchButton
      v-if="endable && isChair && match.status === 'on'"
      class="end"
      :match-id="match.id"
      :game="room.game"
    />
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

.none,
.note {
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

.rank,
.number {
  width: 1%;
  font-weight: var(--weight-display);
  white-space: nowrap;
}

.number {
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
  font-weight: var(--weight-bold);
}

.name-line > :first-child {
  flex: none;
}

/* After the avatar: the name, cut short where the line is short, but to about four characters at
   least, and then the titles, which go to a line of their own under the name where even then the
   first of them wouldn't fit whole beside it. */
.rest {
  display: flex;
  flex: 1 1 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px var(--space-2);
  min-width: 0;
}

.name {
  flex: 1000 1 4em;
  min-width: 0;
  max-width: max-content;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mark {
  flex: none;
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

.detail.inline {
  display: none;
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

/* A wide table, as under the decision letter on a wide screen: a line each, with where the points
   came from after the name and the titles at the line's right end. Where they don't all fit, as a
   long detail on a table not much wider than this, the detail goes whole under the name, and its
   words wrap only where even that line is too short for it: the table never grows past its box. */
@container (min-width: 34rem) {
  .detail.inline {
    display: inline;
    flex: 0 1 auto;
    padding: 0;
    font-weight: var(--weight-text);
  }

  .detail.below {
    display: none;
  }

  .rest :deep(.title-line) {
    justify-content: flex-end;
  }
}
</style>

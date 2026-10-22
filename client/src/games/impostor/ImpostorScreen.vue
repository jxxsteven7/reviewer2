<script setup lang="ts">
import type { RoomView } from '@reviewer2/shared';
import type { SeatView } from '@reviewer2/shared/impostor';
import { computed, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import MatchResults from '../../core/components/MatchResults.vue';
import MatchTable from '../../core/components/MatchTable.vue';
import PlayerName from '../../core/components/PlayerName.vue';
import ScreenJoin from '../../core/components/ScreenJoin.vue';
import StreakNotices from '../../core/components/StreakNotices.vue';
import ImpostorLetter from './ImpostorLetter.vue';
import ImpostorStrip from './ImpostorStrip.vue';
import { describeScore, unscoredNote } from './match';
import RevealList from './RevealList.vue';
import RoundLog from './RoundLog.vue';
import SeatCard from './SeatCard.vue';
import { newestLine, seatState } from './seats';
import { playerAt, useImpostor } from './useImpostor';

// The hidden word game on a big screen, as the first game's (KeywordsScreen.vue): in the waiting
// room, how to join and who plays; during the game, what spectators see, the strip, the seats and
// the record of the rounds; at the end, the result and who everyone was. In a match, the match's
// table too, or its final ranking once the match is over (docs/games/impostor.md#matches): with
// where each player's points came from once the game is over, and, while an anonymous game is on,
// without the points of the game or who is offline or gone, as in the room. A screen sees no word
// and no role that a spectator doesn't, and its avatars open nothing.
const props = defineProps<{ room: RoomView }>();
const { t } = useI18n();
const { data, game, seated, spectators } = useImpostor(toRef(props, 'room'));
const seats = computed(() => [...(game.value?.seats ?? [])].sort((a, b) => a.number - b.number));
const over = computed(() => game.value?.phase === 'over');
const nameOf = (seat: SeatView) => playerAt(seat, props.room.players)?.name ?? null;
const scoreLine = (detail: unknown) => describeScore(t, detail);
const unscored = computed(() => (game.value ? unscoredNote(t, props.room.match, game.value) : null));
</script>

<template>
  <section v-if="room.phase === 'lobby' || !game" class="screen">
    <ScreenJoin :code="room.code" />
    <div class="people">
      <p class="kicker">{{ t('games.impostor.name') }} &middot; {{ t('lobby.kicker') }}</p>
      <section class="panel">
        <h2>{{ t('games.impostor.lobby.players') }}</h2>
        <ul>
          <li v-for="player in seated" :key="player.id">
            <PlayerName :player="player" :me="false" :chair="false" />
          </li>
        </ul>
        <p v-if="!seated.length" class="vacant">{{ t('lobby.nobody') }}</p>
      </section>
      <p class="role">{{ t('lobby.roles.spectator') }} &middot; {{ spectators.length }}</p>
      <template v-if="room.match">
        <MatchResults v-if="room.match.status !== 'on'" :room="room" />
        <MatchTable v-else :room="room" :endable="false" />
      </template>
    </div>
  </section>

  <section v-else class="screen-game">
    <ImpostorLetter v-if="over" class="wide-row" :game="game" :is-chair="false" compact :match="room.match" />
    <StreakNotices :room="room" large />
    <div class="main">
      <ImpostorStrip v-if="!over" :game="game" />
      <RevealList v-if="over" :game="game" :name-of="nameOf" />
      <div v-else class="board">
        <SeatCard
          v-for="seat in seats"
          :key="seat.number"
          :seat="seat"
          :state="seatState(game, seat)"
          :line="newestLine(game.lines, game.round, seat.number) ?? null"
          :name="nameOf(seat)"
        />
      </div>
    </div>
    <aside class="side">
      <ScreenJoin :code="room.code" small />
      <template v-if="room.match">
        <MatchResults v-if="room.match.status !== 'on'" :room="room" />
        <MatchTable
          v-else
          :room="room"
          :endable="false"
          :describe="scoreLine"
          :note="unscored"
          :delta="over"
          :presence="over || !data.settings.anonymous"
        />
      </template>
      <section class="panel">
        <RoundLog :game="game" />
      </section>
    </aside>
  </section>
</template>

<style scoped>
.screen {
  display: grid;
  gap: var(--space-6);
  padding: var(--space-5) 0;
}

.people {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.people .kicker {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: var(--weight-display);
  font-synthesis: none;
}

h2 {
  font-size: var(--text-2xl);
}

ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.role,
.vacant {
  color: var(--ink-2);
  font-weight: var(--weight-bold);
}

.screen-game {
  display: grid;
  gap: var(--space-5);
  padding-bottom: var(--space-5);
}

.main {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.board {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
}

.wide-row,
.screen-game :deep(.streak-notices) {
  grid-column: 1 / -1;
  margin-bottom: 0;
}

.side {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

@media (min-width: 60rem) {
  .screen {
    grid-template-columns: auto 1fr;
    align-items: start;
  }

  .screen-game {
    grid-template-columns: minmax(0, 1fr) 22rem;
    align-items: start;
  }
}
</style>

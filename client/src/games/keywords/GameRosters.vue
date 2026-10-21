<script setup lang="ts">
import type { PlayerView, RoomView } from '@reviewer2/shared';
import type { Team } from '@reviewer2/shared/keywords';
import { computed, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import PlayerName from '../../core/components/PlayerName.vue';
import type { Shown } from '../../core/components/ScoreFloat.vue';
import UiButton from '../../core/components/UiButton.vue';
import UiSheet from '../../core/components/UiSheet.vue';
import { useKeywords } from './useKeywords';

// Who plays where during a game, and the seat changes the rules allow: latecomers can play for
// a group, students can step out to watch, and anyone can take over an empty PI seat, after a
// warning that they will see the key. Whoever has sat in a group in this game belongs to it until
// the next one, so they are offered seats in that group only. In a match, a latecomer plays from
// the next game instead, and may change their mind and just watch until the waiting room opens.
//
// Each role has a line of its own, the PI's and the students', and under it one player a line, the
// name on one line and the rank and the marks on the next (PlayerName.vue); the spectators have
// theirs only when there are any. `floats` are the numbers that rise from the players' avatars
// beside the board as their points change, by player ID (useScoreFloats.ts).
const props = withDefaults(defineProps<{ room: RoomView; floats?: ReadonlyMap<string, Shown> }>(), {
  floats: () => new Map(),
});
const { t } = useI18n();
const { data, mySeat, mySide, isKeyViewer, groups, spectators, sit } = useKeywords(toRef(props, 'room'));
// Seats change only while the game is on; afterwards the waiting room is the place for that.
const playing = computed(() => data.value.game !== null && data.value.game.phase !== 'over');
const takingOver = ref<Team | null>(null);

const isMe = (player: PlayerView) => player.id === props.room.me;
const isChairOf = (player: PlayerView) => player.id === props.room.chairId;
// In a match, whoever hasn't played for a group in this game plays from the next one instead.
const mayJoin = (team: Team) =>
  playing.value && props.room.me !== null && (mySide.value ?? (props.room.match ? null : team)) === team;

async function takeOver() {
  if (takingOver.value) await sit(takingOver.value, 'captain');
  takingOver.value = null;
}
</script>

<template>
  <section class="rosters">
    <h2 class="section-title">{{ t('game.groups') }}</h2>
    <div v-for="group in groups" :key="group.team" class="group" :class="group.team">
      <h3>{{ t(`lobby.group.${group.team}`) }}</h3>
      <div class="seat">
        <p class="role">{{ t('lobby.roles.captain') }}</p>
        <PlayerName
          v-if="group.captain"
          :player="group.captain"
          :me="isMe(group.captain)"
          :chair="isChairOf(group.captain)"
          :float="floats.get(group.captain.id) ?? null"
          stacked
        />
        <p v-else class="vacant-line">
          <span class="vacant">{{ t('lobby.vacant') }}</span>
          <UiButton v-if="mayJoin(group.team)" size="small" @click="takingOver = group.team">{{
            t('game.takeOver')
          }}</UiButton>
        </p>
      </div>
      <div class="seat">
        <p class="role">{{ t('lobby.roles.guesser') }}</p>
        <ul v-if="group.guessers.length" class="names">
          <li v-for="player in group.guessers" :key="player.id">
            <PlayerName
              :player="player"
              :me="isMe(player)"
              :chair="isChairOf(player)"
              :float="floats.get(player.id) ?? null"
              stacked
            />
          </li>
        </ul>
        <p v-else class="vacant">{{ t('lobby.nobody') }}</p>
      </div>
      <UiButton
        v-if="mayJoin(group.team) && !isKeyViewer && mySeat?.role !== 'captain' && mySeat?.team !== group.team"
        size="small"
        @click="sit(group.team, 'guesser')"
      >
        {{ t('game.playFor', { group: t(`lobby.group.${group.team}`) }) }}
      </UiButton>
    </div>
    <div v-if="spectators.length" class="seat spectators">
      <p class="role">{{ t('lobby.roles.spectator') }}</p>
      <ul class="names">
        <li v-for="player in spectators" :key="player.id">
          <PlayerName :player="player" :me="isMe(player)" :chair="isChairOf(player)" stacked />
        </li>
      </ul>
    </div>
    <div v-if="playing || data.joinsNext" class="own">
      <UiButton v-if="mySeat?.role === 'guesser' || data.joinsNext" size="small" @click="sit(null, 'spectator')">
        {{ t('game.watch') }}
      </UiButton>
      <UiButton v-if="mySeat?.role === 'captain'" size="small" @click="sit(null, 'spectator')">
        {{ t('game.stepDown') }}
      </UiButton>
    </div>

    <UiSheet :open="takingOver !== null" :title="t('game.takeOver')" @close="takingOver = null">
      <div class="confirm">
        <p>{{ t('game.takeOverConfirm') }}</p>
        <UiButton variant="primary" @click="takeOver">{{ t('game.takeOver') }}</UiButton>
        <UiButton variant="quiet" @click="takingOver = null">{{ t('lobby.manage.cancel') }}</UiButton>
      </div>
    </UiSheet>
  </section>
</template>

<style scoped>
.rosters {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

.group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
}

.group.red {
  background: var(--red-tint);
}

.group.blue {
  background: var(--blue-tint);
}

h3 {
  font-size: var(--text-xl);
}

.group.red h3 {
  color: var(--red-deep);
}

.group.blue h3 {
  color: var(--blue-deep);
}

/* A role's name on a line of its own, and under it one player a line, each as wide as the column,
   where a long name or rank is cut short. */
.seat {
  display: flex;
  flex-direction: column;
  align-self: stretch;
  gap: 0;
  min-width: 0;
}

.role {
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-black);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.names {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.names li,
.seat > :deep(.player) {
  display: flex;
  min-width: 0;
}

.vacant-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-3);
  min-height: 44px;
}

.spectators {
  padding: 0 var(--space-3);
}

.vacant {
  color: var(--ink-2);
  font-weight: var(--weight-bold);
}

.own {
  display: flex;
  gap: var(--space-2);
}

.confirm {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
</style>

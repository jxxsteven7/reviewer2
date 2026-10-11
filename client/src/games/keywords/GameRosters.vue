<script setup lang="ts">
import type { PlayerView, RoomView, Team } from '@reviewer2/shared';
import { computed, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import PlayerMenu from '../../core/components/PlayerMenu.vue';
import PlayerName from '../../core/components/PlayerName.vue';
import UiButton from '../../core/components/UiButton.vue';
import UiSheet from '../../core/components/UiSheet.vue';
import { mayManage } from '../../core/manage';
import { useKeywords } from './useKeywords';

// Who plays where during a game, and the seat changes the rules allow: latecomers can play for
// a group, students can step out to watch, and anyone can take over an empty PI seat, after a
// warning that they will see the key. Whoever has sat in a group in this game belongs to it until
// the next one, so they are offered seats in that group only. In a match, a latecomer plays from
// the next game instead, and may change their mind and just watch until the waiting room opens.
const props = defineProps<{ room: RoomView }>();
const { t } = useI18n();
const { data, mySeat, mySide, isKeyViewer, groups, spectators, sit } = useKeywords(toRef(props, 'room'));
// Seats change only while the game is on; afterwards the waiting room is the place for that.
const playing = computed(() => data.value.game !== null && data.value.game.phase !== 'over');
const managing = ref<PlayerView | null>(null);
const takingOver = ref<Team | null>(null);

const isMe = (player: PlayerView) => player.id === props.room.me;
const isChairOf = (player: PlayerView) => player.id === props.room.chairId;
const manageable = (player: PlayerView) => mayManage(props.room, player);
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
      <p class="line">
        <span class="role">{{ t('lobby.roles.captain') }}</span>
        <PlayerName
          v-if="group.captain"
          :player="group.captain"
          :me="isMe(group.captain)"
          :chair="isChairOf(group.captain)"
          :manageable="manageable(group.captain)"
          @manage="managing = $event"
        />
        <template v-else>
          <span class="vacant">{{ t('lobby.vacant') }}</span>
          <UiButton v-if="mayJoin(group.team)" size="small" @click="takingOver = group.team">{{
            t('game.takeOver')
          }}</UiButton>
        </template>
      </p>
      <p class="line">
        <span class="role">{{ t('lobby.roles.guesser') }}</span>
        <span class="names">
          <PlayerName
            v-for="player in group.guessers"
            :key="player.id"
            :player="player"
            :me="isMe(player)"
            :chair="isChairOf(player)"
            :manageable="manageable(player)"
            @manage="managing = $event"
          />
        </span>
      </p>
      <UiButton
        v-if="mayJoin(group.team) && !isKeyViewer && mySeat?.role !== 'captain' && mySeat?.team !== group.team"
        size="small"
        @click="sit(group.team, 'guesser')"
      >
        {{ t('game.playFor', { group: t(`lobby.group.${group.team}`) }) }}
      </UiButton>
    </div>
    <p class="line spectators">
      <span class="role">{{ t('lobby.roles.spectator') }}</span>
      <span class="names">
        <PlayerName
          v-for="player in spectators"
          :key="player.id"
          :player="player"
          :me="isMe(player)"
          :chair="isChairOf(player)"
          :manageable="manageable(player)"
          @manage="managing = $event"
        />
      </span>
    </p>
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
    <PlayerMenu :player="managing" :room="room" @close="managing = null" />
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

.line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-3);
}

.role {
  width: 4.5rem;
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-black);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.names {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-3);
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

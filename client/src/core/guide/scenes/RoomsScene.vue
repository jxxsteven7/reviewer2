<script setup lang="ts">
import { BOARD_SIZE, type Language } from '@reviewer2/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { games } from '../../../games';
import ManuscriptId from '../../components/ManuscriptId.vue';
import ShareTools from '../../components/ShareTools.vue';
import UiButton from '../../components/UiButton.vue';
import CreateRoom from '../../views/CreateRoom.vue';
import { useSpot, type SpotTarget } from '../spot';
import ScenePart from './ScenePart.vue';

// A step of "Rooms and invitations": the room setup of the first game, as the home page opens it
// for the first time, at its defaults rather than from the reader's last room, and the ways to
// share an invented room and to invite friends to it, as its waiting room has them. Only to look
// at: nothing in it is sent.
const props = defineProps<{ chapter: string; step: number }>();
const { t, locale } = useI18n();
const [game] = Object.keys(games);
const room = computed(() => (game ? games[game]?.guide.room(t, locale.value as Language) : null));

// The setup's last three parts are the kind of room, who may join and whether its creator plays.
const SPOTS: Record<number, SpotTarget> = {
  1: { selector: '.create > section:first-of-type', finger: 'point' },
  2: { selector: '.create > section:nth-last-of-type(3) .kind', finger: 'point' },
  3: { selector: '.create > section:nth-last-of-type(2) .kind', finger: 'point' },
  4: { selector: '.create > section:last-of-type', finger: 'point' },
  5: { selector: '.share', finger: 'point' },
  6: { selector: '.invite-friends', finger: 'point' },
};
const root = ref<HTMLElement | null>(null);
useSpot(root, () => SPOTS[props.step] ?? null);
</script>

<template>
  <div ref="root" class="rooms-scene" inert>
    <ScenePart v-if="step < 5 && game">
      <CreateRoom :game="game" :words-needed="BOARD_SIZE" fresh />
    </ScenePart>
    <ScenePart v-else-if="room">
      <ManuscriptId :code="room.code" />
      <ShareTools :room="room" />
      <UiButton v-if="step === 6" class="invite-friends" size="small">{{ t('friends.invite') }}</UiButton>
    </ScenePart>
  </div>
</template>

<style scoped>
.rooms-scene > .part {
  align-items: flex-start;
}
</style>

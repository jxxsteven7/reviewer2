<script setup lang="ts">
import type { ClueCount, KeywordsView, RoomView } from '@reviewer2/shared';
import { computed, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../core/components/UiButton.vue';
import UiSheet from '../../core/components/UiSheet.vue';
import { act } from '../../core/socket';
import ClueLog from './ClueLog.vue';
import CluePanel from './CluePanel.vue';
import DecisionLetter from './DecisionLetter.vue';
import GameRosters from './GameRosters.vue';
import GroupChat from './GroupChat.vue';
import GuessBar from './GuessBar.vue';
import KeywordsBoard from './KeywordsBoard.vue';
import RulesSheet from './RulesSheet.vue';
import TurnStrip from './TurnStrip.vue';
import { useKeywords } from './useKeywords';

// A game in progress, and its result. The turn strip, the board and what the viewer can do now
// come first; the groups and the clue log follow, or sit beside the board on wide screens.
const props = defineProps<{ room: RoomView }>();
const { t } = useI18n();
const room = toRef(props, 'room');
const { data, mySeat, isChair } = useKeywords(room);

const game = computed(() => data.value.game as KeywordsView);
const moment = computed(() => ({ gameId: game.value.gameId, turn: game.value.turn }));
const myTurn = computed(() => mySeat.value?.team === game.value.team);
const canClue = computed(() => game.value.phase === 'clue' && myTurn.value && mySeat.value?.role === 'captain');
const canGuess = computed(() => game.value.phase === 'guess' && myTurn.value && mySeat.value?.role === 'guesser');
const group = computed(() => t(`lobby.group.${game.value.team}`));

// The choices of cards come from the server, which shows them to the group whose turn it is:
// the viewer's own choice is outlined, and the others' names run along the bottom of a card. A
// reveal, or the end of the turn, clears them all.
const selections = computed(() => game.value.selections ?? []);
const selected = computed(() => selections.value.find((choice) => choice.player === room.value.me)?.card ?? null);
const nameOf = (id: string) => room.value.players.find((player) => player.id === id)?.name ?? '';
const choosers = computed(() =>
  game.value.cards.map((_, index) =>
    selections.value
      .filter((choice) => choice.card === index && choice.player !== room.value.me)
      .map((choice) => nameOf(choice.player)),
  ),
);

// Tapping a card chooses it, tapping it again takes the choice back, and tapping another one
// moves the choice there. Revealing takes a second step, in the guess bar.
const choose = (card: number) =>
  act('keywords:select', { ...moment.value, card: selected.value === card ? null : card });

const giveClue = (word: string, count: ClueCount) => act('keywords:clue', { ...moment.value, word, count });

const reveal = (card: number) => act('keywords:reveal', { ...moment.value, card });

const pass = () => act('keywords:pass', moment.value);

const ending = ref(false);
async function withdraw() {
  ending.value = false;
  await act('room:end', { gameId: game.value.gameId });
}

const whoAmI = computed(() => {
  const seat = mySeat.value;
  if (!seat || seat.role === 'spectator') return t('game.you.spectator');
  return t(`game.you.${seat.role}`, { group: t(`lobby.group.${seat.team}`) });
});
</script>

<template>
  <section class="keywords-game">
    <DecisionLetter v-if="game.result" :result="game.result" :is-chair="isChair" @again="act('room:again')" />
    <TurnStrip v-else :game="game" />

    <div class="layout">
      <div class="main">
        <KeywordsBoard
          :cards="game.cards"
          :selectable="canGuess"
          :selected="selected"
          :choosers="choosers"
          :lang="room.language === 'zh' ? 'zh-CN' : 'en'"
          @select="choose"
        />
        <div v-if="!game.result" class="actions">
          <div class="who-row">
            <p class="who">{{ whoAmI }}</p>
            <GroupChat :room="room" />
          </div>
          <CluePanel v-if="canClue" :game="game" @give="giveClue" />
          <GuessBar v-else-if="canGuess" :game="game" :selected="selected" @reveal="reveal" @pass="pass" />
          <p v-else class="status">
            {{ game.phase === 'clue' ? t('game.waitClue', { group }) : t('game.waitGuess', { group }) }}
          </p>
        </div>
        <p class="note">{{ t('game.keyNote') }}</p>
      </div>

      <aside class="side sections">
        <GameRosters :room="room" />
        <ClueLog :game="game" />
        <div class="tools">
          <RulesSheet />
          <GroupChat v-if="game.result" :room="room" />
          <UiButton v-if="isChair && !game.result" variant="quiet" size="small" @click="ending = true">
            {{ t('game.end') }}
          </UiButton>
        </div>
      </aside>
    </div>

    <UiSheet :open="ending" :title="t('game.end')" @close="ending = false">
      <div class="confirm">
        <p>{{ t('game.endConfirm') }}</p>
        <UiButton variant="danger" @click="withdraw">{{ t('game.end') }}</UiButton>
        <UiButton variant="quiet" @click="ending = false">{{ t('lobby.manage.cancel') }}</UiButton>
      </div>
    </UiSheet>
  </section>
</template>

<style scoped>
.layout {
  display: grid;
  gap: var(--space-4);
}

.actions {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding: var(--space-3) 0 max(var(--space-3), env(safe-area-inset-bottom));
  border-top: 1px solid var(--ink);
  background: var(--paper);
}

.who-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.who {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.status {
  color: var(--ink-2);
}

.note {
  margin-top: var(--space-2);
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.tools {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--rule);
}

.confirm {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

@media (min-width: 60rem) {
  .layout {
    grid-template-columns: minmax(0, 46rem) minmax(16rem, 1fr);
    align-items: start;
  }

  .side :deep(.rosters) {
    border-top: 0;
    padding-top: 0;
  }
}
</style>

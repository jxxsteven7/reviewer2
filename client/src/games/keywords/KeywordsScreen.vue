<script setup lang="ts">
import { formatCode, type KeywordsView, type RoomView } from '@reviewer2/shared';
import { computed, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import MatchResults from '../../core/components/MatchResults.vue';
import MatchTable from '../../core/components/MatchTable.vue';
import PlayerName from '../../core/components/PlayerName.vue';
import QrCode from '../../core/components/QrCode.vue';
import StreakNotices from '../../core/components/StreakNotices.vue';
import { HTML_LANG } from '../../core/i18n';
import { roomLink } from '../../core/room';
import ClueLog from './ClueLog.vue';
import DecisionLetter from './DecisionLetter.vue';
import KeywordsBoard from './KeywordsBoard.vue';
import PausedNotice from './PausedNotice.vue';
import TurnStrip from './TurnStrip.vue';
import { useKeywords } from './useKeywords';
import { useDeadlineHeroes } from './useDeadlineHeroes';
import { useGroupCalls } from './useGroupCalls';
import { useMissedDeadlines } from './useMissedDeadlines';
import { useTurnedCard } from './useTurnedCard';

// The room on a big screen. In the waiting room: how to join, and who sits where. During the
// game: the board as spectators see it, with the turn and the clue log. A screen never gets the
// key, so it can stay on the wall for everyone. A match's table, or its ranking, is shown too, and
// so are the winning streaks that a game has just brought players to, for the room to cheer, a PI
// who misses the deadline for a clue, for the room to tease (useMissedDeadlines.ts), a deadline
// hero, for the room to cheer (useDeadlineHeroes.ts), and a group whose card brings it a title
// (useGroupCalls.ts).
const props = defineProps<{ room: RoomView }>();
const { t } = useI18n();
const { data, groups, spectators } = useKeywords(toRef(props, 'room'));
const link = computed(() => roomLink(props.room.code));
const number = computed(() => formatCode(props.room.code));
const game = computed(() => data.value.game as KeywordsView | null);
useMissedDeadlines(
  game,
  computed(() => props.room.players),
);
useDeadlineHeroes(
  game,
  computed(() => props.room.players),
);
useGroupCalls(game);
// A card revealed in front of the screen turns over on it, as on the players' boards.
const turned = useTurnedCard(game);
</script>

<template>
  <section v-if="room.phase === 'lobby' || !game" class="screen">
    <div class="join">
      <QrCode :text="link" :label="t('room.qrHint', { code: number })" />
      <p class="code num">{{ number }}</p>
      <p class="hint">{{ t('room.qrHint', { code: number }) }}</p>
    </div>
    <div class="people">
      <p class="kicker">{{ t('home.games.keywords.name') }} &middot; {{ t('lobby.kicker') }}</p>
      <section v-for="group in groups" :key="group.team" class="group" :class="group.team">
        <h2>{{ t(`lobby.group.${group.team}`) }}</h2>
        <p class="role">{{ t('lobby.roles.captain') }}</p>
        <PlayerName v-if="group.captain" :player="group.captain" :me="false" :chair="false" />
        <p v-else class="vacant">{{ t('lobby.vacant') }}</p>
        <p class="role">{{ t('lobby.roles.guesser') }}</p>
        <ul>
          <li v-for="player in group.guessers" :key="player.id">
            <PlayerName :player="player" :me="false" :chair="false" />
          </li>
        </ul>
      </section>
      <p class="role">{{ t('lobby.roles.spectator') }} &middot; {{ spectators.length }}</p>
      <template v-if="room.match">
        <MatchResults v-if="room.match.status !== 'on'" :room="room" />
        <MatchTable v-else :room="room" :endable="false" />
      </template>
    </div>
  </section>

  <section v-else class="screen-game">
    <DecisionLetter
      v-if="game.result"
      class="letters-row"
      :game="game"
      :side="null"
      :is-chair="false"
      :match="room.match"
      compact
    />
    <StreakNotices :room="room" large />
    <div class="main" :class="{ over: game.result }">
      <TurnStrip v-if="!game.result" :game="game" :guess-rule="data.settings.guessRule" :groups="groups" />
      <PausedNotice v-if="game.paused" large />
      <KeywordsBoard
        v-else
        :cards="game.cards"
        :selectable="false"
        :selected="null"
        :turned="turned"
        :lang="HTML_LANG[room.language]"
        large
      />
    </div>
    <aside class="side">
      <div class="join small">
        <QrCode :text="link" :label="t('room.qrHint', { code: number })" />
        <p class="code num">{{ number }}</p>
      </div>
      <template v-if="room.match">
        <MatchResults v-if="room.match.status !== 'on'" :room="room" />
        <MatchTable v-else :room="room" :endable="false" />
      </template>
      <ClueLog :game="game" />
    </aside>
  </section>
</template>

<style scoped>
.screen {
  display: grid;
  gap: var(--space-6);
  padding: var(--space-5) 0;
}

.join {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-5);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
  text-align: center;
}

.join :deep(.qr) {
  max-width: 20rem;
}

.join.small {
  padding: var(--space-4);
}

.join.small :deep(.qr) {
  max-width: 10rem;
}

.code {
  font-size: var(--text-3xl);
  font-weight: var(--weight-display);
  letter-spacing: 0.06em;
}

.hint {
  font-weight: var(--weight-bold);
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

.group {
  padding: var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

h2 {
  font-size: var(--text-2xl);
}

.group.red h2 {
  color: var(--red-deep);
}

.group.blue h2 {
  color: var(--blue-deep);
}

.role {
  margin-top: var(--space-2);
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-black);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.vacant {
  color: var(--ink-2);
  font-weight: var(--weight-bold);
}

.screen-game {
  display: grid;
  gap: var(--space-5);
  padding-bottom: var(--space-5);
}

/* The whole board fits on the screen: five rows of cards that are 6/7 as tall as they are wide,
   under the masthead and the turn strip. At the end, the two decision letters take the strip's
   place, side by side above the board and the clue log, and the board makes room for them. */
.screen-game .main {
  width: min(100%, calc((100vh - 18rem) * 1.15));
  width: min(100%, calc((100dvh - 18rem) * 1.15));
}

.screen-game .main.over {
  width: min(100%, calc((100vh - 30rem) * 1.15));
  width: min(100%, calc((100dvh - 30rem) * 1.15));
}

.letters-row,
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
    grid-template-columns: minmax(0, 1fr) 20rem;
    align-items: start;
  }
}
</style>

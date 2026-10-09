<script setup lang="ts">
import { formatCode, type KeywordsView, type RoomView } from '@reviewer2/shared';
import { computed, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import PlayerName from '../../core/components/PlayerName.vue';
import QrCode from '../../core/components/QrCode.vue';
import { HTML_LANG } from '../../core/i18n';
import { roomLink } from '../../core/room';
import ClueLog from './ClueLog.vue';
import DecisionLetter from './DecisionLetter.vue';
import KeywordsBoard from './KeywordsBoard.vue';
import TurnStrip from './TurnStrip.vue';
import { useKeywords } from './useKeywords';

// The room on a big screen. In the waiting room: how to join, and who sits where. During the
// game: the board as spectators see it, with the turn and the clue log. A screen never gets the
// key, so it can stay on the wall for everyone.
const props = defineProps<{ room: RoomView }>();
const { t } = useI18n();
const { data, groups, spectators } = useKeywords(toRef(props, 'room'));
const link = computed(() => roomLink(props.room.code));
const number = computed(() => formatCode(props.room.code));
const game = computed(() => data.value.game as KeywordsView | null);
</script>

<template>
  <section v-if="room.phase === 'lobby' || !game" class="screen">
    <div class="join">
      <QrCode :text="link" :label="t('room.qrHint', { code: number })" />
      <p class="code mono">{{ number }}</p>
      <p class="hint">{{ t('room.qrHint', { code: number }) }}</p>
    </div>
    <div class="people">
      <p class="kicker">{{ t('home.games.keywords.name') }} &middot; {{ t('lobby.kicker') }}</p>
      <section v-for="group in groups" :key="group.team" class="group" :class="group.team">
        <h2>{{ t(`lobby.group.${group.team}`) }}</h2>
        <p class="role">{{ t('lobby.roles.captain') }}</p>
        <PlayerName v-if="group.captain" :player="group.captain" :me="false" :chair="false" :manageable="false" />
        <p v-else class="vacant">{{ t('lobby.vacant') }}</p>
        <p class="role">{{ t('lobby.roles.guesser') }}</p>
        <ul>
          <li v-for="player in group.guessers" :key="player.id">
            <PlayerName :player="player" :me="false" :chair="false" :manageable="false" />
          </li>
        </ul>
      </section>
      <p class="role">{{ t('lobby.roles.spectator') }} &middot; {{ spectators.length }}</p>
    </div>
  </section>

  <section v-else class="screen-game">
    <DecisionLetter v-if="game.result" class="letters-row" :game="game" :side="null" :is-chair="false" compact />
    <div class="main" :class="{ over: game.result }">
      <TurnStrip v-if="!game.result" :game="game" :guess-rule="data.settings.guessRule" />
      <KeywordsBoard :cards="game.cards" :selectable="false" :selected="null" :lang="HTML_LANG[room.language]" large />
    </div>
    <aside class="side">
      <div class="join small">
        <QrCode :text="link" :label="t('room.qrHint', { code: number })" />
        <p class="mono">{{ number }}</p>
      </div>
      <ClueLog :game="game" />
    </aside>
  </section>
</template>

<style scoped>
.screen {
  display: grid;
  gap: var(--space-7);
  padding: var(--space-6) 0;
}

.join {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  text-align: center;
}

.join :deep(.qr) {
  max-width: 20rem;
}

.join.small :deep(.qr) {
  max-width: 9rem;
}

.code {
  font-size: var(--text-3xl);
  letter-spacing: 0.06em;
}

.hint {
  color: var(--ink-2);
}

.group {
  margin-top: var(--space-4);
  padding-left: var(--space-3);
  border-left: 3px solid var(--rule);
}

.group.red {
  border-left-color: var(--red);
}

.group.blue {
  border-left-color: var(--blue);
}

h2 {
  font-size: var(--text-xl);
}

.role {
  margin-top: var(--space-2);
  color: var(--ink-3);
  font-size: var(--text-sm);
  font-variant-caps: all-small-caps;
  letter-spacing: 0.06em;
}

ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.vacant {
  color: var(--ink-3);
}

.vacant:lang(en) {
  font-style: italic;
}

.screen-game {
  display: grid;
  gap: var(--space-5);
  padding-bottom: var(--space-5);
}

/* The whole board fits on the screen: five rows of cards that are 4/5 as tall as they are wide,
   under the masthead and the turn strip. At the end, the two decision letters take the strip's
   place, side by side above the board and the clue log, and the board makes room for them. */
.screen-game .main {
  width: min(100%, calc((100vh - 15rem) * 1.25));
  width: min(100%, calc((100dvh - 15rem) * 1.25));
}

.screen-game .main.over {
  width: min(100%, calc((100vh - 28rem) * 1.25));
  width: min(100%, calc((100dvh - 28rem) * 1.25));
}

.letters-row {
  grid-column: 1 / -1;
  margin-bottom: 0;
}

@media (min-width: 60rem) {
  .screen {
    grid-template-columns: auto 1fr;
    align-items: start;
  }

  .screen-game {
    grid-template-columns: minmax(0, 1fr) 18rem;
    align-items: start;
  }
}
</style>

<script setup lang="ts">
import {
  SPECTATOR,
  type ClueCount,
  type KeywordsScoreDetail,
  type KeywordsView,
  type RoomView,
} from '@reviewer2/shared';
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import EmoteButton from '../../core/components/EmoteButton.vue';
import MatchResults from '../../core/components/MatchResults.vue';
import MatchTable from '../../core/components/MatchTable.vue';
import UiButton from '../../core/components/UiButton.vue';
import UiSheet from '../../core/components/UiSheet.vue';
import { HTML_LANG } from '../../core/i18n';
import { act, reconnecting } from '../../core/socket';
import { useBusy } from '../../core/useBusy';
import { useMediaQuery } from '../../core/useMediaQuery';
import ClockBar from './ClockBar.vue';
import ClueLog from './ClueLog.vue';
import CluePanel from './CluePanel.vue';
import DecisionLetter from './DecisionLetter.vue';
import GameRosters from './GameRosters.vue';
import GroupChat from './GroupChat.vue';
import GuessBar from './GuessBar.vue';
import KeywordsBoard from './KeywordsBoard.vue';
import RoleBanner from './RoleBanner.vue';
import RulesSheet from './RulesSheet.vue';
import TurnStrip from './TurnStrip.vue';
import { useKeywords, type Chooser } from './useKeywords';

// A game in progress, and its result. The banner that says what is going on for the viewer, the
// turn strip, the clock, the board and what the viewer can do now come first. On a wide screen the
// groups stand on the left of the board and the clue log on its right; on a phone they open as
// sheets from the two buttons in the bar under the board, so that the board comes first.
//
// In a match, its table sits beside the board while the game is on, above the groups on a wide
// screen. Once the game has ended, the table follows the letters, with where each player's
// points came from, or the final ranking does when the match is over.
const props = defineProps<{ room: RoomView }>();
const { t } = useI18n();
const room = toRef(props, 'room');
const { data, mySeat, mySide, isChair } = useKeywords(room);
const match = computed(() => room.value.match);

// Where a player's points in a game came from, in a few words.
function describe(detail: unknown): string {
  const { found, won, wrong, reviewer2 } = detail as KeywordsScoreDetail;
  return [
    found > 0 ? t('game.scoreDetail.found', { count: found }) : null,
    won ? t('game.scoreDetail.won') : null,
    wrong > 0 ? t('game.scoreDetail.wrong', { count: wrong }) : null,
    reviewer2 > 0 ? t('game.scoreDetail.reviewer2') : null,
  ]
    .filter((part) => part !== null)
    .join(' \u00b7 ');
}
const { busy, run } = useBusy();

// The width from which the groups and the clue log stand beside the board; the same as in the
// style below. A sheet that is open when the screen gets wide, as when a tablet turns, closes:
// the columns show the same thing, and it must not lie over the page when the screen narrows
// again.
const wide = useMediaQuery('(min-width: 64rem)');
const panel = ref<'groups' | 'log' | null>(null);
watch(wide, () => {
  panel.value = null;
});

const game = computed(() => data.value.game as KeywordsView);
const moment = computed(() => ({ gameId: game.value.gameId, turn: game.value.turn }));
const myTurn = computed(() => mySeat.value?.team === game.value.team);
const canClue = computed(() => game.value.phase === 'clue' && myTurn.value && mySeat.value?.role === 'captain');
const canGuess = computed(() => game.value.phase === 'guess' && myTurn.value && mySeat.value?.role === 'guesser');
const group = computed(() => t(`lobby.group.${game.value.team}`));

// The choices of cards come from the server, which shows them to the group whose turn it is:
// the viewer's own choice is marked, and the others' avatars hang on the corner of a card. A
// reveal, or the end of the turn, clears them all. A choice whose player has just left the room
// is left out rather than shown without a name.
const selections = computed(() => game.value.selections ?? []);
const selected = computed(() => selections.value.find((choice) => choice.player === room.value.me)?.card ?? null);
const playerOf = (id: string): Chooser | undefined => room.value.players.find((player) => player.id === id);
const choosers = computed(() =>
  game.value.cards.map((_, index) =>
    selections.value
      .filter((choice) => choice.card === index && choice.player !== room.value.me)
      .flatMap((choice) => playerOf(choice.player) ?? []),
  ),
);

// Tapping a card chooses it, tapping it again takes the choice back, and tapping another one
// moves the choice there. Revealing takes a second step, in the guess bar.
//
// The viewer's own choice shows at once, before the server's snapshot brings it back. Otherwise
// a tap on "Reveal" right after a tap on a card, on a slow connection, would reveal the card
// chosen before, and a second tap on the same card would choose it again instead of taking the
// choice back. The server sends its snapshot before it answers, so once every choice on its way
// has been answered, `selected` is the server's view again.
const pending = ref<{ card: number | null } | null>(null);
let choicesOnTheWay = 0;
const choice = computed(() => (pending.value ? pending.value.card : selected.value));

async function choose(card: number) {
  const next = choice.value === card ? null : card;
  pending.value = { card: next };
  choicesOnTheWay += 1;
  await act('keywords:select', { ...moment.value, card: next });
  choicesOnTheWay -= 1;
  if (choicesOnTheWay === 0) pending.value = null;
}

// The moves that change the game go one at a time, so that a double tap can't send one twice.
const giveClue = (word: string, count: ClueCount) => run(() => act('keywords:clue', { ...moment.value, word, count }));
const reveal = (card: number) => run(() => act('keywords:reveal', { ...moment.value, card }));
const pass = () => run(() => act('keywords:pass', moment.value));
const again = () => run(() => act('room:again', { gameId: game.value.gameId }));

const ending = ref(false);
async function withdraw() {
  ending.value = false;
  await run(() => act('room:end', { gameId: game.value.gameId }));
}

// A game that ends while the chair is still deciding leaves nothing to end.
watch(
  () => game.value.result,
  (result) => {
    if (result) ending.value = false;
  },
);

const whoAmI = computed(() => {
  const seat = mySeat.value;
  if (!seat || seat.role === 'spectator') return t('game.you.spectator');
  return t(`game.you.${seat.role}`, { group: t(`lobby.group.${seat.team}`) });
});

// What the others in the group have chosen, as a sentence after the viewer's seat: the same
// choices that hang on the cards, which the server sends to the group alone.
const chosenByOthers = computed(() =>
  selections.value
    .filter((choice) => choice.player !== room.value.me)
    .flatMap((choice) => {
      const player = playerOf(choice.player);
      const card = game.value.cards[choice.card];
      return player && card ? [t('game.choice', { name: player.name, word: card.word })] : [];
    })
    .join(t('game.choiceJoin')),
);
</script>

<template>
  <section class="keywords-game">
    <RoleBanner :seat="mySeat ?? SPECTATOR" :game="game">
      <EmoteButton />
    </RoleBanner>
    <DecisionLetter
      v-if="game.result"
      :game="game"
      :side="mySide"
      :is-chair="isChair"
      :busy="busy"
      :match="match"
      @again="again"
    />
    <TurnStrip v-else :game="game" :guess-rule="data.settings.guessRule" clock-apart />
    <ClockBar
      v-if="!game.result && game.clock"
      :clock="game.clock"
      class="sticky-clock"
      :class="{ 'below-banner': reconnecting }"
    />
    <template v-if="game.result && match">
      <MatchResults v-if="match.status !== 'on'" :room="room" />
      <MatchTable v-else :room="room" :describe="describe" class="between">
        <p class="scoring">{{ t('game.scoring') }}</p>
      </MatchTable>
    </template>

    <div class="layout">
      <div class="main">
        <KeywordsBoard
          :cards="game.cards"
          :selectable="canGuess"
          :selected="choice"
          :choosers="choosers"
          :lang="HTML_LANG[room.language]"
          @select="choose"
        />
        <div class="actions">
          <div class="who-row">
            <div class="me">
              <p class="who">
                {{ whoAmI }}
                <template v-if="data.joinsNext"> &middot; {{ t('match.joinsNext') }}</template>
              </p>
              <p v-if="chosenByOthers" class="choices">{{ chosenByOthers }}</p>
            </div>
            <GroupChat :room="room" />
          </div>
          <CluePanel
            v-if="canClue"
            :game="game"
            :settings="data.settings"
            :language="room.language"
            :busy="busy"
            @give="giveClue"
          />
          <GuessBar v-else-if="canGuess" :game="game" :selected="choice" :busy="busy" @reveal="reveal" @pass="pass" />
          <p v-else-if="!game.result" class="status">
            {{ game.phase === 'clue' ? t('game.waitClue', { group }) : t('game.waitGuess', { group }) }}
          </p>
          <div v-if="!wide" class="panels">
            <UiButton class="open-groups" size="small" @click="panel = 'groups'">{{ t('game.groups') }}</UiButton>
            <UiButton class="open-log" size="small" @click="panel = 'log'">{{ t('game.log') }}</UiButton>
          </div>
        </div>
        <p v-if="!game.result" class="note">{{ t('game.keyNote') }}</p>
      </div>

      <aside class="side sections">
        <MatchTable v-if="match && !game.result" :room="room">
          <p class="scoring">{{ t('game.scoring') }}</p>
        </MatchTable>
        <GameRosters v-if="wide" :room="room" />
        <ClueLog v-if="wide" :game="game" />
        <div class="tools">
          <RulesSheet :settings="data.settings" :language="room.language" />
          <UiButton v-if="isChair && !game.result" variant="quiet" size="small" @click="ending = true">
            {{ t('game.end') }}
          </UiButton>
        </div>
      </aside>
    </div>

    <!-- On a phone, the groups and the clue log are sheets, whose title says what they are. -->
    <UiSheet v-if="!wide" :open="panel === 'groups'" :title="t('game.groups')" @close="panel = null">
      <GameRosters :room="room" class="in-sheet" />
    </UiSheet>
    <UiSheet v-if="!wide" :open="panel === 'log'" :title="t('game.log')" @close="panel = null">
      <ClueLog :game="game" class="in-sheet" />
    </UiSheet>

    <UiSheet :open="ending" :title="t('game.end')" @close="ending = false">
      <div class="confirm">
        <p>{{ t('game.endConfirm') }}</p>
        <UiButton variant="danger" :disabled="busy" @click="withdraw">{{ t('game.end') }}</UiButton>
        <UiButton variant="quiet" @click="ending = false">{{ t('lobby.manage.cancel') }}</UiButton>
      </div>
    </UiSheet>
  </section>
</template>

<style scoped>
.layout {
  display: grid;
  gap: var(--space-4);
  margin-top: var(--space-3);
}

.main {
  min-width: 0;
}

/* The clock stays at the top of the screen while the page scrolls, and under the banner while the
   page reconnects. It is kept thin, and its background reaches the edges of the screen, so that
   no card shows through it beside the column. */
.sticky-clock {
  position: sticky;
  top: 0;
  z-index: 5;
  margin-top: var(--space-2);
  padding: var(--space-1) 0;
  background: var(--bg);
  box-shadow: 0 0 0 100vmax var(--bg);
  clip-path: inset(0 -100vmax);
}

.sticky-clock :deep(.seconds) {
  min-height: 32px;
}

.sticky-clock.below-banner {
  top: var(--banner-height);
}

/* During a game the page doesn't anchor its scroll position: when something above the board
   changes, such as the clue that appears in the turn strip, WebKit's scroll anchoring moves the
   page a moment later, taking the card from under a tap that is on its way. Whatever the page
   scrolls or focuses into view, such as a card reached with the keyboard, stays below the clock
   and the banner. The page is what scrolls, so the rules go on the root. */
:global(html:has(.keywords-game)) {
  overflow-anchor: none;
}

:global(html:has(.sticky-clock)) {
  scroll-padding-top: calc(var(--banner-height) + 3rem);
}

/* The bar under the board: the seat line on one row, the chat and the panel buttons on the next,
   and then what the viewer can do. The rows are drawn from the elements as they are, through
   display: contents. */
.actions {
  display: grid;
  grid-template-areas:
    'me me me .'
    'chat groups log .'
    'panel panel panel panel';
  grid-template-columns: auto auto auto minmax(0, 1fr);
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding: var(--space-2) 0;
}

.who-row,
.panels {
  display: contents;
}

.me {
  grid-area: me;
}

.who-row > :deep(.button) {
  grid-area: chat;
}

.open-groups {
  grid-area: groups;
}

.open-log {
  grid-area: log;
}

.actions > :deep(.clue-panel),
.actions > :deep(.guess-bar),
.status {
  grid-area: panel;
}

.who {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.choices {
  font-size: var(--text-sm);
}

.status {
  font-weight: var(--weight-bold);
}

.note {
  margin-top: var(--space-2);
  color: var(--ink-2);
  font-size: var(--text-xs);
}

.side {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* Inside a sheet, the sheet's frame and title do: it says "Groups" or "Clue log" already. */
.in-sheet.in-sheet {
  padding: 0;
  border: 0;
  box-shadow: none;
}

.in-sheet :deep(.section-title) {
  display: none;
}

.tools {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.scoring {
  color: var(--ink-2);
  font-size: var(--text-xs);
}

.between {
  margin-bottom: var(--space-4);
}

.confirm {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* Three columns: the groups, with a match's table above them, the board, and the clue log with
   the tools under it. The rows have no gap of their own, so that an empty table row takes no
   room; the items keep their distance with margins. */
@media (min-width: 64rem) {
  .layout {
    grid-template-areas:
      'table main log'
      'groups main log'
      'groups main tools';
    grid-template-columns: 16rem minmax(0, 1fr) 18rem;
    grid-template-rows: auto auto 1fr;
    gap: 0 var(--space-5);
    align-items: start;
  }

  .side > :deep(.match-table) {
    grid-area: table;
    margin-bottom: var(--space-5);
  }

  .side > :deep(.clue-log) {
    margin-bottom: var(--space-5);
  }

  .main {
    grid-area: main;
  }

  .side {
    display: contents;
  }

  .side > :deep(.rosters) {
    grid-area: groups;
  }

  .side > :deep(.clue-log) {
    grid-area: log;
  }

  .tools {
    grid-area: tools;
  }
}
</style>

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
import StreakNotices from '../../core/components/StreakNotices.vue';
import UiButton from '../../core/components/UiButton.vue';
import UiSheet from '../../core/components/UiSheet.vue';
import { HTML_LANG } from '../../core/i18n';
import { points } from '../../core/points';
import { act, reconnecting } from '../../core/socket';
import { toast } from '../../core/toast';
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
import PausedNotice from './PausedNotice.vue';
import { replayOf } from './replay';
import ReplayViewer from './ReplayViewer.vue';
import RoleBanner from './RoleBanner.vue';
import RulesSheet from './RulesSheet.vue';
import TurnStrip from './TurnStrip.vue';
import { useKeywords, type Chooser } from './useKeywords';

// A game in progress, and its result. The banner that says what is going on for the viewer, the
// turn strip, the clock, the board and what the viewer can do now come first. On a wide screen the
// group chat, open all the time, and the groups stand on the left of the board, and the clue log
// with the tools on its right; on a phone the groups and the clue log open as sheets from the two
// buttons in the bar under the board, so that the board comes first, and the chat from a third.
//
// While the chair has paused the game, a notice stands in place of the board, with the way to
// resume for the chair, and the clock stands still. A group whose turn it is may ask for an
// extension, where the room allows one. Once the game has ended, the review opens the replay.
//
// In a match, its table stands under the board while the game is on, folded to a line with the
// progress and the viewer's place, since it is seldom looked at then. Once the game has ended, the
// table follows the letters, with where each player's points came from, or the final ranking does
// when the match is over. The streaks that the game brought the players to come right after the
// letters, before the match's table; their notices are on the page from the start, out of sight,
// so that a screen reader is told of them.
const props = defineProps<{ room: RoomView }>();
const { t } = useI18n();
const room = toRef(props, 'room');
const { data, mySeat, mySide, isChair } = useKeywords(room);
const match = computed(() => room.value.match);

// The line that the folded table shows during the game: the match's progress, and the viewer's
// place and total once they have one, which takes a scored game. The total's size picks the
// plural of "point", for the languages that have one.
const standing = computed(
  () => match.value?.standings.find((line) => line.playerId !== null && line.playerId === room.value.me) ?? null,
);
const matchSummary = computed(() => {
  if (!match.value) return '';
  const parts = [
    t('match.progressTitle'),
    t('match.progress', { game: match.value.game, games: match.value.rules.games }),
  ];
  if (standing.value && standing.value.rank !== null) {
    const { rank, total } = standing.value;
    parts.push(t('match.yourStanding', { rank, points: points(total) }, Math.abs(total)));
  }
  return parts.join(' \u00b7 ');
});

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
const paused = computed(() => game.value.paused);
const myTurn = computed(() => mySeat.value?.team === game.value.team);
const canClue = computed(
  () => game.value.phase === 'clue' && myTurn.value && mySeat.value?.role === 'captain' && !paused.value,
);
const canGuess = computed(
  () => game.value.phase === 'guess' && myTurn.value && mySeat.value?.role === 'guesser' && !paused.value,
);
const group = computed(() => t(`lobby.group.${game.value.team}`));
// Whether the viewer may ask for their group's extension now: the room allows one, the phase has
// a time limit, it is the viewer's move, and the group hasn't had one in this game.
const canExtend = computed(
  () =>
    data.value.settings.extensions &&
    game.value.clock !== null &&
    (canClue.value || canGuess.value) &&
    !game.value.extended[game.value.team],
);

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
const extend = () => run(() => act('keywords:extend', moment.value));
const pause = () => run(() => act('keywords:pause', { gameId: game.value.gameId }));
const resume = () => run(() => act('keywords:resume', { gameId: game.value.gameId }));
const again = () => run(() => act('room:again', { gameId: game.value.gameId }));

// Everyone hears of an extension as it comes: the newest event, when it is one.
watch(
  () => game.value.events.length,
  (count, before) => {
    const event = game.value.events.at(-1);
    if (count > before && event?.kind === 'extended' && event.team) {
      toast('game.extended', { group: t(`lobby.group.${event.team}`) });
    }
  },
);

// The review of the game that has ended, step by step, for everyone who sees the result.
const reviewing = ref(false);
const replay = computed(() => replayOf(game.value, room.value.language, room.value.players));

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
      :frozen="paused"
      class="sticky-clock"
      :class="{ 'below-banner': reconnecting }"
    />
    <StreakNotices :room="room" />
    <template v-if="game.result && match">
      <MatchResults v-if="match.status !== 'on'" :room="room" />
      <MatchTable v-else :room="room" :describe="describe" class="between">
        <p class="scoring">{{ t('game.scoring') }}</p>
      </MatchTable>
    </template>

    <div class="layout">
      <div class="main">
        <PausedNotice v-if="paused">
          <template v-if="isChair">
            <UiButton variant="primary" :disabled="busy" @click="resume">{{ t('game.resume') }}</UiButton>
            <p class="paused-note">{{ t('game.pausedResume') }}</p>
          </template>
        </PausedNotice>
        <KeywordsBoard
          v-else
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
            <GroupChat v-if="!wide" :room="room" />
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
          <p v-else-if="!game.result && !paused" class="status">
            {{ game.phase === 'clue' ? t('game.waitClue', { group }) : t('game.waitGuess', { group }) }}
          </p>
          <UiButton v-if="canExtend" class="extend" size="small" :disabled="busy" @click="extend">
            {{ t('game.extend') }}
          </UiButton>
          <div v-if="!wide" class="panels">
            <UiButton class="open-groups" size="small" @click="panel = 'groups'">{{ t('game.groups') }}</UiButton>
            <UiButton class="open-log" size="small" @click="panel = 'log'">{{ t('game.log') }}</UiButton>
          </div>
        </div>
        <p v-if="!game.result" class="note">{{ t('game.keyNote') }}</p>
        <details v-if="match && !game.result" class="match-fold">
          <summary>{{ matchSummary }}</summary>
          <MatchTable :room="room">
            <p class="scoring">{{ t('game.scoring') }}</p>
          </MatchTable>
        </details>
      </div>

      <aside class="side">
        <div class="column">
          <GroupChat v-if="wide" :room="room" panel />
          <GameRosters v-if="wide" :room="room" />
        </div>
        <div class="column">
          <ClueLog v-if="wide" :game="game" />
          <div class="tools">
            <RulesSheet :settings="data.settings" :language="room.language" :custom-words="room.customWordCount" />
            <UiButton v-if="replay" class="review" variant="quiet" size="small" @click="reviewing = true">
              {{ t('game.review') }}
            </UiButton>
            <UiButton v-if="isChair && !game.result && !paused" variant="quiet" size="small" @click="pause">
              {{ t('game.pause') }}
            </UiButton>
            <UiButton v-if="isChair && !game.result" variant="quiet" size="small" @click="ending = true">
              {{ t('game.end') }}
            </UiButton>
          </div>
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

    <UiSheet :open="reviewing" :title="t('replay.title')" @close="reviewing = false">
      <ReplayViewer v-if="replay" :replay="replay" />
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
    'panel panel panel panel'
    'extend extend extend extend';
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

.actions > :deep(.extend) {
  grid-area: extend;
  justify-self: start;
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

/* On a phone the columns below are no boxes of their own: the tools follow the board. */
.column {
  display: contents;
}

/* A match's table during the game, folded to a line with the progress and the viewer's place: it
   is seldom looked at while the game is on. Open, the table loses its own frame and header, which
   the fold has. */
.match-fold {
  margin-top: var(--space-4);
  padding: 0 var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

.match-fold summary {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 48px;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  list-style: none;
  cursor: pointer;
}

.match-fold summary::-webkit-details-marker {
  display: none;
}

.match-fold summary::before {
  content: '\25B8';
  font-size: var(--text-xs);
}

.match-fold[open] summary::before {
  content: '\25BE';
}

.match-fold > :deep(.match-table) {
  padding: 0 0 var(--space-4);
  border: 0;
  box-shadow: none;
}

.match-fold :deep(.match-table > header) {
  display: none;
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

/* Three columns: the chat and the groups on the left, the board in the middle, and the clue log
   with the tools on the right. Each column stacks its panels from the top, whatever the others
   hold, so that no column has empty space of its own. The side columns take 18 rem where the page
   is wide enough, which lets a five-character name and its rank share a line on a sticker and
   gives the chat's input some width, but never more than leaves the board 26 rem: at 64 rem both
   columns are 16 rem, the right one 2 rem narrower than it was, and the board 2 rem wider. */
@media (min-width: 64rem) {
  .layout {
    --side: min(18rem, calc((100% - 26rem - 2 * var(--space-5)) / 2));

    grid-template-areas: 'left main right';
    grid-template-columns: var(--side) minmax(0, 1fr) var(--side);
    gap: 0 var(--space-5);
    align-items: start;
  }

  .main {
    grid-area: main;
  }

  .side {
    display: contents;
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .column:first-child {
    grid-area: left;
  }

  .column:last-child {
    grid-area: right;
  }
}
</style>

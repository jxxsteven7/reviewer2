<script setup lang="ts">
import { textLength } from '@reviewer2/shared';
import { checkDescription, type ImpostorView, type LineProblem, type SeatView } from '@reviewer2/shared/impostor';
import { computed, ref, toRef, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ClockBar from '../../core/components/ClockBar.vue';
import DuoNotices from '../../core/components/DuoNotices.vue';
import EmoteButton from '../../core/components/EmoteButton.vue';
import RatingCard from '../../core/components/RatingCard.vue';
import StreakNotices from '../../core/components/StreakNotices.vue';
import UiButton from '../../core/components/UiButton.vue';
import UiSheet from '../../core/components/UiSheet.vue';
import { errorKey } from '../../core/errors';
import type { ShownRoom } from '../../core/room';
import { act, reconnecting } from '../../core/socket';
import { toast } from '../../core/toast';
import { useBusy } from '../../core/useBusy';
import { useChatLine } from '../../core/useChatLine';
import { useMediaQuery } from '../../core/useMediaQuery';
import { useStickyHeight } from '../../core/useStickyHeight';
import { useStuck } from '../../core/useStuck';
import AgentGuess from './AgentGuess.vue';
import ImpostorLetter from './ImpostorLetter.vue';
import ImpostorRules from './ImpostorRules.vue';
import ImpostorStrip from './ImpostorStrip.vue';
import JudgeSheet from './JudgeSheet.vue';
import LineBox from './LineBox.vue';
import OffField from './OffField.vue';
import RevealList from './RevealList.vue';
import RoundLog from './RoundLog.vue';
import SeatCard from './SeatCard.vue';
import SeatPanel from './SeatPanel.vue';
import { newestLine, seatState } from './seats';
import { playerAt, useImpostor } from './useImpostor';

// A game of the hidden word game, and its result, in the room that every game has (docs/rules/
// display.md#a-games-room): the whose-turn strip, or the result's letter once the game is over, the
// clock in the bar that stays at the top of the screen, and the board, a card for each seat
// (SeatCard.vue), which in a vote are the choices, with one to abstain, the count of votes cast
// and the button that casts the viewer's. Under the board, the viewer's line when it is their turn
// to describe, or their guess of the students' word when they may make one; then the bar of
// buttons: the record of the rounds, how to play and, for those who are out, watch or set the
// words, the off-field chat, each a sheet. On a wide screen the record and the chat stand beside
// the board instead. Every number's avatar opens its panel (SeatPanel.vue), with its lines, the
// report and, for the chair, the way to remove whoever sits there; a report open in the room comes
// up as a sheet for everyone (JudgeSheet.vue).
//
// The reaction button is in the bar only while the viewer may react: not while they still play.
// Once the game is over: the guess of who the AI players were, where there is one (AgentGuess.vue),
// the streaks, who everyone was (RevealList.vue), the question of how the words were
// (RatingCard.vue), and the review, which opens the record of every round.
const props = defineProps<{ room: ShownRoom }>();
const { t } = useI18n();
const room = toRef(props, 'room');
const { data, isChair, setterId, isSetter } = useImpostor(room);
const { busy, run } = useBusy();

const game = computed(() => data.value.game as ImpostorView);
const over = computed(() => game.value.phase === 'over');
const me = computed(() => game.value.you);
const myNumber = computed(() => me.value?.number ?? null);
const mySeat = computed(() => game.value.seats.find((seat) => seat.number === myNumber.value) ?? null);
const alive = computed(() => mySeat.value?.fate === 'alive');
const seats = computed(() => [...game.value.seats].sort((a, b) => a.number - b.number));
// How many AI players the game has, which the strip says without saying who: AI players only ever
// sit to play.
const agents = computed(() => props.room.players.filter((player) => player.agent !== undefined).length);

// The name behind a seat, where the viewer may know it, but their own.
const nameAt = (seat: SeatView | null | undefined): string | null => {
  if (!seat || seat.number === myNumber.value) return null;
  return playerAt(seat, props.room.players)?.name ?? (seat.playerId && over.value ? t('replay.someone') : null);
};
const opened = ref<number | null>(null);
const openSeat = (number: number) => (opened.value = number);
const openedName = computed(() => nameAt(game.value.seats.find((seat) => seat.number === opened.value)));

// The width from which the record and the chat stand beside the board; the same as in the style
// below. A sheet that is open when the screen gets wide closes, as in the first game's room.
const wide = useMediaQuery('(min-width: 64rem)');
const sheet = ref<'log' | 'offField' | null>(null);
watch(wide, () => (sheet.value = null));
const clockBar = ref<HTMLElement | null>(null);
useStickyHeight(clockBar);
const stuck = useStuck(clockBar);

// The clock's period, which starts the bar over: each line, each vote and each report has its own.
const period = computed(() => {
  const { round, phase, speaker, ballots, report } = game.value;
  return report ? `report-${round}-${report.by}` : `${round}-${phase}-${speaker ?? 0}-${ballots.length}`;
});

// Describing: the viewer's turn, while no report holds the clock.
const myTurn = computed(
  () =>
    (game.value.phase === 'describe' || game.value.phase === 'tie') &&
    game.value.speaker !== null &&
    game.value.speaker === myNumber.value &&
    game.value.report === null,
);
const line = ref('');
const earlier = computed(() => game.value.lines.flatMap((one) => (one.text === null ? [] : [one.text])));
const lineCheck = computed(() =>
  checkDescription(
    line.value,
    me.value?.word ? { word: me.value.word } : null,
    earlier.value,
    data.value.settings.length,
  ),
);
function problemText(problem: LineProblem | null, match: string | null): string | undefined {
  if (problem === null || problem === 'line_empty') return undefined;
  if (problem === 'line_has_word') return t('games.impostor.describe.hasWord', { match: match ?? '' });
  if (problem === 'line_too_long') return t('games.impostor.describe.tooLong', { count: data.value.settings.length });
  return t(errorKey(problem));
}
const lineCount = computed(() =>
  t('games.impostor.describe.count', { count: textLength(lineCheck.value.text), max: data.value.settings.length }),
);
const describe = () =>
  run(async () => {
    const reply = await act('impostor:describe', {
      gameId: game.value.gameId,
      round: game.value.round,
      text: line.value,
    });
    if (reply.ok) line.value = '';
  });

// Voting: everyone still in the game at once, but in a revote the tied players, and nobody while a
// report is judged. The viewer's choice is theirs until they cast it, which is final.
const voting = computed(() => game.value.phase === 'vote' || game.value.phase === 'revote');
const mayVote = computed(
  () =>
    voting.value &&
    alive.value &&
    game.value.myVote === undefined &&
    game.value.report === null &&
    !(game.value.phase === 'revote' && myNumber.value !== null && game.value.tied.includes(myNumber.value)),
);
const choice = ref<number | 'abstain' | null>(null);
watch(
  () => `${game.value.gameId}-${game.value.round}-${game.value.phase}-${game.value.ballots.length}`,
  () => (choice.value = null),
);
const choosable = (seat: SeatView) =>
  mayVote.value && seat.number !== myNumber.value && game.value.candidates.includes(seat.number);
const voters = computed(
  () =>
    game.value.seats.filter(
      (seat) => seat.fate === 'alive' && !(game.value.phase === 'revote' && game.value.tied.includes(seat.number)),
    ).length,
);
const voteLabel = computed(() => {
  if (choice.value === null) return t('games.impostor.vote.choose');
  if (choice.value === 'abstain') return t('games.impostor.vote.abstain');
  return t('games.impostor.vote.submit', { number: choice.value });
});
const myVoteLine = computed(() => {
  const vote = game.value.myVote;
  if (!voting.value || vote === undefined) return null;
  return vote === null ? t('games.impostor.vote.abstained') : t('games.impostor.vote.voted', { number: vote });
});
const vote = () =>
  run(() =>
    act('impostor:vote', {
      gameId: game.value.gameId,
      round: game.value.round,
      number: choice.value === 'abstain' ? null : choice.value,
    }),
  );
const group = useId();

// The guess of the students' word, for a Reviewer 2 or the PI just voted out, where the room
// allows one (docs/games/impostor.md#coming-back).
const myComeback = computed(() => game.value.phase === 'comeback' && game.value.comeback === myNumber.value);
const guessText = ref('');
const comeback = (word: string | null) => run(() => act('impostor:comeback', { gameId: game.value.gameId, word }));

// Each vote is revealed to everyone at once: a toast says how it came out, and the record has who
// voted for whom.
watch(
  () => game.value.ballots.length,
  (count, before) => {
    const ballot = game.value.ballots.at(-1);
    if (!ballot || count <= before) return;
    if (ballot.out !== null) {
      const role = game.value.seats.find((seat) => seat.number === ballot.out)?.role;
      toast('games.impostor.toasts.out', {
        number: ballot.out,
        role: role ? t(`games.impostor.roles.${role}`) : '',
      });
    } else
      toast(
        ballot.tied.length > 1 && ballot.ballot === 'vote'
          ? 'games.impostor.toasts.tie'
          : 'games.impostor.toasts.nobody',
      );
  },
);

// A last guess of the students' word that was wrong is told to everyone, as the game goes on; a
// right one ends it, which the letter says.
watch(
  () => game.value.guesses.length,
  (count, before) => {
    const guess = game.value.guesses.at(-1);
    if (guess && count > before && !guess.correct) toast('games.impostor.toasts.wrongGuess', { number: guess.number });
  },
);

const mustAct = computed(
  () =>
    myTurn.value ||
    mayVote.value ||
    myComeback.value ||
    (game.value.report?.mayJudge === true && game.value.report.mine === null),
);

// The off-field chat, for whoever may read it, and the talk after the game.
const { draft: chatLine, sending, say } = useChatLine(game, 'impostor:say');
const readsOffField = computed(() => game.value.offField !== null);

const again = () => run(() => act('room:again', { gameId: game.value.gameId }));
const ending = ref(false);
async function withdraw() {
  ending.value = false;
  await run(() => act('room:end', { gameId: game.value.gameId }));
}
watch(over, (ended) => {
  if (ended) ending.value = false;
});
const rated = computed(() => (game.value.words ? `${game.value.words.student} / ${game.value.words.reviewer2}` : null));
</script>

<template>
  <section class="impostor-game">
    <ImpostorLetter v-if="over" :game="game" :is-chair="isChair" :busy="busy" @again="again" />
    <ImpostorStrip v-else :game="game" :setter="isSetter" :agents="agents" :must-act="mustAct" />
    <div
      v-if="(game.clock && !over) || data.mayEmote"
      ref="clockBar"
      class="sticky-clock"
      :class="{ 'below-banner': reconnecting, stuck }"
    >
      <ClockBar v-if="game.clock && !over" :clock="game.clock" :period="period" :mine="mustAct" />
      <EmoteButton v-if="data.mayEmote" />
    </div>

    <template v-if="over">
      <AgentGuess v-if="game.guess" :game="game" :open="openSeat" />
      <StreakNotices :room="room" />
      <DuoNotices :room="room" />
      <RevealList :game="game" :name-of="nameAt" :open="openSeat" />
      <RatingCard
        v-if="room.rating"
        :game-id="game.gameId"
        :rating="room.rating"
        :question="t('games.impostor.rating')"
        :rated="rated"
      />
    </template>

    <div class="layout">
      <div class="main">
        <div class="board" role="radiogroup" :aria-label="mayVote ? t('games.impostor.vote.title') : undefined">
          <SeatCard
            v-for="seat in seats"
            :key="seat.number"
            :seat="seat"
            :state="seatState(game, seat)"
            :line="over ? null : (newestLine(game.lines, game.round, seat.number) ?? null)"
            :name="nameAt(seat)"
            :mine="seat.number === myNumber"
            :choosable="choosable(seat)"
            :chosen="choice === seat.number"
            :grey="mayVote && !choosable(seat)"
            :group="group"
            :opens="() => openSeat(seat.number)"
            @choose="choice = $event"
          />
          <label v-if="mayVote" class="abstain-card" :class="{ chosen: choice === 'abstain' }">
            <input
              type="radio"
              class="sr-only"
              :name="group"
              :checked="choice === 'abstain'"
              @change="choice = 'abstain'"
            />
            <span class="abstain">{{ t('games.impostor.vote.abstain') }}</span>
            <span class="text">{{ t('games.impostor.vote.abstainNote') }}</span>
          </label>
        </div>

        <div class="actions">
          <template v-if="voting && !game.report">
            <p class="status">
              {{ t('games.impostor.vote.count', { voted: game.voted.length, voters }) }}
            </p>
            <UiButton v-if="mayVote" variant="primary" :disabled="busy || choice === null" @click="vote">
              {{ voteLabel }}
            </UiButton>
            <p v-else-if="myVoteLine" class="status">{{ myVoteLine }}</p>
          </template>
          <LineBox
            v-if="myTurn"
            v-model="line"
            :label="t('games.impostor.describe.label')"
            :action="t('games.impostor.describe.send')"
            :count="lineCount"
            :error="problemText(lineCheck.problem, lineCheck.match)"
            :ready="lineCheck.problem === null"
            :busy="busy"
            @send="describe"
          />
          <template v-if="myComeback">
            <LineBox
              v-model="guessText"
              :label="t('games.impostor.comeback.label')"
              :action="t('games.impostor.comeback.send')"
              :count="t('games.impostor.comeback.note')"
              :ready="guessText.trim() !== ''"
              :busy="busy"
              @send="comeback(guessText)"
            />
            <UiButton variant="quiet" size="small" :disabled="busy" @click="comeback(null)">
              {{ t('games.impostor.comeback.skip') }}
            </UiButton>
          </template>
          <div v-if="!wide" class="buttons">
            <UiButton size="small" @click="sheet = 'log'">
              {{ t(over ? 'games.impostor.buttons.review' : 'games.impostor.buttons.log') }}
            </UiButton>
            <ImpostorRules :settings="data.settings" :language="room.language" />
            <UiButton v-if="readsOffField" size="small" @click="sheet = 'offField'">
              {{ t(over ? 'games.impostor.buttons.talk' : 'games.impostor.buttons.offField') }}
            </UiButton>
          </div>
        </div>
      </div>

      <aside v-if="wide" class="side">
        <section v-if="readsOffField" class="panel chat">
          <h2 class="section-title">
            {{ t(over ? 'games.impostor.buttons.talk' : 'games.impostor.buttons.offField') }}
          </h2>
          <OffField
            v-model:draft="chatLine"
            :room="room"
            :game="game"
            :setter-id="setterId"
            :sending="sending"
            :open="openSeat"
            @send="say"
          />
        </section>
        <section class="panel">
          <h2 class="section-title">{{ t('games.impostor.buttons.log') }}</h2>
          <RoundLog :game="game" />
        </section>
        <div class="tools">
          <ImpostorRules :settings="data.settings" :language="room.language" />
        </div>
      </aside>
    </div>

    <div v-if="isChair && !over" class="foot">
      <UiButton variant="quiet" size="small" @click="ending = true">{{ t('game.end') }}</UiButton>
    </div>

    <UiSheet
      v-if="!wide"
      :open="sheet === 'log'"
      :title="t(over ? 'game.review' : 'games.impostor.buttons.log')"
      @close="sheet = null"
    >
      <RoundLog :game="game" />
    </UiSheet>
    <UiSheet
      v-if="!wide"
      :open="sheet === 'offField' && readsOffField"
      :title="t(over ? 'games.impostor.buttons.talk' : 'games.impostor.buttons.offField')"
      @close="sheet = null"
    >
      <OffField
        v-model:draft="chatLine"
        :room="room"
        :game="game"
        :setter-id="setterId"
        :sending="sending"
        :open="openSeat"
        @send="say"
      />
    </UiSheet>

    <SeatPanel :game="game" :number="opened" :name="openedName" :is-chair="isChair" @close="opened = null" />
    <JudgeSheet :game="game" />

    <UiSheet :open="ending" :title="t('game.end')" @close="ending = false">
      <div class="confirm">
        <p>{{ t('games.impostor.endConfirm') }}</p>
        <UiButton variant="danger" :disabled="busy" @click="withdraw">{{ t('game.end') }}</UiButton>
        <UiButton variant="quiet" @click="ending = false">{{ t('lobby.manage.cancel') }}</UiButton>
      </div>
    </UiSheet>
  </section>
</template>

<style scoped>
.impostor-game {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.layout {
  display: grid;
  gap: var(--space-4);
}

.main {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

/* The bar with the clock and the reaction button, which stays at the top of the screen as in the
   first game's room (KeywordsGame.vue). */
.sticky-clock {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
  padding: var(--space-2) 0 var(--space-3);
  background: var(--bg);
  border-image: linear-gradient(var(--bg), var(--bg)) 0 fill / 0 / 0 100vmax;
}

.sticky-clock::after {
  content: '';
  position: absolute;
  top: 100%;
  right: 0;
  left: 0;
  height: 12px;
  border-image: linear-gradient(var(--shade), transparent) 0 fill / 0 / 0 100vmax;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--motion);
}

.sticky-clock.stuck::after {
  opacity: 1;
}

.sticky-clock > .clock {
  flex: 1;
  min-width: 0;
}

.sticky-clock > .emote-button {
  flex: none;
}

.sticky-clock.below-banner {
  top: var(--banner-height);
}

:global(html:has(.impostor-game .sticky-clock)) {
  scroll-padding-top: calc(var(--banner-height) + var(--sticky-height, 3rem));
}

/* The seats, two to a row on a phone, three from a tablet up and four beside the side columns. */
.board {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}

/* The choice to abstain, a card as the seats' are, with the outline and no shadow, yellow once
   chosen. */
.abstain-card {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-1);
  min-height: 7.5rem;
  padding: var(--space-3);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-card);
  background: var(--paper);
  cursor: pointer;
}

.abstain-card.chosen {
  background: var(--bg);
}

.abstain-card:has(input:focus-visible) {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.abstain {
  font-weight: var(--weight-black);
}

.abstain-card .text {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.status {
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

/* The record, how to play and the off-field chat on one row, each as wide as the others. */
.buttons {
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  gap: var(--space-2);
}

.buttons > :deep(.button) {
  padding: 0 var(--space-1);
  white-space: nowrap;
}

.side {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.side .section-title {
  margin-bottom: var(--space-3);
}

.tools,
.foot {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.confirm {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

@media (min-width: 40rem) {
  .board {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

/* Two columns: the board and what the viewer can do on the left, the off-field chat, the record
   and how to play on the right, in 22 rem. */
@media (min-width: 64rem) {
  .layout {
    grid-template-columns: minmax(0, 1fr) 22rem;
    gap: 0 var(--space-5);
    align-items: start;
  }

  .board {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>

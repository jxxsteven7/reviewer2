<script setup lang="ts">
import {
  clueCounts,
  SPECTATOR,
  type ClueCount,
  type KeywordsScoreDetail,
  type KeywordsView,
  type Mark,
  type RoomView,
} from '@reviewer2/shared';
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import DuoNotices from '../../core/components/DuoNotices.vue';
import EmoteButton from '../../core/components/EmoteButton.vue';
import EndMatchButton from '../../core/components/EndMatchButton.vue';
import MatchResults from '../../core/components/MatchResults.vue';
import MatchTable from '../../core/components/MatchTable.vue';
import AvatarButton from '../../core/components/AvatarButton.vue';
import TitleLine from '../../core/components/TitleLine.vue';
import ScoreFloat from '../../core/components/ScoreFloat.vue';
import StreakNotices from '../../core/components/StreakNotices.vue';
import UiButton from '../../core/components/UiButton.vue';
import UiSheet from '../../core/components/UiSheet.vue';
import { HTML_LANG } from '../../core/i18n';
import { act, reconnecting } from '../../core/socket';
import { toast } from '../../core/toast';
import { useBusy } from '../../core/useBusy';
import { useMediaQuery } from '../../core/useMediaQuery';
import { useStickyHeight } from '../../core/useStickyHeight';
import ClockBar from './ClockBar.vue';
import ClueLog from './ClueLog.vue';
import CluePanel from './CluePanel.vue';
import DecisionLetter from './DecisionLetter.vue';
import { emptyDraft, readDraft, writeDraft, type ClueDraft } from './draft';
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
import { useChatLine } from './useChatLine';
import { useKeywords, type Chooser } from './useKeywords';
import { useDeadlineHeroes } from './useDeadlineHeroes';
import { useMissedDeadlines } from './useMissedDeadlines';
import { useScoreFloats } from './useScoreFloats';

// A game in progress, and its result. The banner that says what is going on for the viewer, the
// turn strip, the clock, the board and what the viewer can do now come first. On a wide screen the
// group chat, open all the time, and the groups stand on the left of the board, and the clue log
// with the tools on its right; on a phone the groups and the clue log open as sheets from the two
// buttons in the bar under the board, so that the board comes first, and the chat from a third.
//
// The clock stays at the top of the screen, and the chair's button to pause the game and resume it
// stands at its end, in reach wherever the page is scrolled and away from the cards and the clue;
// in a game without a time limit the chair has the button there alone. While the chair has paused
// the game, a notice stands in place of the board, with the way to resume for the chair too, and
// the clock stands still. A group whose turn it is may ask for an extension, where the room allows
// one. Once the game has ended, the review opens the replay.
//
// As cards are revealed, what each did to the viewer's points rises from it, and on a wide screen
// what it did to each player's from their avatar beside the board; at the end, what the game added
// to the viewer's points rises big in the middle of the screen (useScoreFloats.ts).
//
// In a match, its table stands under the board while the game is on, folded to a line with the
// progress and the viewer's place, since it is seldom looked at then; the chair's button to end
// the match stands among the tools instead. Once the game has ended, the
// table follows the letters, with where each player's points came from, or the final ranking does
// when the match is over. The streaks that the game brought the players to come right after the
// letters, before the match's table, and the titles that it brought the player's friends after
// them; their notices are on the page from the start, out of sight, so that a screen reader is
// told of them.
const props = defineProps<{ room: RoomView }>();
const { t } = useI18n();
const room = toRef(props, 'room');
const { data, mySeat, mySide, isChair, groups } = useKeywords(room);
const match = computed(() => room.value.match);

// A match's progress during the game: a button beside the chat, the groups and the clue log on a
// phone, and among the tools on a wide screen, which opens the table in a sheet.
const matchOpen = ref(false);

// The titles that the game so far has brought each player, as the server counts them
// (KeywordsRoomData.titles): in the match's table, and under an ordinary game's letter once it
// is over, a player a line, the avatar beside the first line, in the order of the room. A tap on
// a line, but on a button, folds its titles again.
const titlesOf = (playerId: string) => data.value.titles[playerId] ?? [];
const earned = computed(() =>
  room.value.players
    .map((player) => ({ player, titles: titlesOf(player.id) }))
    .filter(({ titles }) => titles.length > 0),
);
const titlesOpen = ref(new Set<string>());
const showTitles = (id: string, open: boolean) => {
  const next = new Set(titlesOpen.value);
  if (open) next.add(id);
  else next.delete(id);
  titlesOpen.value = next;
};
const foldTitles = (id: string, event: MouseEvent) => {
  if (!(event.target as Element | null)?.closest('button')) showTitles(id, false);
};

// Where a player's points in a game came from, in a few words: a PI's line starts with the role,
// since a PI plays for higher stakes, and the group's opening record and heavenly hand stand by
// name. The detail comes from the server as it is: one from before a count of irrelevant papers
// reads as none, and one from before the PI's stakes as a student's, without the bonuses.
function describe(detail: unknown): string {
  const {
    role,
    found,
    won,
    irrelevant = 0,
    wrong,
    reviewer2,
    bigClues = 0,
    openingRecord,
    heavenlyHand,
  } = detail as KeywordsScoreDetail;
  return [
    role === 'captain' ? t('game.scoreDetail.captain') : null,
    found > 0 ? t('game.scoreDetail.found', { count: found }) : null,
    won ? t('game.scoreDetail.won') : null,
    irrelevant > 0 ? t('game.scoreDetail.irrelevant', { count: irrelevant }) : null,
    wrong > 0 ? t('game.scoreDetail.wrong', { count: wrong }) : null,
    reviewer2 > 0 ? t('game.scoreDetail.reviewer2') : null,
    bigClues > 0 ? t('game.scoreDetail.bigClue', { count: bigClues }) : null,
    openingRecord ? t('game.scoreDetail.openingRecord') : null,
    heavenlyHand ? t('game.scoreDetail.heavenlyHand') : null,
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
// The height of the bar with the clock, taller for the chair, goes into the page's scroll padding,
// so that a card reached with the keyboard comes into view below it.
const clockBar = ref<HTMLElement | null>(null);
useStickyHeight(clockBar);

const game = computed(() => data.value.game as KeywordsView);
// The line a student is writing to their group, and its sending, kept by the page: the chat's
// sheet throws its thread away as it closes, and the panel beside the board gives way to the
// button under it as the page narrows, so neither can hold them. (The PI's `draft` below is
// their clue.)
const { draft: chatLine, sending, say } = useChatLine(game);
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

// A student's marks for the group (docs/games/keywords.md#talking-it-over), which the server sends
// to the group's students and its PI, in either group's turn. A student marks a card with a gesture
// (useCardGestures.ts): two taps for one of the group's own, three for one of the other group's, a
// long press for maybe Reviewer 2, or 1, 2 and 3 from the keyboard; one tap chooses the card in the
// group's own guess phase, and does nothing otherwise. The same mark again takes it off, whoever put
// it there; the last of the group stands. As with the choice, the viewer's own marks show at once,
// until the server has answered every one on its way. The PI only reads the marks. Marking is a
// student's while the game is on and not paused, when there is no board anyway.
const student = computed(
  () => mySeat.value?.role === 'guesser' && mySeat.value.team !== null && !game.value.result && !paused.value,
);
const readsMarks = computed(() => (mySeat.value?.team ?? null) !== null && !game.value.result);
const pendingMarks = ref(new Map<number, Mark | null>());
let marksOnTheWay = 0;
const marks = computed(() => {
  const shown = new Map((game.value.marks ?? []).map(({ card, mark }) => [card, mark] as const));
  for (const [card, mark] of pendingMarks.value) {
    if (mark === null) shown.delete(card);
    else shown.set(card, mark);
  }
  return shown;
});

async function note(card: number, mark: Mark) {
  if (!student.value) return;
  const next = marks.value.get(card) === mark ? null : mark;
  pendingMarks.value.set(card, next);
  marksOnTheWay += 1;
  await act('keywords:mark', { gameId: game.value.gameId, card, mark: next });
  marksOnTheWay -= 1;
  if (marksOnTheWay === 0) pendingMarks.value = new Map();
}

// The PI's clue in the making: the word, the number if they picked one, and their marks on the
// cards the clue is meant for, in the order marked. Tapping one of the group's cards marks it,
// tapping it again takes the mark back. Nobody else sees any of it until the clue is given: it is
// kept in this browser alone (draft.ts), for this game, and comes back after a reload. It goes
// with the clue, and starts over with the next game.
//
// A PI prepares the clue whenever it isn't their turn to give one, while the game is on and not
// paused (docs/games/keywords.md#the-clue): the panel stays open under the status line, below the
// board, so that the PI watches the other group guess above it. When their turn comes it is the
// same panel, with the draft in it, and the PI gives the clue themselves.
const isCaptain = computed(() => mySeat.value?.role === 'captain');
const mayPrepare = computed(() => isCaptain.value && !canClue.value && !paused.value && !game.value.result);
const draft = ref<ClueDraft>(emptyDraft());
const gone = ref<string[]>([]);
// The draft is read and written for a PI alone: anyone else who views the game, as in another
// tab of the PI's browser, has none, and must not take theirs out of the storage. A draft read
// back after a reload is dropped if the group's clue went since it was last changed: the page
// may have gone before the server's snapshot with the clue came.
watch(
  () => (isCaptain.value ? game.value.gameId : null),
  (gameId) => {
    const team = mySeat.value?.team;
    draft.value = gameId === null || !team ? emptyDraft() : readDraft(gameId, team, game.value.history);
    gone.value = [];
  },
  { immediate: true },
);
watch(
  draft,
  (current) => {
    if (isCaptain.value) writeDraft(game.value.gameId, current, game.value.history.length);
  },
  { deep: true },
);

// The numbers that the room's guess rule offers the PI's group, which under the free rule are as
// many as the group has cards left: none for a viewer without a group.
const counts = computed(() => {
  const team = mySeat.value?.team;
  return team ? clueCounts(data.value.settings.guessRule, game.value.remaining[team]) : [];
});
// The draft follows the board: a marked card that someone reveals loses its mark, and the panel
// says so until the PI marks or unmarks a card again; a number picked that the rule no longer
// offers, once a card of the group's was found, goes back to following the marks.
watch(
  game,
  ({ cards }) => {
    const { count, targets } = draft.value;
    if (count !== null && !counts.value.includes(count)) draft.value.count = null;
    // While the game is paused there are no cards, and nothing to tell.
    if (cards.length === 0) return;
    const kept = targets.filter((card) => cards[card] && !cards[card].revealed);
    if (kept.length === targets.length) return;
    gone.value = [...gone.value, ...targets.flatMap((card) => (cards[card]?.revealed ? [cards[card].word] : []))];
    draft.value.targets = kept;
  },
  { immediate: true },
);
function mark(card: number) {
  const { targets } = draft.value;
  draft.value.targets = targets.includes(card) ? targets.filter((other) => other !== card) : [...targets, card];
  gone.value = [];
}

// The clue has gone once the server's snapshot has it in the game's history, and the draft goes
// with it: from the board, the panel and the storage. The answer to the message tells nothing of
// that, since it can be lost on the way after the server took the clue. A clue phase that ran
// out leaves a record without a word, and the draft waits for the next turn.
watch(
  () => game.value.history.length,
  (_, before) => {
    const given = game.value.history
      .slice(before)
      .some((record) => record.team === mySeat.value?.team && record.word !== null);
    if (!given) return;
    draft.value = emptyDraft();
    gone.value = [];
  },
);
// Whether a tap on the board marks a card a clue is meant for: for the PI giving a clue or preparing
// one. Otherwise one tap chooses a card for a student whose group guesses.
const marking = computed(() => canClue.value || mayPrepare.value);
function tap(card: number) {
  if (marking.value) mark(card);
  else if (canGuess.value) void choose(card);
}

// The moves that change the game go one at a time, so that a double tap can't send one twice.
const giveClue = (word: string, count: ClueCount) =>
  run(() => {
    const { targets } = draft.value;
    return act('keywords:clue', {
      ...moment.value,
      word,
      count,
      ...(targets.length > 0 ? { targets: [...targets] } : {}),
    });
  });
const reveal = (card: number) => run(() => act('keywords:reveal', { ...moment.value, card }));
const pass = () => run(() => act('keywords:pass', moment.value));
const extend = () => run(() => act('keywords:extend', moment.value));
const pause = () => run(() => act('keywords:pause', { gameId: game.value.gameId }));
const resume = () => run(() => act('keywords:resume', { gameId: game.value.gameId }));
const again = () => run(() => act('room:again', { gameId: game.value.gameId }));

// Everyone hears of an extension as it comes: the newest event, when it is one. A PI who misses the
// deadline for a clue is called out to the whole room (useMissedDeadlines.ts), and so is a deadline
// hero (useDeadlineHeroes.ts).
watch(
  () => game.value.events.length,
  (count, before) => {
    const event = game.value.events.at(-1);
    if (count > before && event?.kind === 'extended' && event.team) {
      toast('game.extended', { group: t(`lobby.group.${event.team}`) });
    }
  },
);
useMissedDeadlines(
  game,
  computed(() => room.value.players),
);
useDeadlineHeroes(
  game,
  computed(() => room.value.players),
);
const floats = useScoreFloats(room);

// The review of the game that has ended, step by step, for everyone who sees the result, with what
// the viewer's group has said since the end, as it talks the game over.
const reviewing = ref(false);
const replay = computed(() => replayOf(game.value, room.value.language, room.value.players));
const talk = computed(() =>
  (game.value.chat ?? [])
    .filter((message) => message.after)
    .map(({ id, player, text }) => ({
      id,
      name: room.value.players.find((other) => other.id === player)?.name ?? t('game.chat.someone'),
      text,
    })),
);

const ending = ref(false);
async function withdraw() {
  ending.value = false;
  await run(() => act('room:end', { gameId: game.value.gameId }));
}

// A game that ends while the chair is still deciding leaves nothing to end, and a draft of a
// clue nothing to prepare, also for a page that opens on a game that has ended.
watch(
  () => game.value.result,
  (result) => {
    if (!result) return;
    ending.value = false;
    draft.value = emptyDraft();
  },
  { immediate: true },
);

// The status line under the board, for whoever has nothing to do just then: whose PI is giving the
// clue, or which group is guessing. Who the viewer is, the banner says, and whom the others in their
// group chose, the cards; whoever plays from a match's next game is told so under the line.
const status = computed(() => {
  if (canClue.value || game.value.result || paused.value || canGuess.value) return null;
  return game.value.phase === 'clue'
    ? t('game.waitClue', { group: group.value })
    : t('game.waitGuess', { group: group.value });
});
</script>

<template>
  <section class="keywords-game">
    <RoleBanner :seat="mySeat ?? SPECTATOR" :game="game">
      <EmoteButton :held="!data.mayEmote" />
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
    <TurnStrip v-else :game="game" :guess-rule="data.settings.guessRule" :groups="groups" :me="room.me" clock-apart />
    <div
      v-if="!game.result && (game.clock || isChair)"
      ref="clockBar"
      class="sticky-clock"
      :class="{ 'below-banner': reconnecting }"
    >
      <ClockBar v-if="game.clock" :clock="game.clock" :frozen="paused" />
      <UiButton v-if="isChair" class="pause" size="small" :disabled="busy" @click="paused ? resume() : pause()">
        {{ paused ? t('game.resume') : t('game.pause') }}
      </UiButton>
    </div>
    <StreakNotices :room="room" />
    <DuoNotices :room="room" />
    <template v-if="game.result && match">
      <MatchResults v-if="match.status !== 'on'" :room="room" />
      <MatchTable v-else :room="room" :describe="describe" :titles-of="titlesOf" class="between">
        <p class="scoring">{{ t('game.scoring') }}</p>
      </MatchTable>
    </template>
    <section v-if="game.result && !match && earned.length" class="game-titles">
      <h2 class="section-title">{{ t('match.gameTitles') }}</h2>
      <ul>
        <li v-for="{ player, titles } in earned" :key="player.id" @click="foldTitles(player.id, $event)">
          <AvatarButton
            :player-id="player.id"
            :name="player.name"
            :avatar="player.avatar"
            :agent="player.agent !== undefined"
            :waiting="!player.online"
          />
          <span class="title-rest">
            <strong class="title-name">{{ player.name }}</strong>
            <TitleLine
              :titles="titles"
              :open="titlesOpen.has(player.id)"
              @update:open="showTitles(player.id, $event)"
            />
          </span>
        </li>
      </ul>
    </section>

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
          :selectable="canGuess || marking || student"
          :selected="marking ? null : choice"
          :choosers="choosers"
          :lang="HTML_LANG[room.language]"
          :targeting="marking ? (mySeat?.team ?? null) : null"
          :targets="isCaptain && !game.result ? draft.targets : []"
          :notes="readsMarks ? marks : undefined"
          :quiet-notes="isCaptain"
          :gestures="student"
          :team="mySeat?.team ?? null"
          :float="floats.card.value"
          @select="tap"
          @mark="note"
        />
        <div class="actions">
          <GroupChat v-if="!wide" v-model:draft="chatLine" :room="room" :sending="sending" @send="say" />
          <div v-if="student || status || data.joinsNext" class="play">
            <GuessBar v-if="canGuess" :game="game" :selected="choice" :busy="busy" @reveal="reveal" @pass="pass" />
            <p v-else-if="status" class="status">{{ status }}</p>
            <p v-if="student && !canGuess" class="gestures">{{ t('game.gestures.mark') }}</p>
            <p v-if="data.joinsNext" class="joins-next">{{ t('match.joinsNext') }}</p>
          </div>
          <!--
            One panel for the draft and for the clue, so that when the PI's turn comes while they
            type, the input, its focus and what the keyboard is still composing stay as they are.
          -->
          <CluePanel
            v-if="canClue || mayPrepare"
            v-model:word="draft.word"
            v-model:count="draft.count"
            :game="game"
            :counts="counts"
            :settings="data.settings"
            :language="room.language"
            :busy="busy"
            :targets="draft.targets"
            :gone="gone"
            :can-give="canClue"
            :team="mySeat?.team ?? null"
            @give="giveClue"
          />
          <UiButton v-if="canExtend" class="extend" size="small" :disabled="busy" @click="extend">
            {{ t('game.extend') }}
          </UiButton>
          <div v-if="!wide" class="panels">
            <UiButton class="open-groups" size="small" @click="panel = 'groups'">{{
              t('game.buttons.groups')
            }}</UiButton>
            <UiButton class="open-log" size="small" @click="panel = 'log'">{{ t('game.buttons.log') }}</UiButton>
            <UiButton v-if="match && !game.result" class="open-match" size="small" @click="matchOpen = true">
              {{ t('game.buttons.match') }}
            </UiButton>
          </div>
        </div>
        <p v-if="!game.result" class="note">{{ t('game.keyNote') }}</p>
      </div>

      <aside class="side">
        <div class="column">
          <GroupChat v-if="wide" v-model:draft="chatLine" :room="room" :sending="sending" panel @send="say" />
          <GameRosters v-if="wide" :room="room" :floats="floats.players.value" />
        </div>
        <div class="column">
          <ClueLog v-if="wide" :game="game" />
          <div class="tools">
            <UiButton v-if="wide && match && !game.result" class="open-match" size="small" @click="matchOpen = true">
              {{ t('match.progressTitle') }}
            </UiButton>
            <RulesSheet :settings="data.settings" :language="room.language" :custom-words="room.customWordCount" />
            <UiButton v-if="replay" class="review" variant="quiet" size="small" @click="reviewing = true">
              {{ t('game.review') }}
            </UiButton>
            <UiButton v-if="isChair && !game.result" variant="quiet" size="small" @click="ending = true">
              {{ t('game.end') }}
            </UiButton>
            <EndMatchButton v-if="isChair && !game.result && match?.status === 'on'" :match-id="match.id" />
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

    <UiSheet :open="matchOpen" :title="t('match.progressTitle')" @close="matchOpen = false">
      <MatchTable v-if="match" :room="room" :endable="false" :titles-of="titlesOf" class="in-sheet">
        <p class="scoring">{{ t('game.scoring') }}</p>
      </MatchTable>
    </UiSheet>

    <UiSheet :open="reviewing" :title="t('replay.title')" @close="reviewing = false">
      <ReplayViewer v-if="replay" :replay="replay" :talk="talk" />
    </UiSheet>

    <Teleport to="body">
      <ScoreFloat v-if="floats.end.value" :key="floats.end.value.key" :float="floats.end.value" size="end" />
    </Teleport>

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
   page reconnects, with the chair's button to pause at its end. It is kept thin, and its
   background reaches the edges of the screen, so that no card shows through it beside the column.
   Without a clock, the chair's button stands there alone, on the right. */
.sticky-clock {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-2);
  padding: var(--space-1) 0;
  background: var(--bg);
  box-shadow: 0 0 0 100vmax var(--bg);
  clip-path: inset(0 -100vmax);
}

.sticky-clock > .clock {
  flex: 1;
  min-width: 0;
}

.sticky-clock :deep(.seconds) {
  min-height: 32px;
}

.sticky-clock > .pause {
  flex: none;
}

.sticky-clock.below-banner {
  top: var(--banner-height);
}

/* During a game the page doesn't anchor its scroll position: when something above the board
   changes, such as the clue that appears in the turn strip, WebKit's scroll anchoring moves the
   page a moment later, taking the card from under a tap that is on its way. Whatever the page
   scrolls or focuses into view, such as a card reached with the keyboard, stays below the clock
   and the banner: the clock's height, as measured (useStickyHeight), and the banner's go into the
   scroll padding. The page is what scrolls, so the rules go on the root. */
:global(html:has(.keywords-game)) {
  overflow-anchor: none;
}

:global(html:has(.sticky-clock)) {
  scroll-padding-top: calc(var(--banner-height) + var(--sticky-height, 3rem));
}

/* The bar under the board: on a phone the chat, the groups, the clue log and a match's progress on
   one row of four buttons as wide as each other, in Chinese and in English alike, each label on one
   line, and then what the viewer can do: a student's tools first. Outside a match the fourth place
   stays empty, and the others keep their width. The rows are drawn from the elements as they are,
   through display: contents. */
.actions {
  display: grid;
  grid-template-areas:
    'chat groups log match'
    'panel panel panel panel'
    'draft draft draft draft'
    'extend extend extend extend';
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding: var(--space-2) 0;
}

.panels {
  display: contents;
}

.actions > :deep(.open-chat) {
  grid-area: chat;
}

.open-groups {
  grid-area: groups;
}

.open-log {
  grid-area: log;
}

.open-match {
  grid-area: match;
}

.actions > :deep(.open-chat),
.panels > .button {
  position: relative;
  padding: 0 var(--space-1);
  white-space: nowrap;
  text-align: center;
}

/* The count of new lines on the chat button's corner, so that the label keeps its line. */
.actions > :deep(.open-chat .badge) {
  position: absolute;
  top: -9px;
  right: -7px;
  border: 2px solid var(--bg);
}

.actions > :deep(.clue-panel),
.play {
  grid-area: panel;
}

/* What the viewer can do now, a student's tools first, one gap of the bar's grid apart. */
.play {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.actions > :deep(.extend) {
  grid-area: extend;
  justify-self: start;
}

/* The draft of the next clue, under the status line. */
.actions > :deep(.clue-panel.draft) {
  grid-area: draft;
}

.status {
  font-weight: var(--weight-bold);
}

.gestures {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.joins-next {
  font-size: var(--text-sm);
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

/* An ordinary game's titles, under its letter: a player a line, the avatar beside the first line,
   whatever the titles take below it once unfolded. */
.game-titles {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
  padding: var(--space-3) var(--space-4) var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

.game-titles ul {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.game-titles li {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}

.title-rest {
  display: flex;
  flex: 1 1 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px var(--space-2);
  min-width: 0;
}

.title-name {
  flex: 1000 1 4em;
  min-width: 0;
  max-width: max-content;
  overflow: hidden;
  font-weight: var(--weight-bold);
  line-height: 26px;
  text-overflow: ellipsis;
  white-space: nowrap;
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

  /* Under the board, no row for the buttons: the chat is a panel beside it, and the groups and
     the clue log are columns. The other rows are as on a phone. */
  .actions {
    grid-template-areas:
      'panel panel panel panel'
      'draft draft draft draft'
      'extend extend extend extend';
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

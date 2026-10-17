<script setup lang="ts">
import { hasHan, type CardView, type Language, type Mark, type Team } from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import PlayerAvatar from '../../core/components/PlayerAvatar.vue';
import { formatList, HTML_LANG } from '../../core/i18n';
import { hyphenate } from './hyphenate';
import MarkSticker from './MarkSticker.vue';
import type { Chooser } from './useKeywords';

// One card, a sticker on the table. A revealed card is filled with its color and pressed into
// the table. A card whose color the viewer may know without its being revealed (a PI's key, or
// the end of the game) is tinted. Every color also comes with a short label in the corner, so that
// color is never the only signal; the accessible name says the color in full. The others in the
// group who have chosen the card hang their avatars on its top right corner; the card's accessible
// name says who they are. On a big screen the cards are `large`, with bigger type. A `marked` card, in a
// replay, is outlined. A `target` is one of the cards a PI meant with a clue, numbered in the order
// they were marked: on the PI's board while they mark them, and for everyone once the game is over.
// A `note` is the mark that the viewer's group has put on a hidden card: the mark's round sticker
// hangs on the card's bottom right corner, the same for its students and its PI, and for the
// students the card takes the tint of the color it stands for, unless it is the viewer's choice;
// for the PI, who only reads it (`noteQuiet`), the card keeps the tint of its own color. Every
// board has its corners in the same places, the color's word inside the top left, the choosers'
// avatars on the top right, faded for a chooser who is offline, too small for the dots that mark
// someone the room waits for elsewhere (PlayerAvatar.vue), the PI's number on the bottom left and
// the mark on the bottom right.
// A card that has just been revealed in front of the viewer is `turning` (useTurnedCard.ts): it
// turns over, its face as it lay until it stands edge on, its color on the way back, and lands
// pressed into the table. The points that the card did to the viewer's rise from it on the board
// (KeywordsBoard.vue), outside the card, so that they don't turn with it.
const props = withDefaults(
  defineProps<{
    card: CardView;
    index: number;
    selectable: boolean;
    selected: boolean;
    choosers: Chooser[];
    large?: boolean;
    marked?: boolean;
    target?: number | null;
    note?: { mark: Mark; color: Team | 'r2' } | null;
    noteQuiet?: boolean;
    turning?: boolean;
  }>(),
  { large: false, marked: false, target: null, note: null, noteQuiet: false, turning: false },
);
const emit = defineEmits<{ select: [index: number] }>();
const { t, locale } = useI18n();

// Long words get smaller type so that they fit on a phone.
const size = computed(() => {
  const length = [...props.card.word].length;
  if (hasHan(props.card.word)) return length <= 3 ? 'm' : length === 4 ? 's' : 'xs';
  return length <= 7 ? 'm' : length <= 10 ? 's' : 'xs';
});

const state = computed(() => {
  if (!props.card.color) return 'hidden';
  return props.card.revealed ? 'revealed' : 'known';
});

// The face of the card as it lies, which the turn keeps until the card stands edge on: the table's
// yellow of the viewer's choice, the tint of the color that the viewer's group has marked it with
// or that the viewer knows it to be, Reviewer 2's ink for a PI who knows it, or the paper. The turn
// and the reveal come in one snapshot, so the face that turns away is the one the card had the
// moment before.
type Face = 'choice' | 'red' | 'blue' | 'neutral' | 'r2' | 'ink' | 'paper';
const face = computed<Face>(() => {
  if (props.selected) return 'choice';
  if (props.note && !props.noteQuiet) return props.note.color;
  if (props.card.color) return props.card.color === 'reviewer2' ? 'ink' : props.card.color;
  return 'paper';
});
const turnedFace = ref<Face>('paper');
watch([() => props.turning, face], ([turning], [wasTurning, faceBefore]) => {
  if (turning && !wasTurning) turnedFace.value = faceBefore ?? 'paper';
});

const label = computed(() => (props.card.color ? t(`game.card.${props.card.color}`) : ''));
const tag = computed(() => (props.card.color ? t(`game.cardTag.${props.card.color}`) : ''));
// The label is in the interface's language, whatever the words' is.
const uiLanguage = computed(() => locale.value as Language);
const chosenBy = computed(() =>
  formatList(
    locale.value,
    props.choosers.map((chooser) => chooser.name),
  ),
);
const ariaLabel = computed(() =>
  [
    props.card.word,
    props.card.color ? label.value : t('game.hidden'),
    ...(props.target !== null ? [t('game.targetOrder', { order: props.target })] : []),
    ...(props.note ? [t(`game.noted.${props.note.mark}`)] : []),
    ...(props.choosers.length ? [t('game.chosenBy', { names: chosenBy.value })] : []),
  ].join(', '),
);
</script>

<template>
  <!--
    A card that can't be chosen stays a button that assistive technology reads like the others,
    word and color included, but it says so with aria-disabled and leaves the Tab order: a
    disabled button is skipped by screen readers' quick navigation too, and a PI reading the key
    needs every card.
  -->
  <button
    type="button"
    class="card"
    :class="[
      state,
      card.color,
      size,
      note && !noteQuiet ? `noted note-${note.color}` : '',
      { large, selected, selectable, marked, targeted: target !== null, chosen: choosers.length > 0 },
      turning ? ['turning', `face-${turnedFace}`] : '',
    ]"
    :aria-disabled="selectable ? undefined : 'true'"
    :tabindex="selectable ? undefined : -1"
    :aria-pressed="selectable ? selected || target !== null : undefined"
    :aria-label="ariaLabel"
    @click="selectable && emit('select', index)"
  >
    <span class="word">{{ hyphenate(card.word) }}</span>
    <span v-if="card.color" class="tag" :lang="HTML_LANG[uiLanguage]" aria-hidden="true">{{ tag }}</span>
    <span v-if="card.revealed && card.color === 'reviewer2'" class="stamp" aria-hidden="true">{{
      t('game.stamp')
    }}</span>
    <span v-if="target !== null" class="target num" aria-hidden="true">{{ target }}</span>
    <Transition name="pop">
      <MarkSticker v-if="note" :key="note.mark" class="note" :mark="note.mark" :color="note.color" />
    </Transition>
    <span v-if="choosers.length" class="choosers" aria-hidden="true">
      <PlayerAvatar
        v-for="chooser in choosers"
        :key="chooser.username ?? chooser.name"
        :name="chooser.username ?? chooser.name"
        :guest="chooser.guest"
        :avatar="chooser.avatar"
        :agent="chooser.agent !== undefined"
        :faded="!chooser.online"
      />
    </span>
  </button>
</template>

<style scoped>
/* A long press marks a student's card (useCardGestures.ts): it selects no text and opens no menu. */
.card {
  position: relative;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 48px;
  aspect-ratio: 7 / 6;
  padding: 4px 3px;
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-card);
  background: var(--paper);
  box-shadow: var(--shadow-1);
  color: var(--ink);
  line-height: 1.15;
  text-align: center;
  cursor: default;
  touch-action: manipulation;
  transition:
    transform var(--motion),
    box-shadow var(--motion),
    background-color var(--motion),
    color var(--motion);
}

.word {
  max-width: 100%;
  overflow-wrap: break-word;
  font-weight: var(--weight-black);
}

/* Sizes: a fixed size first, for browsers without container units. */
.m .word {
  font-size: 14px;
  font-size: clamp(13px, 4.4cqi, 26px);
}

.s .word {
  font-size: 12px;
  font-size: clamp(11px, 3.6cqi, 22px);
}

.xs .word {
  font-size: 10px;
  font-size: clamp(10px, 3cqi, 18px);
}

/* English words run longer than Chinese ones of the same count, so they are set a little
   smaller, and break less often. */
.card:lang(en).m .word {
  font-size: 13px;
  font-size: clamp(12px, 3.7cqi, 24px);
}

.card:lang(en).s .word {
  font-size: 11.5px;
  font-size: clamp(11px, 3.1cqi, 20px);
}

.card:lang(en).xs .word {
  font-size: 10px;
  font-size: clamp(10px, 2.6cqi, 17px);
}

/* On a big screen the type grows with the board, further than on a phone or a laptop. */
.large.m .word,
.card:lang(en).large.m .word {
  font-size: 16px;
  font-size: clamp(14px, 4.4cqi, 34px);
}

.large.s .word,
.card:lang(en).large.s .word {
  font-size: 14px;
  font-size: clamp(12px, 3.6cqi, 28px);
}

.large.xs .word,
.card:lang(en).large.xs .word {
  font-size: 12px;
  font-size: clamp(11px, 3cqi, 24px);
}

.selectable {
  cursor: pointer;
}

.selectable:active {
  transform: translate(var(--shift-1), var(--shift-1));
  box-shadow: none;
}

/* The viewer's own choice: the card takes the table's yellow. */
.selected {
  background: var(--bg);
}

@media (hover: hover) {
  .selectable:not(.selected):hover {
    background: var(--paper-2);
  }
}

/* The label is small, so it is set in the full color of the type: dimmed, it would fall under
   4.5:1 on a revealed red or blue card. */
.tag {
  position: absolute;
  top: 3px;
  left: 5px;
  font-size: 10px;
  font-weight: var(--weight-black);
  letter-spacing: 0.04em;
  line-height: 1;
  text-transform: uppercase;
}

/* The English labels, in capitals, are set a little smaller and tighter, to the size of the
   Chinese ones. The label's own lang is the interface's, which the board's, the words', may
   differ from in a replay. */
.tag:lang(en) {
  font-size: 9px;
  letter-spacing: 0.02em;
}

/* Room for the label in the corner. */
.known,
.revealed {
  padding-top: 13px;
}

/* A color the viewer knows but that hasn't been revealed: a tint. */
.known.red {
  background: var(--red-tint);
}

.known.blue {
  background: var(--blue-tint);
}

.known.neutral {
  background: var(--neutral-tint);
}

.known.reviewer2 {
  background: var(--r2);
  color: var(--on-r2);
}

/* Revealed: the full color, pressed into the table. */
.revealed {
  transform: translate(var(--shift-1), var(--shift-1));
  box-shadow: none;
}

.revealed.red {
  background: var(--red);
  color: var(--on-red);
}

.revealed.blue {
  background: var(--blue);
  color: var(--on-blue);
}

.revealed.neutral {
  background: var(--neutral);
  color: var(--on-neutral);
}

.revealed.neutral .word {
  text-decoration: line-through;
  text-decoration-thickness: 2px;
}

.revealed.reviewer2 {
  background: var(--r2);
  color: var(--on-r2);
}

/* The corners: what hangs on them reaches a little over the card's edge, into the gap between the
   rows, which stays as narrow as it is. The avatars hang higher, clear of the word under them, and
   the stickers lower; where a card's sticker is right above the avatars of the card below, the two
   overlap by a hair, the avatars in front. On a wider screen, whose cards are bigger, so are the
   corners, and on a big screen's large cards bigger still. */
.card {
  --corner: 18px;
  --corner-face: 22px;
  --corner-up: 7px;
  --corner-down: 4px;
  --corner-side: 3px;
}

@media (min-width: 40rem) {
  .card {
    --corner: 26px;
    --corner-face: 30px;
    --corner-up: 5px;
    --corner-down: 5px;
  }
}

.card.large {
  --corner: 30px;
  --corner-face: 36px;
  --corner-up: 6px;
  --corner-down: 6px;
}

/* The avatars of the students who chose the card hang on its top right corner, without the shadow
   of an avatar that a tap opens (docs/design.md): a tap on them chooses the card. */
.choosers {
  position: absolute;
  top: calc(var(--corner-up) * -1);
  right: calc(var(--corner-side) * -1);
  display: flex;
  flex-direction: row-reverse;
}

.choosers :deep(.avatar) {
  width: var(--corner-face);
  height: var(--corner-face);
  font-size: calc(var(--corner-face) * 0.5);
}

.choosers :deep(.avatar + .avatar) {
  margin-right: calc(var(--corner-face) * -0.35);
}

/* One of the cards a PI meant: a dashed ring, and its place in the order on a round sticker on the
   bottom left corner. The ring gives way to the focus ring, which the scoped rule would otherwise
   beat, so that a PI moving by keyboard sees which of the marked cards has the focus; the sticker
   still says that the card is marked. */
.targeted {
  outline: var(--line) dashed var(--ink);
  outline-offset: 2px;
}

.targeted:focus-visible {
  outline: var(--line-strong) solid var(--focus);
}

.target {
  position: absolute;
  bottom: calc(var(--corner-down) * -1);
  left: calc(var(--corner-side) * -1);
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: var(--corner);
  height: var(--corner);
  padding: 0 4px;
  border: var(--line-thin) solid var(--paper);
  border-radius: calc(var(--corner) / 2);
  background: var(--ink);
  box-shadow: var(--shadow-1);
  color: var(--on-ink);
  font-size: calc(var(--corner) * 0.58);
  font-weight: var(--weight-black);
  line-height: 1;
}

/* A card that the viewer's group has marked: for its students, the tint of the color the mark
   stands for, unless it is the viewer's choice, and for everyone in it the mark's sticker on the
   bottom right corner. */
.noted.note-red:not(.selected) {
  background: var(--red-tint);
}

.noted.note-blue:not(.selected) {
  background: var(--blue-tint);
}

.noted.note-r2:not(.selected) {
  background: var(--r2-tint);
}

.card .note {
  position: absolute;
  right: calc(var(--corner-side) * -1);
  bottom: calc(var(--corner-down) * -1);
  width: var(--corner);
  height: var(--corner);
  box-shadow: var(--shadow-1);
}

/* A mark that comes pops onto the corner, and one that goes shrinks away. */
.pop-enter-active {
  animation: pop 420ms var(--ease-spring) both;
}

.pop-leave-active {
  animation: unpop 240ms ease-in both;
}

@keyframes pop {
  from {
    transform: scale(0);
  }

  60% {
    transform: scale(1.3);
  }

  to {
    transform: scale(1);
  }
}

@keyframes unpop {
  from {
    transform: scale(1);
  }

  35% {
    transform: scale(1.3);
  }

  to {
    opacity: 0;
    transform: scale(0);
  }
}

/* A press held on a student's card: it sinks into its shadow until the menu of marks opens. */
.pressing {
  box-shadow: 1px 1px 0 var(--ink);
  transform: translate(2px, 2px) scale(0.96);
  transition:
    transform 400ms var(--ease-out),
    box-shadow 400ms var(--ease-out);
}

/* The card whose menu of marks is open, which a copy of lifts out of the page meanwhile: it is
   hidden at once at rest, where the press no longer sinks it, so that the copy, measured from it,
   lands where it shows again. */
.card.lifting {
  visibility: hidden;
  transform: none;
  transition: none;
}

/* The card that a replay's step is about. */
.marked {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.stamp {
  margin-top: 2px;
  padding: 0 5px;
  border: var(--line-thin) solid var(--stamp);
  border-radius: var(--radius-small);
  color: var(--stamp);
  font-size: 11px;
  font-size: clamp(11px, 2.8cqi, 18px);
  font-weight: var(--weight-black);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  transform: rotate(-6deg);
}

/* The card that has just been revealed in front of the viewer turns over: on its vertical axis,
   edge on halfway, where its color comes, and it lands pressed into the table, as a revealed card
   lies. Its face stays as it lay until then (`face-*`): the paper, the table's yellow of the
   viewer's choice, the tint of a mark or of a known color, or Reviewer 2's ink for the PI who knew
   it, with the type as it was. The color comes on a layer under the word and the corners, held off
   until the half-turn, as the ink of the word and the label is held, so that the face turns away
   with what it had on it and the back comes with the color. Under it the card's own background is
   held at the face until the turn ends, when it is the color already. Reviewer 2's stamp slams
   down once the card has landed. The turn is over after TURN_MS (useTurnedCard.ts), when the layer
   goes, which shows nothing, since the card has its color by then. */
.turning {
  --face: var(--paper);
  --face-ink: var(--ink);

  isolation: isolate;
  animation:
    flip 460ms var(--ease-out),
    face 460ms step-end;
}

.turning.face-choice {
  --face: var(--bg);
}

.turning.face-red {
  --face: var(--red-tint);
}

.turning.face-blue {
  --face: var(--blue-tint);
}

.turning.face-neutral {
  --face: var(--neutral-tint);
}

.turning.face-r2 {
  --face: var(--r2-tint);
}

.turning.face-ink {
  --face: var(--r2);
  --face-ink: var(--on-r2);
}

/* The layer fills the card inside its outline, which stays whole over it. */
.turning::after {
  content: '';
  position: absolute;
  z-index: -1;
  inset: 0;
  border-radius: calc(var(--radius-card) - var(--line));
  animation: appear 230ms step-end;
  pointer-events: none;
}

.turning.red::after {
  background: var(--red);
}

.turning.blue::after {
  background: var(--blue);
}

.turning.neutral::after {
  background: var(--neutral);
}

.turning.reviewer2::after {
  background: var(--r2);
}

.turning .word,
.turning .tag {
  animation: ink 230ms step-end;
}

/* The stamp's curve settles more than the spring does, so that the stamp lands rather than
   bounces: it is pressed down, not dropped. */
.turning .stamp {
  animation: slam 380ms cubic-bezier(0.2, 1.2, 0.4, 1) 430ms both;
}

@keyframes flip {
  from {
    box-shadow: var(--shadow-1);
    transform: perspective(520px) rotateY(0deg);
  }

  49.9% {
    box-shadow: none;
    transform: perspective(520px) rotateY(90deg);
  }

  50% {
    box-shadow: none;
    transform: perspective(520px) rotateY(-90deg);
  }

  to {
    box-shadow: none;
    transform: translate(var(--shift-1), var(--shift-1)) perspective(520px) rotateY(0deg);
  }
}

@keyframes face {
  from {
    background-color: var(--face);
  }
}

@keyframes ink {
  from {
    color: var(--face-ink);
    text-decoration-color: transparent;
  }
}

@keyframes appear {
  from {
    opacity: 0;
  }
}

@keyframes slam {
  from {
    opacity: 0;
    transform: rotate(-20deg) scale(2.4);
  }

  55% {
    opacity: 1;
    transform: rotate(-3deg) scale(0.92);
  }

  to {
    transform: rotate(-6deg) scale(1);
  }
}

/* Where the device asks for less motion, the card is revealed at once, the stamp in place, rather
   than held at the start of a turn that the page cuts short (base.css). */
@media (prefers-reduced-motion: reduce) {
  .turning,
  .turning::after,
  .turning .word,
  .turning .tag,
  .turning .stamp {
    animation: none;
  }
}
</style>

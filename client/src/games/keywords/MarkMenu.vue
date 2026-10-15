<script setup lang="ts">
import { MARKS, otherTeam, type Mark, type Team } from '@reviewer2/shared';
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MarkSticker from './MarkSticker.vue';

// A student's menu of marks for one card (docs/games/keywords.md#talking-it-over), which a long press
// on the card opens, or a right click: the page dims and blurs, the card lifts out of it, and the
// menu grows from it, below it, or above it near the bottom of the screen, with the three marks, the
// card's own marked out. Choosing one puts it on the card, and choosing the card's own takes it off;
// a press beside the menu or on the card, or Escape or Tab, closes it with the card as it was. A
// press, not a click: a finger lifted from the card once the menu has opened lands its click on the
// card's copy, which must not close the menu. The keys count wherever the focus is while the menu
// is open. The card that lifts is a copy of the one on the board, which hides meanwhile; its word
// keeps the size it has there (the board hides the card itself while the menu is open, at rest, as
// it lies when nothing presses it, which is where the copy is measured from). The copy lands where
// the card is as the menu closes, which is somewhere else if the page has moved meanwhile, as when
// a finger dragged it or a clue put a line above the board; the card shows again once the copy has
// landed. Once the menu has closed, the card has the focus again if the menu had it. Where the
// device asks for less motion, nothing lifts or grows: the page dims at once, and the menu fades in
// and out. On a phone that can, it opens with a short buzz.
const props = defineProps<{ source: HTMLElement; word: string; current: Mark | null; team: Team }>();
const emit = defineEmits<{ choose: [mark: Mark]; close: [] }>();
const { t } = useI18n();

const KEYS: Record<Mark, string> = { ours: '1', theirs: '2', r2: '3' };
const colorOf = (mark: Mark) => (mark === 'ours' ? props.team : mark === 'theirs' ? otherTeam(props.team) : 'r2');

const lifted = ref<HTMLElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const open = ref(false);
const closing = ref(false);
const rect = props.source.getBoundingClientRect();
const place = ref<Record<string, string>>({ left: '0px', top: '0px' });
const cardStyle = ref({
  left: `${rect.left}px`,
  top: `${rect.top}px`,
  width: `${rect.width}px`,
  height: `${rect.height}px`,
});
const label = computed(() => t('game.gestures.menu', { word: props.word }));
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

onMounted(async () => {
  // The copy of the card, with the word at the size it has on the board, whose width sets it.
  const copy = props.source.cloneNode(true) as HTMLElement;
  copy.classList.remove('pressing', 'lifting');
  copy.removeAttribute('id');
  copy.setAttribute('tabindex', '-1');
  copy.setAttribute('aria-hidden', 'true');
  const word = props.source.querySelector('.word');
  const copyWord = copy.querySelector<HTMLElement>('.word');
  if (word && copyWord) copyWord.style.fontSize = getComputedStyle(word).fontSize;
  Object.assign(copy.style, { width: '100%', height: '100%' });
  lifted.value?.append(copy);
  if (typeof navigator.vibrate === 'function') navigator.vibrate(12);
  await nextTick();
  const box = menu.value;
  if (box) {
    const width = box.offsetWidth;
    const height = box.offsetHeight;
    const below = rect.bottom + 14 + height < innerHeight - 8;
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), innerWidth - width - 8);
    place.value = {
      left: `${left}px`,
      top: `${below ? rect.bottom + 14 : rect.top - 14 - height}px`,
      transformOrigin: `${rect.left + rect.width / 2 - left}px ${below ? 0 : height}px`,
    };
    (box.querySelector<HTMLElement>('[aria-checked="true"]') ?? box.querySelector<HTMLElement>('button'))?.focus({
      preventScroll: true,
    });
  }
  requestAnimationFrame(() => requestAnimationFrame(() => (open.value = true)));
  document.addEventListener('keydown', key);
});

// How long the copy takes to land (.closing .lifted). The menu waits a little longer at most, in
// case the end of the move goes unheard, as in a tab that is out of sight.
const LAND_MS = 220;
let timer: ReturnType<typeof setTimeout> | null = null;
let landed: (() => void) | null = null;
function close(mark?: Mark) {
  if (closing.value) return;
  closing.value = true;
  open.value = false;
  const hadFocus = hasFocus();
  const now = props.source.getBoundingClientRect();
  cardStyle.value = { ...cardStyle.value, left: `${now.left}px`, top: `${now.top}px` };
  landed = () => {
    if (!landed) return;
    landed = null;
    if (timer) clearTimeout(timer);
    if (mark) emit('choose', mark);
    emit('close');
    // The card on the board shows again once the board has heard, and can take the focus then.
    if (hadFocus) void nextTick(() => props.source.focus({ preventScroll: true }));
  };
  timer = setTimeout(landed, reduced() ? 150 : LAND_MS + 60);
}

// The copy has landed once its move has ended, not the menu's or the shadow's.
function onTransitionEnd(event: TransitionEvent) {
  if (closing.value && event.target === lifted.value && event.propertyName === 'transform') landed?.();
}

// Escape and Tab close the menu, wherever the focus is: Tab leaves no menu for the page behind
// the scrim. The arrows move the focus among the marks while it is in the menu.
function key(event: KeyboardEvent) {
  if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault();
    close();
    return;
  }
  if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || !hasFocus()) return;
  event.preventDefault();
  const items = [...(menu.value?.querySelectorAll<HTMLElement>('button') ?? [])];
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next = (at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
  items[next]?.focus();
}

// Whether the focus is in the menu, for the board, which takes the menu down at once when its
// card can take no mark any more, and gives the card the focus back then.
const hasFocus = () => menu.value?.contains(document.activeElement) ?? false;
defineExpose({ hasFocus });

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
  document.removeEventListener('keydown', key);
});
</script>

<template>
  <Teleport to="body">
    <div class="mark-menu" :class="{ open, closing }">
      <div class="scrim" @pointerdown="close()"></div>
      <div ref="lifted" class="lifted" :style="cardStyle" @pointerdown="close()" @transitionend="onTransitionEnd"></div>
      <div ref="menu" class="menu" role="menu" :aria-label="label" :style="place">
        <button
          v-for="mark in MARKS"
          :key="mark"
          type="button"
          role="menuitemradio"
          :aria-checked="current === mark"
          :class="{ current: current === mark }"
          @click="close(mark)"
        >
          <MarkSticker :mark="mark" :color="colorOf(mark)" />
          <span>{{ t(`game.gestures.marks.${mark}`) }}</span>
          <span class="key num" aria-hidden="true">{{ KEYS[mark] }}</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mark-menu {
  position: fixed;
  inset: 0;
  z-index: 35;
}

.scrim {
  position: absolute;
  inset: 0;
  background: transparent;
  -webkit-backdrop-filter: blur(0);
  backdrop-filter: blur(0);
  transition:
    background-color 260ms cubic-bezier(0.3, 0, 0.2, 1),
    backdrop-filter 260ms cubic-bezier(0.3, 0, 0.2, 1),
    -webkit-backdrop-filter 260ms cubic-bezier(0.3, 0, 0.2, 1);
}

.open .scrim {
  background: var(--scrim);
  -webkit-backdrop-filter: blur(5px);
  backdrop-filter: blur(5px);
}

/* The card lifts out of the page, from where the press sank it, and lands back as the menu closes. */
.lifted {
  position: absolute;
  transform: translate(2px, 2px) scale(0.96);
  transition: transform 340ms cubic-bezier(0.2, 1.35, 0.4, 1);
}

.lifted > :deep(.card) {
  box-shadow: 1px 1px 0 var(--ink);
  transition: box-shadow 340ms cubic-bezier(0.2, 1.35, 0.4, 1);
}

.open .lifted {
  transform: translate(-3px, -4px) scale(1.14);
}

.open .lifted > :deep(.card) {
  box-shadow: 7px 9px 0 var(--ink);
}

/* It lands with its shadow, in one move, also where the card is now somewhere else. */
.closing .lifted {
  transform: none;
  transition:
    transform 220ms cubic-bezier(0.3, 0, 0.2, 1),
    left 220ms cubic-bezier(0.3, 0, 0.2, 1),
    top 220ms cubic-bezier(0.3, 0, 0.2, 1);
}

.closing .lifted > :deep(.card) {
  box-shadow: var(--shadow-1);
  transition: box-shadow 220ms cubic-bezier(0.3, 0, 0.2, 1);
}

/* The menu grows from the card. */
.menu {
  position: absolute;
  min-width: 168px;
  padding: 6px;
  border: var(--line-strong) solid var(--ink);
  border-radius: 18px;
  background: var(--paper);
  box-shadow: var(--shadow-2);
  opacity: 0;
  transform: scale(0.35);
  transition:
    transform 300ms cubic-bezier(0.2, 1.35, 0.4, 1),
    opacity 180ms cubic-bezier(0.3, 0, 0.2, 1);
}

.open .menu {
  opacity: 1;
  transform: scale(1);
}

.closing .menu {
  opacity: 0;
  transform: scale(0.3);
  transition:
    transform 220ms cubic-bezier(0.3, 0, 0.2, 1),
    opacity 180ms cubic-bezier(0.3, 0, 0.2, 1);
}

.menu button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border: 0;
  border-radius: 12px;
  background: none;
  color: var(--ink);
  font: inherit;
  font-weight: var(--weight-display);
  text-align: start;
  cursor: pointer;
}

.menu button + button {
  margin-top: 2px;
}

.menu button:active {
  background: var(--paper-2);
}

/* The card's own mark: grey, with an ink ring. */
.menu button.current {
  background: var(--paper-2);
  box-shadow: inset 0 0 0 2px var(--ink);
  font-weight: var(--weight-black);
}

.key {
  margin-left: auto;
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}

/* Less motion: nothing lifts or grows, and the menu fades, which outweighs the page's rule that
   cuts every transition short (base.css). */
@media (prefers-reduced-motion: reduce) {
  .lifted,
  .open .lifted,
  .closing .lifted {
    transform: none;
    transition: none;
  }

  .menu,
  .open .menu,
  .closing .menu {
    transform: none;
    transition: opacity 150ms linear !important;
  }
}
</style>

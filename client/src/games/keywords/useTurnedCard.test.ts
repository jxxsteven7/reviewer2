// @vitest-environment happy-dom
import type { CardView, KeywordsView } from '@reviewer2/shared';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { TURN_MS, useTurnedCard, useTurnedSteps } from './useTurnedCard';

// Which card turns over, and when (useTurnedCard.ts): only one revealed in front of the viewer.

const page = vi.hoisted(() => ({ connection: { connected: true, everConnected: true, connects: 1 } }));
vi.mock('../../core/socket', () => ({ connection: page.connection }));

const hidden = (index: number): CardView => ({ word: `Word${index}`, revealed: false });
const cards = (revealed: number[]): CardView[] =>
  [0, 1, 2].map((index) =>
    revealed.includes(index) ? { ...hidden(index), revealed: true, color: 'red' as const } : hidden(index),
  );

function game(revealed: number[], more: Partial<KeywordsView> = {}): KeywordsView {
  return {
    gameId: 'g1',
    turn: 1,
    team: 'red',
    phase: 'guess',
    startingTeam: 'red',
    cards: cards(revealed),
    paused: false,
    remaining: { red: 9, blue: 8 },
    clue: null,
    guessesMade: revealed.length,
    guessesLeft: null,
    clock: null,
    history: [],
    events: [],
    extended: { red: false, blue: false },
    result: null,
    ...more,
  };
}

function mounted<T>(use: () => T): T {
  let used!: T;
  mount(
    defineComponent({
      setup() {
        used = use();
        return () => h('div');
      },
    }),
  );
  return used;
}

describe('the card that turns over in a game', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    page.connection.connects = 1;
  });
  afterEach(() => vi.useRealTimers());

  function turnedIn(first: KeywordsView) {
    const current = ref<KeywordsView | null>(first);
    const turned = mounted(() => useTurnedCard(current));
    return { current, turned };
  }

  test('is the card revealed in front of the viewer, for a while', async () => {
    const { current, turned } = turnedIn(game([]));
    expect(turned.value).toBeNull();
    current.value = game([1]);
    await nextTick();
    expect(turned.value).toBe(1);
    vi.advanceTimersByTime(TURN_MS - 1);
    expect(turned.value).toBe(1);
    vi.advanceTimersByTime(1);
    expect(turned.value).toBeNull();
  });

  test('turns nothing for the view the page opens with, several cards at once, or a new connection', async () => {
    const { current, turned } = turnedIn(game([0]));
    expect(turned.value).toBeNull();
    current.value = game([0, 1, 2]);
    await nextTick();
    expect(turned.value).toBeNull();

    // The first view on a new connection catches the page up, however many cards it brings.
    const again = turnedIn(game([0]));
    page.connection.connects = 2;
    again.current.value = game([0, 1]);
    await nextTick();
    expect(again.turned.value).toBeNull();
    again.current.value = game([0, 1, 2]);
    await nextTick();
    expect(again.turned.value).toBe(2);
  });

  test('turns nothing across a pause, which hides the board, or into another game', async () => {
    const { current, turned } = turnedIn(game([]));
    current.value = game([], { paused: true });
    await nextTick();
    current.value = game([1]);
    await nextTick();
    expect(turned.value).toBeNull();
    current.value = game([1, 2]);
    await nextTick();
    expect(turned.value).toBe(2);
    vi.advanceTimersByTime(TURN_MS);

    current.value = game([0], { gameId: 'g2' });
    await nextTick();
    expect(turned.value).toBeNull();
    current.value = game([0, 1], { gameId: 'g2' });
    await nextTick();
    expect(turned.value).toBe(1);
  });

  test('ends a turn still on when another game begins, or the game is paused', async () => {
    const { current, turned } = turnedIn(game([]));
    current.value = game([0]);
    await nextTick();
    expect(turned.value).toBe(0);
    vi.advanceTimersByTime(TURN_MS / 2);
    // The new game's cards all lie face down: none of them is turning.
    current.value = game([], { gameId: 'g2' });
    await nextTick();
    expect(turned.value).toBeNull();
    current.value = game([1], { gameId: 'g2' });
    await nextTick();
    expect(turned.value).toBe(1);
    current.value = game([1], { gameId: 'g2', paused: true });
    await nextTick();
    expect(turned.value).toBeNull();
    // The timer of the turn that ended early doesn't end the next turn.
    current.value = game([1], { gameId: 'g2' });
    await nextTick();
    current.value = game([1, 2], { gameId: 'g2' });
    await nextTick();
    expect(turned.value).toBe(2);
    vi.advanceTimersByTime(TURN_MS / 2);
    expect(turned.value).toBe(2);
    vi.advanceTimersByTime(TURN_MS / 2);
    expect(turned.value).toBeNull();
  });

  test('ends a turn still on when the page goes, and starts over for the next card', async () => {
    const { current, turned } = turnedIn(game([]));
    current.value = game([0]);
    await nextTick();
    vi.advanceTimersByTime(TURN_MS / 2);
    current.value = game([0, 1]);
    await nextTick();
    expect(turned.value).toBe(1);
    vi.advanceTimersByTime(TURN_MS / 2);
    expect(turned.value).toBe(1);
    vi.advanceTimersByTime(TURN_MS / 2);
    expect(turned.value).toBeNull();
  });
});

describe('the card that turns over in a replay', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('is the one that the step reveals; a jump over several, or back, turns none', async () => {
    const board: Ref<CardView[]> = ref(cards([]));
    const turned: Ref<number | null> = mounted(() => useTurnedSteps(board));
    board.value = cards([0]);
    await nextTick();
    expect(turned.value).toBe(0);
    board.value = cards([0, 1, 2]);
    await nextTick();
    expect(turned.value).toBe(0);
    vi.advanceTimersByTime(TURN_MS);
    expect(turned.value).toBeNull();
    board.value = cards([0]);
    await nextTick();
    expect(turned.value).toBeNull();
    board.value = cards([0, 2]);
    await nextTick();
    expect(turned.value).toBe(2);
  });

  test('ends the turn when the step goes back before it is over, and turns the card again on the step forward', async () => {
    const board: Ref<CardView[]> = ref(cards([0]));
    const turned: Ref<number | null> = mounted(() => useTurnedSteps(board));
    board.value = cards([0, 1]);
    await nextTick();
    expect(turned.value).toBe(1);
    vi.advanceTimersByTime(TURN_MS / 4);
    // Back: the card lies face down again, and no turn lays its color over it.
    board.value = cards([0]);
    await nextTick();
    expect(turned.value).toBeNull();
    // Forward again: the card turns anew, for a whole turn.
    board.value = cards([0, 1]);
    await nextTick();
    expect(turned.value).toBe(1);
    vi.advanceTimersByTime(TURN_MS - 1);
    expect(turned.value).toBe(1);
    vi.advanceTimersByTime(1);
    expect(turned.value).toBeNull();
    // A step on to a clue, with the card still face up, leaves the turn to run out.
    board.value = cards([0, 1, 2]);
    await nextTick();
    expect(turned.value).toBe(2);
    board.value = [...cards([0, 1, 2])];
    await nextTick();
    expect(turned.value).toBe(2);
  });
});

// @vitest-environment happy-dom
import type { CardView, KeywordsView } from '@reviewer2/shared';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { TURN_MS, turnedBetween, useTurnedCard, useTurnedSteps, type Turned } from './useTurnedCard';

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

describe('turnedBetween', () => {
  test('is the one card that has come face up, and nothing for none, several or another board', () => {
    expect(turnedBetween(cards([]), cards([1]))).toBe(1);
    expect(turnedBetween(cards([0]), cards([0, 2]))).toBe(2);
    expect(turnedBetween(cards([1]), cards([1]))).toBeNull();
    expect(turnedBetween(cards([]), cards([0, 1]))).toBeNull();
    expect(turnedBetween(cards([1]), cards([]))).toBeNull();
    expect(turnedBetween(cards([]).slice(0, 2), cards([1]))).toBeNull();
  });
});

describe('the card that turns over in a game', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    page.connection.connects = 1;
  });
  afterEach(() => vi.useRealTimers());

  function turnedIn(first: KeywordsView) {
    const current = ref<KeywordsView | null>(first);
    const me = ref<string | null>('bob');
    const turned = mounted(() => useTurnedCard(current, me));
    return { current, me, turned };
  }

  test('is the card revealed in front of the viewer, for a while', async () => {
    const { current, turned } = turnedIn(game([]));
    expect(turned.value).toBeNull();
    current.value = game([1]);
    await nextTick();
    expect(turned.value).toEqual({ card: 1, fromChoice: false });
    vi.advanceTimersByTime(TURN_MS - 1);
    expect(turned.value).toEqual({ card: 1, fromChoice: false });
    vi.advanceTimersByTime(1);
    expect(turned.value).toBeNull();
  });

  test("was the viewer's choice when they had chosen it, and not when someone else had", async () => {
    const { current, turned } = turnedIn(game([], { selections: [{ player: 'bob', card: 1 }] }));
    current.value = game([1]);
    await nextTick();
    expect(turned.value).toEqual({ card: 1, fromChoice: true });

    current.value = game([1], { selections: [{ player: 'cat', card: 2 }] });
    await nextTick();
    current.value = game([1, 2]);
    await nextTick();
    expect(turned.value).toEqual({ card: 2, fromChoice: false });
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
    expect(again.turned.value).toEqual({ card: 2, fromChoice: false });
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
    expect(turned.value).toEqual({ card: 2, fromChoice: false });
    vi.advanceTimersByTime(TURN_MS);

    current.value = game([0], { gameId: 'g2' });
    await nextTick();
    expect(turned.value).toBeNull();
    current.value = game([0, 1], { gameId: 'g2' });
    await nextTick();
    expect(turned.value).toEqual({ card: 1, fromChoice: false });
  });

  test('ends a turn still on when the page goes, and starts over for the next card', async () => {
    const { current, turned } = turnedIn(game([]));
    current.value = game([0]);
    await nextTick();
    vi.advanceTimersByTime(TURN_MS / 2);
    current.value = game([0, 1]);
    await nextTick();
    expect(turned.value).toEqual({ card: 1, fromChoice: false });
    vi.advanceTimersByTime(TURN_MS / 2);
    expect(turned.value).toEqual({ card: 1, fromChoice: false });
    vi.advanceTimersByTime(TURN_MS / 2);
    expect(turned.value).toBeNull();
  });
});

describe('the card that turns over in a replay', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('is the one that the step reveals; a jump over several, or back, turns none', async () => {
    const board: Ref<CardView[]> = ref(cards([]));
    const turned: Ref<Turned | null> = mounted(() => useTurnedSteps(board));
    board.value = cards([0]);
    await nextTick();
    expect(turned.value).toEqual({ card: 0, fromChoice: false });
    board.value = cards([0, 1, 2]);
    await nextTick();
    expect(turned.value).toEqual({ card: 0, fromChoice: false });
    vi.advanceTimersByTime(TURN_MS);
    expect(turned.value).toBeNull();
    board.value = cards([0]);
    await nextTick();
    expect(turned.value).toBeNull();
    board.value = cards([0, 2]);
    await nextTick();
    expect(turned.value).toEqual({ card: 2, fromChoice: false });
  });
});

// @vitest-environment happy-dom
import type { CardColor, ClueRecord, KeywordsView } from '@reviewer2/shared/keywords';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import { CALL_LINES, callLine, GROUP_CALLS } from './calls';
import { useGroupCalls } from './useGroupCalls';

// When a group is called out for a title its card brings (useGroupCalls.ts): only for the card that
// the viewer sees revealed, in front of them, with a line that names the group.

const page = vi.hoisted(() => ({ connection: { connected: true, everConnected: true, connects: 1 } }));
vi.mock('../../core/socket', () => ({ connection: page.connection }));
const callOutGroup = vi.hoisted(() => vi.fn());
vi.mock('../../core/emotes', () => ({ callOutGroup }));

// Red's first clue names 4 of its 9 cards; the cards it reveals are given, in order, by color.
const guess = (card: number, color: CardColor) => ({ card, color, player: 'bob', at: 0 });
function game(
  revealed: readonly CardColor[],
  result: KeywordsView['result'] = null,
  count: ClueRecord['count'] = 4,
): KeywordsView {
  const cards = Array.from({ length: 25 }, (_, index) => {
    const color = revealed[index];
    return color === undefined
      ? { word: `Word${index}`, revealed: false }
      : { word: `Word${index}`, revealed: true, color };
  });
  return {
    gameId: 'g1',
    turn: 1,
    team: 'red',
    phase: result ? 'over' : 'guess',
    startingTeam: 'red',
    cards,
    paused: false,
    remaining: { red: 9 - revealed.filter((color) => color === 'red').length, blue: 8 },
    clue: { word: 'Hint', count: count as number },
    guessesMade: revealed.length,
    guessesLeft: null,
    clock: null,
    history: [
      { turn: 1, team: 'red', at: 0, word: 'Hint', count, guesses: revealed.map((color, card) => guess(card, color)) },
    ],
    events: [],
    extended: { red: false, blue: false },
    result,
  };
}

function callsFor(first: KeywordsView) {
  const current = ref<KeywordsView | null>(first);
  mount(
    defineComponent({
      setup() {
        useGroupCalls(current);
        return () => h('div');
      },
    }),
    { global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] } },
  );
  return current;
}

const red: CardColor[] = ['red', 'red', 'red', 'red'];

describe('the call-out of a group', () => {
  beforeEach(() => {
    page.connection.connects = 1;
    callOutGroup.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  test('comes with the card that makes the opening record, naming the group', async () => {
    const current = callsFor(game(red.slice(0, 2)));
    current.value = game(red.slice(0, 3));
    await nextTick();
    expect(callOutGroup).not.toHaveBeenCalled();
    current.value = game(red);
    await nextTick();
    expect(callOutGroup).toHaveBeenCalledTimes(1);
    expect(callOutGroup).toHaveBeenCalledWith(
      'red',
      'Red group',
      expect.stringMatching(/Red group.*scoring/i),
      'accept',
    );
    // A fifth card calls nobody out again.
    current.value = game([...red, 'red']);
    await nextTick();
    expect(callOutGroup).toHaveBeenCalledTimes(1);
  });

  test('comes with the card that wins the heavenly hand, which outdoes the opening record', async () => {
    const eight: CardColor[] = Array.from({ length: 8 }, () => 'red');
    const current = callsFor(game(eight, null, 9));
    current.value = game([...eight, 'red'], { winner: 'red', reason: 'found' }, 9);
    await nextTick();
    expect(callOutGroup).toHaveBeenCalledTimes(1);
    expect(callOutGroup).toHaveBeenCalledWith(
      'red',
      'Red group',
      expect.stringMatching(/Red group[\s\S]*[Hh]eavenly hand|[Hh]eavenly hand[\s\S]*Red group/),
      'accept',
    );
  });

  test('comes with Reviewer 2 as the first card, to its own sound, and later in the turn as the fall at the first hurdle', async () => {
    const instant = callsFor(game([]));
    instant.value = game(['reviewer2'], { winner: 'blue', reason: 'reviewer2' });
    await nextTick();
    expect(callOutGroup).toHaveBeenCalledWith('red', 'Red group', expect.stringMatching(/[Dd]esk reject/), 'reviewer2');
    callOutGroup.mockClear();
    const hurdle = callsFor(game(['red']));
    hurdle.value = game(['red', 'reviewer2'], { winner: 'blue', reason: 'reviewer2' });
    await nextTick();
    expect(callOutGroup).toHaveBeenCalledTimes(1);
    expect(callOutGroup).toHaveBeenCalledWith('red', 'Red group', expect.stringMatching(/first hurdle/), 'reviewer2');
  });

  test('is not heard on a page that catches up on a new connection, or that is out of sight', async () => {
    const current = callsFor(game(red.slice(0, 3)));
    page.connection.connects = 2;
    current.value = game(red);
    await nextTick();
    expect(callOutGroup).not.toHaveBeenCalled();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    current.value = game([...red, 'reviewer2'], { winner: 'blue', reason: 'reviewer2' });
    await nextTick();
    expect(callOutGroup).not.toHaveBeenCalled();
  });

  // The lines themselves are compiled as the JSON is imported, so their keys are what can be
  // checked here; the locale tests hold both languages to the same keys.
  test('has a line for every call, drawn by the game and the turn', () => {
    for (const call of GROUP_CALLS) {
      const lines = en.game.calls[call] as Record<string, unknown>;
      expect(
        Object.keys(lines)
          .map(Number)
          .sort((a, b) => a - b),
      ).toEqual(Array.from({ length: CALL_LINES }, (_, i) => i + 1));
    }
    const drawn = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((turn) => callLine('g1', turn, 'heavenly_hand')));
    expect([...drawn].every((line) => line >= 1 && line <= CALL_LINES)).toBe(true);
    expect(drawn.size).toBeGreaterThan(1);
  });
});

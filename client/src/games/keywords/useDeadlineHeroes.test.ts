// @vitest-environment happy-dom
import type { KeywordsView, PlayerView } from '@reviewer2/shared';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import { useDeadlineHeroes } from './useDeadlineHeroes';

// When a deadline hero is called out (useDeadlineHeroes.ts): only for the card that the viewer sees
// revealed, in front of them.

const page = vi.hoisted(() => ({ connection: { connected: true, everConnected: true, connects: 1 } }));
vi.mock('../../core/socket', () => ({ connection: page.connection }));
const callOut = vi.hoisted(() => vi.fn());
vi.mock('../../core/emotes', () => ({ callOut }));

const hidden = (index: number) => ({ word: `Word${index}`, revealed: false });

function game(revealed: number[], events: KeywordsView['events'] = []): KeywordsView {
  return {
    gameId: 'g1',
    turn: 1,
    team: 'red',
    phase: 'guess',
    startingTeam: 'red',
    cards: [0, 1, 2].map((index) =>
      revealed.includes(index) ? { ...hidden(index), revealed: true, color: 'red' as const } : hidden(index),
    ),
    paused: false,
    remaining: { red: 9, blue: 8 },
    clue: null,
    guessesMade: revealed.length,
    guessesLeft: null,
    clock: null,
    history: [
      {
        turn: 1,
        team: 'red',
        word: 'Hint',
        count: 2,
        guesses: revealed.map((card) => ({ card, color: 'red' as const, player: 'bob', lastSeconds: true as const })),
      },
    ],
    events,
    extended: { red: false, blue: false },
    result: null,
  };
}

const hero = { turn: 1, kind: 'hero' as const, team: 'red' as const, player: 'bob', count: 2 };
const players: PlayerView[] = [{ id: 'bob', name: 'Bob', online: true }];

function heroesFor(first: KeywordsView) {
  const current = ref<KeywordsView | null>(first);
  mount(
    defineComponent({
      setup() {
        useDeadlineHeroes(current, ref(players));
        return () => h('div');
      },
    }),
    { global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] } },
  );
  return current;
}

describe('the call-out of a deadline hero', () => {
  beforeEach(() => {
    page.connection.connects = 1;
    callOut.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  test('comes with the card that the viewer sees revealed, with the count', async () => {
    const current = heroesFor(game([]));
    current.value = game([1], [hero]);
    await nextTick();
    expect(callOut).toHaveBeenCalledTimes(1);
    expect(callOut).toHaveBeenCalledWith(players[0], expect.stringMatching(/Bob.*\(×2\)$/), 'accept');
    // The same hero on record calls nobody out again.
    current.value = game([1, 2], [hero]);
    await nextTick();
    expect(callOut).toHaveBeenCalledTimes(1);
  });

  test('is not heard on a page that catches up on a new connection, or that is out of sight', async () => {
    const current = heroesFor(game([]));
    page.connection.connects = 2;
    current.value = game([1], [hero]);
    await nextTick();
    expect(callOut).not.toHaveBeenCalled();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    current.value = game([1, 2], [hero, { ...hero, turn: 2 }]);
    await nextTick();
    expect(callOut).not.toHaveBeenCalled();
  });
});

// @vitest-environment happy-dom
import { type RoomView } from '@reviewer2/shared';
import { defaultSettings, type ClueRecord, type KeywordsRoomData, type KeywordsView } from '@reviewer2/shared/keywords';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { END_FLOAT_MS, FLOAT_MS, useScoreFloats } from './useScoreFloats';

// Which numbers rise, and when (useScoreFloats.ts): only for what happens in front of the viewer.

const page = vi.hoisted(() => ({ connection: { connected: true, everConnected: true, connects: 1 } }));
vi.mock('../../core/socket', () => ({ connection: page.connection }));

const hidden = (index: number) => ({ word: `Word${index}`, revealed: false });

function game(revealed: number[], result: KeywordsView['result'] = null): KeywordsView {
  return {
    gameId: 'g1',
    turn: 1,
    team: 'red',
    phase: result ? 'over' : 'guess',
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
        at: 0,
        word: 'Hint',
        count: 2,
        guesses: revealed.map((card) => ({ card, color: 'red' as const, player: 'bob', at: 0 })),
      },
    ],
    events: [],
    extended: { red: false, blue: false },
    result,
  };
}

function room(view: KeywordsView, more: Partial<RoomView> = {}): RoomView {
  const data: KeywordsRoomData = {
    settings: defaultSettings('en'),
    seats: { ann: { team: 'red', role: 'captain' }, bob: { team: 'red', role: 'guesser' } },
    keyViewers: ['ann'],
    side: 'red',
    lineup: 'free',
    joinsNext: false,
    startProblems: [],
    mayEmote: true,
    titles: {},
    game: view,
  };
  return {
    roomId: 'r1',
    code: 'K7QX',
    rev: 1,
    game: 'keywords',
    language: 'en',
    fields: ['general'],
    randomFields: false,
    public: false,
    customWordCount: 0,
    phase: 'playing',
    round: 1,
    gameId: 'g1',
    chairId: 'ann',
    players: [],
    agents: false,
    screens: 0,
    me: 'bob',
    match: null,
    streaks: [],
    duos: [],
    agentsPlayed: false,
    points: [],
    data,
    ...more,
  };
}

function floatsFor(first: RoomView) {
  const current = ref(first);
  let floats!: ReturnType<typeof useScoreFloats>;
  mount(
    defineComponent({
      setup() {
        floats = useScoreFloats(current);
        return () => h('div');
      },
    }),
  );
  return { current, floats: () => floats };
}

describe('the numbers that rise', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    page.connection.connects = 1;
  });
  afterEach(() => vi.useRealTimers());

  test('rise from a card revealed in front of the viewer, and on the avatars, for a while', async () => {
    const { current, floats } = floatsFor(room(game([])));
    current.value = room(game([1]));
    await nextTick();
    expect(floats().card.value).toMatchObject({ card: 1, text: '+1', team: 'red' });
    expect([...floats().players.value.keys()]).toEqual(['ann', 'bob']);
    vi.advanceTimersByTime(FLOAT_MS);
    expect(floats().card.value).toBeNull();
    expect(floats().players.value.size).toBe(0);
  });

  test('do not rise for what a new connection catches the page up on, or for several cards at once', async () => {
    const { current, floats } = floatsFor(room(game([])));
    page.connection.connects = 2;
    current.value = room(game([1]));
    await nextTick();
    expect(floats().card.value).toBeNull();
    current.value = room(game([0, 1, 2]));
    await nextTick();
    expect(floats().card.value).toBeNull();
  });

  test('do not rise in a game that an AI has played in', async () => {
    const { current, floats } = floatsFor(room(game([]), { agentsPlayed: true }));
    current.value = room(game([1]), { agentsPlayed: true });
    await nextTick();
    expect(floats().card.value).toBeNull();
    expect(floats().players.value.size).toBe(0);
  });

  test("rise big at the end with what it added to the viewer's points, from the server's points", async () => {
    const { current, floats } = floatsFor(room(game([])));
    const detail = { role: 'guesser', found: 1, won: true, irrelevant: 0, wrong: 0, reviewer2: 0 };
    current.value = room(game([], { winner: 'red', reason: 'found' }), {
      phase: 'ended',
      points: [{ playerId: 'bob', points: 4, detail }],
    });
    await nextTick();
    expect(floats().end.value).toMatchObject({ text: '+3', team: 'red' });
    vi.advanceTimersByTime(END_FLOAT_MS);
    expect(floats().end.value).toBeNull();
  });

  test('allow at the end for the point of an opening record that rose, which the heavenly hand outdid', async () => {
    // Five cards, all red, and a first clue of 4: the fourth card makes the opening record, and the
    // fifth wins the game in the same turn, the heavenly hand.
    const five = (revealed: number[], result: KeywordsView['result'] = null): KeywordsView => {
      const view = game(revealed, result);
      return {
        ...view,
        cards: [0, 1, 2, 3, 4].map((index) =>
          revealed.includes(index) ? { ...hidden(index), revealed: true, color: 'red' as const } : hidden(index),
        ),
        history: [{ ...(view.history[0] as ClueRecord), count: 4 }],
      };
    };
    const { current, floats } = floatsFor(room(five([0, 1, 2])));
    current.value = room(five([0, 1, 2, 3]));
    await nextTick();
    expect(floats().card.value).toMatchObject({ text: '+2', team: 'red' });
    const detail = {
      role: 'guesser',
      found: 5,
      won: true,
      irrelevant: 0,
      wrong: 0,
      reviewer2: 0,
      bigClues: 0,
      missed: 0,
      openingRecord: false,
      heavenlyHand: true,
    };
    current.value = room(five([0, 1, 2, 3, 4], { winner: 'red', reason: 'found' }), {
      phase: 'ended',
      points: [{ playerId: 'bob', points: 9, detail }],
    });
    await nextTick();
    expect(floats().end.value).toMatchObject({ text: '+3', team: 'red' });
  });
});

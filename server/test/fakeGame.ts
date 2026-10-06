import type { GameModule } from '../src/core/game';

// A tiny game for testing the shared layer. Players press a button; each viewer sees a line
// meant only for them, which shows whether snapshots are really built per connection. A player can
// also break one part of the game, which then throws until someone mends it.

export interface FakeData {
  joined: string[];
  benched: string[];
  presses: number;
  words: string[];
  gameId: string | null;
  over: boolean;
  broken: 'join' | 'leave' | 'view' | null;
  // A fragile game ends as soon as a player leaves it or is moved to the spectators.
  fragile: boolean;
}

// The view leaves the game's ID out on purpose: the chair's controls have to work with what the
// room itself says, whatever a game puts into its own part.
export interface FakeView {
  presses: number;
  words: string[];
  benched: string[];
  forViewer: string;
}

export const fakeGame: GameModule<FakeData, FakeView> = {
  id: 'test',
  wordsNeeded: 3,
  create: () => ({
    joined: [],
    benched: [],
    presses: 0,
    words: [],
    gameId: null,
    over: false,
    broken: null,
    fragile: false,
  }),
  join(data, id) {
    if (data.broken === 'join') throw new Error('joining broke');
    return { ...data, joined: [...data.joined, id] };
  },
  leave(data, id) {
    if (data.broken === 'leave') throw new Error('leaving broke');
    return { ...data, joined: data.joined.filter((other) => other !== id), over: data.over || data.fragile };
  },
  bench: (data, _ctx, id) => ({ ...data, benched: [...data.benched, id], over: data.over || data.fragile }),
  shuffle: (data) => ({ ...data, joined: [...data.joined].reverse() }),
  startProblems: (data, ctx) => (data.joined.filter((id) => ctx.isOnline(id)).length < 2 ? ['needs_players'] : []),
  start: (data, _ctx, words, gameId) => ({
    ...data,
    words: words.map(({ word }) => word),
    gameId,
    presses: 0,
    over: false,
  }),
  isOver: (data) => data.over,
  withdraw(data, gameId) {
    if (gameId !== data.gameId) return { ok: false, error: 'stale' };
    if (data.over) return { ok: false, error: 'game_over' };
    return { ok: true, data: { ...data, over: true } };
  },
  again: (data) => ({ ...data, words: [], gameId: null, over: false }),
  handle(data, ctx, _playerId, type, payload) {
    if (type === 'test:break') return { ok: true, data: { ...data, broken: payload as FakeData['broken'] } };
    if (type === 'test:mend') return { ok: true, data: { ...data, broken: null } };
    if (type === 'test:fragile') return { ok: true, data: { ...data, fragile: true } };
    // A refusal with more in it than a code: something that the game knows, and something that
    // can't be sent at all.
    if (type === 'test:refuse') return { ok: false, error: 'odd', secret: data.words, count: 10n } as never;
    // A module may throw anything at all, not only errors.
    if (type === 'test:throw') throw payload;
    if (ctx.phase !== 'playing') return { ok: false, error: 'wrong_phase' };
    if (type === 'test:press') return { ok: true, data: { ...data, presses: data.presses + 1 } };
    if (type === 'test:finish') return { ok: true, data: { ...data, over: true } };
    if (type === 'test:explode') throw new Error('the game broke');
    return { ok: false, error: 'bad_request' };
  },
  view(data, _ctx, viewer) {
    if (data.broken === 'view') throw new Error('the view broke');
    return {
      presses: data.presses,
      words: data.words,
      benched: data.benched,
      forViewer: 'playerId' in viewer ? `for ${viewer.playerId}` : 'for screens',
    };
  },
};

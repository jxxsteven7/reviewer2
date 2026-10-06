import type { GameModule } from '../src/core/game';

// A tiny game for testing the shared layer. Players press a button; each viewer sees a line
// meant only for them, which shows whether snapshots are really built per connection.

export interface FakeData {
  joined: string[];
  benched: string[];
  presses: number;
  words: string[];
  gameId: string | null;
  over: boolean;
  explode: boolean;
}

export interface FakeView {
  gameId: string | null;
  presses: number;
  words: string[];
  benched: string[];
  forViewer: string;
}

export const fakeGame: GameModule<FakeData, FakeView> = {
  id: 'test',
  wordsNeeded: 3,
  create: () => ({ joined: [], benched: [], presses: 0, words: [], gameId: null, over: false, explode: false }),
  join: (data, id) => ({ ...data, joined: [...data.joined, id] }),
  leave: (data, id) => ({ ...data, joined: data.joined.filter((other) => other !== id) }),
  bench: (data, _ctx, id) => ({ ...data, benched: [...data.benched, id] }),
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
  handle(data, ctx, _playerId, type) {
    if (ctx.phase !== 'playing') return { ok: false, error: 'wrong_phase' };
    if (type === 'test:press') return { ok: true, data: { ...data, presses: data.presses + 1 } };
    if (type === 'test:finish') return { ok: true, data: { ...data, over: true } };
    if (type === 'test:explode') throw new Error('the game broke');
    return { ok: false, error: 'bad_request' };
  },
  view: (data, _ctx, viewer) => ({
    gameId: data.gameId,
    presses: data.presses,
    words: data.words,
    benched: data.benched,
    forViewer: 'playerId' in viewer ? `for ${viewer.playerId}` : 'for screens',
  }),
};

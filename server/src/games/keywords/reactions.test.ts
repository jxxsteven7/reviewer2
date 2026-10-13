import { describe, expect, test } from 'vitest';
import { keywordsGame } from './index';
import { seatedGame } from './testing';

// The quick reactions that whoever has seen the key holds back while the students guess
// (docs/games/keywords.md#quick-reactions).

describe('quick reactions in a game', () => {
  const gameId = 'g1';
  const everyone = ['ann', 'bob', 'cat', 'dan'];
  const may = (game: ReturnType<typeof seatedGame>, id: string) =>
    keywordsGame.mayEmote?.(game.data, id, game.ctx) ?? true;
  const allowed = (game: ReturnType<typeof seatedGame>) => everyone.filter((id) => may(game, id));
  const inViews = (game: ReturnType<typeof seatedGame>) => {
    const view = keywordsGame.views(game.data, game.ctx);
    return everyone.filter((id) => view({ playerId: id }).mayEmote);
  };
  const pis = ['ann', 'cat'];
  const students = ['bob', 'dan'];
  // The PI of the group on turn gives a clue, and its students guess.
  const guessing = () => {
    const game = seatedGame();
    const first = game.data.game?.team ?? 'red';
    const pi = first === 'red' ? 'ann' : 'cat';
    game.send(pi, 'keywords:clue', { gameId, turn: 1, word: 'Hint', count: 1 });
    return { game, first, pi };
  };

  test('come from everyone while a PI thinks of the clue, and in the waiting room', () => {
    const game = seatedGame();
    expect(allowed(game)).toEqual(everyone);
    expect(inViews(game)).toEqual(everyone);
    const lobby = { ...game.data, game: null };
    expect(everyone.filter((id) => keywordsGame.mayEmote?.(lobby, id, game.ctx))).toEqual(everyone);
    // A screen, which sends none, isn't told it may not.
    expect(keywordsGame.views(game.data, game.ctx)({ screen: true }).mayEmote).toBe(true);
  });

  test('come from no PI of either group while the students guess, paused or not, and from the students', () => {
    const { game } = guessing();
    expect(allowed(game)).toEqual(students);
    expect(inViews(game)).toEqual(students);
    game.send('ann', 'keywords:pause', { gameId });
    expect(allowed(game)).toEqual(students);
  });

  test('come from no one who has seen the key, after stepping out to watch or taking the seat back', () => {
    const { game, first, pi } = guessing();
    // The PI steps out to watch: still no reaction, in the view either, since the key is seen.
    game.send(pi, 'keywords:seat', { team: null, role: 'spectator' });
    expect(game.data.seating.seats.get(pi)).toEqual({ team: null, role: 'spectator' });
    expect(allowed(game)).toEqual(students);
    expect(inViews(game)).toEqual(students);
    // Back in the seat, the same; the other PI, who stepped out too, the same.
    game.send(pi, 'keywords:seat', { team: first, role: 'captain' });
    const other = pi === 'ann' ? 'cat' : 'ann';
    game.send(other, 'keywords:seat', { team: null, role: 'spectator' });
    expect(allowed(game)).toEqual(students);
    expect(inViews(game)).toEqual(students);
    // Someone who has never seen the key, as a spectator who came to watch, may react.
    expect(may(game, 'eve')).toBe(true);
  });

  test('come from everyone again once the turn or the game is over', () => {
    const { game, first, pi } = guessing();
    const student = first === 'red' ? 'bob' : 'dan';
    const own = game.data.game?.cards.findIndex((card) => card.color === first) ?? -1;
    game.send(student, 'keywords:reveal', { gameId, turn: 1, card: own });
    game.send(student, 'keywords:pass', { gameId, turn: 1 });
    expect(allowed(game)).toEqual(everyone);
    expect(inViews(game)).toEqual(everyone);
    expect(pis.every((id) => may(game, id))).toBe(true);
    // The other group reveals Reviewer 2 and the game is over: everyone may react, the PI who
    // stepped out to watch meanwhile included.
    const [otherPi, otherStudent] = pi === 'ann' ? ['cat', 'dan'] : ['ann', 'bob'];
    game.send(otherPi, 'keywords:clue', { gameId, turn: 2, word: 'Clue', count: 1 });
    expect(allowed(game)).toEqual(students);
    const r2 = game.data.game?.cards.findIndex((card) => card.color === 'reviewer2') ?? -1;
    game.send(otherStudent, 'keywords:reveal', { gameId, turn: 2, card: r2 });
    game.send(pi, 'keywords:seat', { team: null, role: 'spectator' });
    expect(game.data.game?.phase).toBe('over');
    expect(allowed(game)).toEqual(everyone);
    expect(inViews(game)).toEqual(everyone);
  });
});

import { describe, expect, test } from 'vitest';
import { keywordsGame } from './index';
import { seatedGame } from './testing';

// The quick reactions that a PI holds back while the students guess (docs/games/keywords.md#quick-reactions).

describe('quick reactions in a game', () => {
  const gameId = 'g1';
  const everyone = ['ann', 'bob', 'cat', 'dan'];
  const allowed = (game: ReturnType<typeof seatedGame>) =>
    everyone.filter((id) => keywordsGame.mayEmote?.(game.data, id) ?? true);
  const inViews = (game: ReturnType<typeof seatedGame>) => {
    const view = keywordsGame.views(game.data, game.ctx);
    return everyone.filter((id) => view({ playerId: id }).mayEmote);
  };
  const pis = ['ann', 'cat'];
  const students = ['bob', 'dan'];

  test('come from everyone while a PI thinks of the clue, and in the waiting room', () => {
    const game = seatedGame();
    expect(allowed(game)).toEqual(everyone);
    expect(inViews(game)).toEqual(everyone);
    const lobby = { ...game.data, game: null };
    expect(everyone.filter((id) => keywordsGame.mayEmote?.(lobby, id))).toEqual(everyone);
    // A screen, which sends none, isn't told it may not.
    expect(keywordsGame.views(game.data, game.ctx)({ screen: true }).mayEmote).toBe(true);
  });

  test('come from no PI of either group while the students guess, paused or not, and from the students', () => {
    const game = seatedGame();
    const pi = game.data.game?.team === 'red' ? 'ann' : 'cat';
    game.send(pi, 'keywords:clue', { gameId, turn: 1, word: 'Hint', count: 1 });
    expect(allowed(game)).toEqual(students);
    expect(inViews(game)).toEqual(students);
    game.send('ann', 'keywords:pause', { gameId });
    expect(allowed(game)).toEqual(students);
  });

  test('come from everyone again once the turn or the game is over', () => {
    const game = seatedGame();
    const first = game.data.game?.team;
    const [pi, student] = first === 'red' ? ['ann', 'bob'] : ['cat', 'dan'];
    game.send(pi, 'keywords:clue', { gameId, turn: 1, word: 'Hint', count: 1 });
    const own = game.data.game?.cards.findIndex((card) => card.color === first) ?? -1;
    game.send(student, 'keywords:reveal', { gameId, turn: 1, card: own });
    game.send(student, 'keywords:pass', { gameId, turn: 1 });
    expect(allowed(game)).toEqual(everyone);
    expect(pis.every((id) => keywordsGame.mayEmote?.(game.data, id))).toBe(true);
  });
});

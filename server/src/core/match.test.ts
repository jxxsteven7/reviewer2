import type { MatchRules } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import type { MatchScore } from './game';
import { Match, rankings, titlesFor, type Present } from './match';

// The match itself: totals, places and titles. How a game scores is the game's (see the tests of
// games/keywords/match.ts); how the room drives a match is in test/match.test.ts.

const RULES: MatchRules = { games: 2, teams: 'switch', grouping: 'random' };

// Everyone in `here` is in the room, with their key as their name and as their player ID.
const presentOnly =
  (...here: string[]): Present =>
  (key) =>
    here.includes(key) ? { id: `id-${key}`, name: key, avatar: null } : null;

const scores = (points: Record<string, number>): MatchScore[] =>
  Object.entries(points).map(([key, value]) => ({ key, points: value, detail: { value } }));

const totals = (players: Record<string, number>) => Object.entries(players).map(([key, total]) => ({ key, total }));

describe('places', () => {
  test('go by total, with ties sharing a place and the next place skipping as many', () => {
    expect(rankings(totals({ ann: 5, bob: 9, cat: 5, dee: 1 }))).toEqual(
      new Map([
        ['ann', 2],
        ['bob', 1],
        ['cat', 2],
        ['dee', 4],
      ]),
    );
  });
});

describe('titles', () => {
  test('go to everyone with the highest total and everyone with the lowest', () => {
    expect(titlesFor(totals({ ann: 9, bob: 9, cat: 3, dee: -2, eve: -2 }))).toEqual(
      new Map([
        ['ann', 'best_paper'],
        ['bob', 'best_paper'],
        ['dee', 'black_hole'],
        ['eve', 'black_hole'],
      ]),
    );
  });

  test('have no black hole with fewer than three ranked players', () => {
    expect(titlesFor(totals({ ann: 9, bob: 3 }))).toEqual(new Map([['ann', 'best_paper']]));
    // One player alone has the same total as everyone.
    expect(titlesFor(totals({ ann: 9 }))).toEqual(new Map());
  });

  test('go to nobody when everyone has the same total, or nobody is ranked', () => {
    expect(titlesFor(totals({ ann: 4, bob: 4, cat: 4 }))).toEqual(new Map());
    expect(titlesFor([])).toEqual(new Map());
  });
});

describe('a match', () => {
  test('adds up its games, and is over after the last', () => {
    const match = new Match(RULES);
    const here = presentOnly('ann', 'bob', 'cat', 'dee');
    match.score('g1', scores({ ann: 5, bob: 5, cat: -1, dee: 0 }), here);
    expect(match).toMatchObject({ played: 1, status: 'on', final: null });
    match.score('g2', scores({ ann: 1, bob: 4, cat: 4, dee: -3 }), here);
    expect(match).toMatchObject({ played: 2, status: 'over' });
    expect(match.final).toEqual(
      new Map([
        ['ann', { rank: 2, total: 6, title: null }],
        ['bob', { rank: 1, total: 9, title: 'best_paper' }],
        ['cat', { rank: 3, total: 3, title: null }],
        ['dee', { rank: 4, total: -3, title: 'black_hole' }],
      ]),
    );
  });

  test('scores a game once, however often its end is reported, and nothing once it is over', () => {
    const match = new Match({ ...RULES, games: 1 });
    const here = presentOnly('ann');
    match.score('g1', scores({ ann: 3 }), here);
    match.score('g1', scores({ ann: 3 }), here);
    match.score('g2', scores({ ann: 3 }), here);
    expect(match.played).toBe(1);
    expect(match.view('ended', 'g1', null, here).standings[0]).toMatchObject({ total: 3, delta: 3, games: 1 });
  });

  test('ranks only those still in the room who took part in a scored game', () => {
    const match = new Match(RULES);
    match.enter('new', 'New', null);
    match.score('g1', scores({ ann: 4, bob: 9, cat: 2, gone: 20 }), presentOnly('ann', 'bob', 'cat', 'gone', 'new'));
    expect(match.final).toBeNull();
    const view = match.view('ended', 'g1', null, presentOnly('ann', 'bob', 'cat', 'new'));
    expect(view.standings.map(({ name, rank, left }) => ({ name, rank, left }))).toEqual([
      { name: 'bob', rank: 1, left: false },
      { name: 'ann', rank: 2, left: false },
      { name: 'cat', rank: 3, left: false },
      { name: 'new', rank: null, left: false },
      { name: 'gone', rank: null, left: true },
    ]);
  });

  test('keeps the places it ended with, whoever leaves afterwards', () => {
    const match = new Match({ ...RULES, games: 1 });
    match.score('g1', scores({ ann: 4, bob: 9, cat: 2 }), presentOnly('ann', 'bob', 'cat'));
    const view = match.view('ended', 'g1', null, presentOnly('ann'));
    expect(view.standings.map(({ name, rank, title, left }) => ({ name, rank, title, left }))).toEqual([
      { name: 'bob', rank: 1, title: 'best_paper', left: true },
      { name: 'ann', rank: 2, title: undefined, left: false },
      { name: 'cat', rank: 3, title: 'black_hole', left: true },
    ]);
  });

  test('stopped early ranks the players as they stand, and awards nothing', () => {
    const match = new Match({ ...RULES, games: 3 });
    const here = presentOnly('ann', 'bob', 'cat');
    match.score('g1', scores({ ann: 4, bob: 9, cat: 2 }), here);
    match.finish('stopped', here);
    expect(match.status).toBe('stopped');
    expect([...(match.final?.values() ?? [])].map(({ title }) => title)).toEqual([null, null, null]);
    match.finish('over', here);
    expect(match.status).toBe('stopped');
  });

  test('stopped before any game has scored ranks nobody', () => {
    const match = new Match(RULES);
    match.enter('ann', 'ann', null);
    match.finish('stopped', presentOnly('ann'));
    expect(match.final).toEqual(new Map());
    expect(match.view('lobby', null, null, presentOnly('ann'))).toMatchObject({ game: 1, played: 0 });
  });
});

describe('the table of a match', () => {
  const here = presentOnly('ann', 'bob');

  test('shows the points of the game being played as they stand, apart from the totals', () => {
    const match = new Match(RULES);
    match.enter('ann', 'ann', null);
    match.enter('bob', 'bob', null);
    const view = match.view('playing', 'g1', scores({ ann: 2, bob: -1 }), here);
    expect(view).toMatchObject({ game: 1, played: 0, status: 'on' });
    expect(view.standings).toEqual([
      { playerId: 'id-ann', name: 'ann', total: 0, delta: 2, detail: { value: 2 }, games: 0, rank: null, left: false },
      {
        playerId: 'id-bob',
        name: 'bob',
        total: 0,
        delta: -1,
        detail: { value: -1 },
        games: 0,
        rank: null,
        left: false,
      },
    ]);
  });

  test('shows a scored game in its totals, and its points until the next game starts', () => {
    const match = new Match(RULES);
    match.score('g1', scores({ ann: 2, bob: 5 }), here);
    const ended = match.view('ended', 'g1', null, here);
    expect(ended.game).toBe(1);
    expect(ended.standings.map(({ name, total, delta, rank }) => ({ name, total, delta, rank }))).toEqual([
      { name: 'bob', total: 5, delta: 5, rank: 1 },
      { name: 'ann', total: 2, delta: 2, rank: 2 },
    ]);
    const lobby = match.view('lobby', null, null, here);
    expect(lobby.game).toBe(2);
    expect(lobby.standings.map(({ delta }) => delta)).toEqual([5, 2]);
    const next = match.view('playing', 'g2', scores({ ann: 1 }), here);
    expect(next.standings.map(({ name, delta }) => ({ name, delta }))).toEqual([
      { name: 'bob', delta: null },
      { name: 'ann', delta: 1 },
    ]);
  });

  test('shows no points for a game that was withdrawn', () => {
    const match = new Match(RULES);
    match.score('g1', scores({ ann: 2 }), here);
    const view = match.view('ended', 'g2', null, here);
    expect(view.game).toBe(2);
    expect(view.standings[0]).toMatchObject({ total: 2, delta: null });
  });

  test('keeps the name and avatar of those who left, and shows those of the players who are here', () => {
    const match = new Match(RULES);
    match.enter('ann', 'Ann', '/avatars/a.webp');
    match.enter('bob', 'Bob', null);
    const view = match.view('lobby', null, null, (key) =>
      key === 'bob' ? { id: 'b', name: 'Bobby', avatar: '/avatars/b.webp' } : null,
    );
    expect(view.standings.map(({ playerId, name, avatar, left }) => ({ playerId, name, avatar, left }))).toEqual([
      { playerId: 'b', name: 'Bobby', avatar: '/avatars/b.webp', left: false },
      { playerId: null, name: 'Ann', avatar: '/avatars/a.webp', left: true },
    ]);
  });

  test("moves a guest's line to their account, and adds it to the account's own", () => {
    const match = new Match({ ...RULES, games: 3 });
    match.score('g1', scores({ guest: 3, account: 1 }), presentOnly('guest', 'account'));
    match.rekey('guest', 'newcomer');
    expect(match.view('lobby', null, null, presentOnly('newcomer', 'account')).standings).toMatchObject([
      { name: 'newcomer', total: 3, games: 1 },
      { name: 'account', total: 1, games: 1 },
    ]);
    match.rekey('newcomer', 'account');
    expect(match.view('lobby', null, null, presentOnly('account')).standings).toMatchObject([
      { name: 'account', total: 4, games: 2, delta: 3 },
    ]);
  });

  test('lists the ranked by their place at the end, before those who came back unranked', () => {
    const match = new Match({ ...RULES, games: 1 });
    match.enter('bob', 'bob', null);
    match.score('g1', scores({ ann: 4, bob: 12, cat: 2 }), presentOnly('ann', 'cat'));
    // Bob left during the last game, and is back after the end.
    const view = match.view('ended', 'g1', null, presentOnly('ann', 'bob', 'cat'));
    expect(view.standings.map(({ name, rank }) => ({ name, rank }))).toEqual([
      { name: 'ann', rank: 1 },
      { name: 'cat', rank: 2 },
      { name: 'bob', rank: null },
    ]);
  });

  test('is a copy that shares nothing with the match', () => {
    const match = new Match(RULES);
    match.score('g1', scores({ ann: 2 }), here);
    const view = match.view('ended', 'g1', null, here);
    (view.standings[0]?.detail as { value: number }).value = 99;
    view.rules.games = 9;
    expect(match.view('ended', 'g1', null, here).standings[0]?.detail).toEqual({ value: 2 });
    expect(match.rules.games).toBe(2);
  });
});

import { readFileSync } from 'node:fs';
import type { PlayerView } from '@reviewer2/shared';
import { SPECTATOR, type KeywordsView, type Seat } from '@reviewer2/shared/keywords';
import { describe, expect, test } from 'vitest';
import { agentMoving, bannerFor, type BannerLine } from './banner';

// The locale files as text: imported, they are compiled for vue-i18n, and their strings are gone.
interface Locale {
  banner: { seat: string; spectator: string; lines: Record<BannerLine, string> };
}
const locale = (name: string): Locale =>
  JSON.parse(readFileSync(new URL(`../../locales/${name}.json`, import.meta.url), 'utf8')) as Locale;
const en = locale('en');
const zh = locale('zh');

const game = (team: 'red' | 'blue', phase: KeywordsView['phase'], over = false) =>
  ({ team, phase, result: over ? { winner: 'red', reason: 'found' } : null }) as KeywordsView;

const redPi: Seat = { team: 'red', role: 'captain' };
const redStudent: Seat = { team: 'red', role: 'guesser' };

describe('the banner', () => {
  test('tells a PI and a student what their group is doing, and when it is their move', () => {
    expect(bannerFor(redPi, game('red', 'clue'))).toEqual({ line: 'yourClue', group: null, urgent: true });
    expect(bannerFor(redPi, game('red', 'guess'))).toEqual({ line: 'studentsGuessing', group: null, urgent: false });
    expect(bannerFor(redStudent, game('red', 'clue'))).toEqual({ line: 'piThinking', group: null, urgent: false });
    expect(bannerFor(redStudent, game('red', 'guess'))).toEqual({ line: 'yourGuess', group: null, urgent: true });
  });

  test('tells either of them what the other group is doing in its turn', () => {
    for (const seat of [redPi, redStudent]) {
      expect(bannerFor(seat, game('blue', 'clue'))).toEqual({ line: 'otherClue', group: null, urgent: false });
      expect(bannerFor(seat, game('blue', 'guess'))).toEqual({ line: 'otherGuess', group: null, urgent: false });
    }
  });

  test('tells a spectator who is doing what', () => {
    expect(bannerFor(SPECTATOR, game('blue', 'clue'))).toEqual({ line: 'watchClue', group: 'blue', urgent: false });
    expect(bannerFor(SPECTATOR, game('red', 'guess'))).toEqual({ line: 'watchGuess', group: 'red', urgent: false });
  });

  test('says the same to everyone after the game', () => {
    for (const seat of [redPi, redStudent, SPECTATOR]) {
      expect(bannerFor(seat, game('red', 'guess', true))).toEqual({ line: 'over', group: null, urgent: false });
      expect(bannerFor(seat, game('red', 'over'))).toEqual({ line: 'over', group: null, urgent: false });
    }
  });

  test('ends a line that waits for someone in an ellipsis, a move in an exclamation mark, and the rest in a full stop', () => {
    const waiting: BannerLine[] = [
      'studentsGuessing',
      'piThinking',
      'otherClue',
      'otherGuess',
      'watchClue',
      'watchGuess',
      'agentThinking',
    ];
    const moves: BannerLine[] = ['yourClue', 'yourGuess'];
    const rest: BannerLine[] = ['over', 'paused'];
    const lines = (text: Locale) => text.banner.lines;
    for (const line of waiting) {
      expect(lines(en)[line]).toMatch(/[^\u2026]\u2026$/);
      expect(lines(zh)[line]).toMatch(/[^\u2026]\u2026\u2026$/);
    }
    for (const line of moves) {
      expect(lines(en)[line]).toMatch(/!$/);
      expect(lines(zh)[line]).toMatch(/\uff01$/);
    }
    for (const line of rest) {
      expect(lines(en)[line]).toMatch(/\.$/);
      expect(lines(zh)[line]).toMatch(/\u3002$/);
    }
    expect([...waiting, ...moves, ...rest].sort()).toEqual(Object.keys(lines(en)).sort());
  });

  test('tells everyone that an AI is thinking while it makes the move', () => {
    for (const seat of [redPi, redStudent, SPECTATOR]) {
      expect(bannerFor(seat, game('red', 'clue'), 'reviewer1')).toEqual({
        line: 'agentThinking',
        group: null,
        urgent: false,
      });
      expect(bannerFor(seat, game('red', 'over'), 'reviewer1')).toMatchObject({ line: 'over' });
    }
  });

  test('says who the viewer is, in front of their seat, without a colon', () => {
    expect(en.banner.seat).toMatch(/^You are /);
    expect(en.banner.spectator).toMatch(/^You are /);
    // "你是 ", with a space and no colon after it; a spectator is told "你在旁听".
    expect(zh.banner.seat).toMatch(/^\u4f60\u662f /);
    expect(zh.banner.spectator).toBe('\u4f60\u5728\u65c1\u542c');
    for (const line of [en.banner.seat, en.banner.spectator, zh.banner.seat, zh.banner.spectator]) {
      expect(line).not.toMatch(/[:\uff1a]/);
    }
  });
});

describe('the AI that makes the move', () => {
  const player = (id: string, more: Partial<PlayerView> = {}): PlayerView => ({ id, name: id, online: true, ...more });
  const ai = (id: string) => player(id, { agent: 'reviewer1' });
  const seats: Record<string, Seat> = {
    pi: redPi,
    s1: redStudent,
    s2: redStudent,
    blue: { team: 'blue', role: 'captain' },
  };

  test("is the group's PI in its clue phase, an AI player or one that an AI plays for", () => {
    expect(agentMoving(game('red', 'clue'), seats, [ai('pi'), player('s1')])).toBe('reviewer1');
    expect(agentMoving(game('red', 'clue'), seats, [player('pi', { takenOver: true })])).toBe('reviewer1');
    expect(agentMoving(game('red', 'clue'), seats, [player('pi'), ai('s1')])).toBeNull();
    // The other group's turn, a paused game and one that is over have none.
    expect(agentMoving(game('blue', 'clue'), seats, [ai('pi'), player('blue')])).toBeNull();
    expect(agentMoving({ ...game('red', 'clue'), paused: true }, seats, [ai('pi')])).toBeNull();
    expect(agentMoving(game('red', 'clue', true), seats, [ai('pi')])).toBeNull();
  });

  test('is every student of the group in its guess phase, or none while a person guesses', () => {
    const offline = player('s2', { online: false, takenOver: true });
    expect(agentMoving(game('red', 'guess'), seats, [player('pi'), ai('s1'), offline])).toBe('reviewer1');
    expect(agentMoving(game('red', 'guess'), seats, [player('pi'), offline])).toBe('reviewer1');
    expect(agentMoving(game('red', 'guess'), seats, [player('pi'), ai('s1'), player('s2')])).toBeNull();
    expect(agentMoving(game('red', 'guess'), seats, [ai('pi')])).toBeNull();
  });
});

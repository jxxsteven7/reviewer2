import type { ClueRecord } from '@reviewer2/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { clearMemory, readStored, writeStored } from '../../core/storage';
import { emptyDraft, isEmptyDraft, readDraft, writeDraft } from './draft';

const KEY = 'r2.clueDraft';
// Red's clue of the first turn, and blue's of the second: the history while red prepares a clue
// for the third.
const clue = (turn: number, team: 'red' | 'blue', word: string | null): ClueRecord => ({
  turn,
  team,
  at: 0,
  word,
  count: word === null ? null : 1,
  guesses: [],
});
const HISTORY = [clue(1, 'red', 'Theory'), clue(2, 'blue', 'Method')];
const read = (gameId: string, history = HISTORY) => readDraft(gameId, 'red', history);

describe('the clue draft', () => {
  afterEach(() => {
    clearMemory();
    vi.unstubAllGlobals();
  });

  test('keeps the draft of one game, and drops one of another game', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(read('g1')).toEqual(emptyDraft());
    writeDraft('g1', { word: 'Science', count: null, targets: [3, 0] }, 2);
    expect(read('g1')).toEqual({ word: 'Science', count: null, targets: [3, 0] });
    expect(JSON.parse(readStored(KEY) ?? '')).toEqual({
      game: 'g1',
      since: 2,
      word: 'Science',
      count: null,
      targets: [3, 0],
    });
    // The next game finds nothing, and the old draft is gone for good.
    expect(read('g2')).toEqual(emptyDraft());
    expect(readStored(KEY)).toBeNull();
    expect(read('g1')).toEqual(emptyDraft());
  });

  test('drops a draft whose clue went since, and keeps one that waited through a turn that ran out', () => {
    vi.stubGlobal('localStorage', undefined);
    const draft = { word: 'Science', count: null, targets: [3, 0] };
    writeDraft('g1', draft, 2);
    // The history grew by the other group's clue alone, or by a turn of red's that ran out.
    expect(read('g1', [...HISTORY, clue(3, 'blue', 'Trend')])).toEqual(draft);
    expect(read('g1', [...HISTORY, clue(3, 'red', null), clue(4, 'blue', 'Trend')])).toEqual(draft);
    // Red's clue went, and the page was reloaded before the snapshot with it came: the draft is
    // the clue given, and goes.
    expect(read('g1', [...HISTORY, clue(3, 'red', 'Science'), clue(4, 'blue', 'Trend')])).toEqual(emptyDraft());
    expect(readStored(KEY)).toBeNull();
    // Only a clue given since the draft was last changed counts: red's first clue is the draft
    // if the draft is older than it, and not if the draft came after.
    writeDraft('g1', draft, 0);
    expect(read('g1')).toEqual(emptyDraft());
    writeDraft('g1', draft, 1);
    expect(read('g1')).toEqual(draft);
  });

  test('removes the entry once nothing is left in the draft', () => {
    vi.stubGlobal('localStorage', undefined);
    writeDraft('g1', { word: '', count: 4, targets: [] }, 2);
    expect(read('g1')).toEqual({ word: '', count: 4, targets: [] });
    writeDraft('g1', emptyDraft(), 2);
    expect(readStored(KEY)).toBeNull();
    expect(isEmptyDraft(emptyDraft())).toBe(true);
    expect(isEmptyDraft({ word: '', count: null, targets: [2] })).toBe(false);
  });

  test('takes a stored value it does not understand as no draft', () => {
    vi.stubGlobal('localStorage', undefined);
    const stored = (value: unknown) => writeStored(KEY, typeof value === 'string' ? value : JSON.stringify(value));
    stored('Science');
    expect(read('g1')).toEqual(emptyDraft());
    stored({ game: 'g1', since: 2, word: 1, count: null, targets: [] });
    expect(read('g1')).toEqual(emptyDraft());
    stored({ game: 'g1', since: 2, word: 'Science', count: 'all', targets: [] });
    expect(read('g1')).toEqual(emptyDraft());
    stored({ game: 'g1', since: 2, word: 'Science', count: null, targets: ['3'] });
    expect(read('g1')).toEqual(emptyDraft());
    stored({ game: 'g1', since: 2, word: 'Science', count: null, targets: [1.5] });
    expect(read('g1')).toEqual(emptyDraft());
    // A draft from before the entry said when it was changed is no draft either.
    stored({ game: 'g1', word: 'Science', count: null, targets: [3] });
    expect(read('g1')).toEqual(emptyDraft());
    stored({ game: 'g1', since: -1, word: 'Science', count: null, targets: [3] });
    expect(read('g1')).toEqual(emptyDraft());
    // No limit is a number too, and a card marked twice counts once.
    stored({ game: 'g1', since: 2, word: 'Science', count: 'unlimited', targets: [3, 0, 3] });
    expect(read('g1')).toEqual({ word: 'Science', count: 'unlimited', targets: [3, 0] });
  });
});

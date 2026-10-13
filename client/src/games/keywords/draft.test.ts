import { afterEach, describe, expect, test, vi } from 'vitest';
import { clearMemory, readStored, writeStored } from '../../core/storage';
import { emptyDraft, isEmptyDraft, readDraft, writeDraft } from './draft';

const KEY = 'r2.clueDraft';

describe('the clue draft', () => {
  afterEach(() => {
    clearMemory();
    vi.unstubAllGlobals();
  });

  test('keeps the draft of one game, and drops one of another game', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readDraft('g1')).toEqual(emptyDraft());
    writeDraft('g1', { word: 'Science', count: null, targets: [3, 0] });
    expect(readDraft('g1')).toEqual({ word: 'Science', count: null, targets: [3, 0] });
    expect(JSON.parse(readStored(KEY) ?? '')).toEqual({ game: 'g1', word: 'Science', count: null, targets: [3, 0] });
    // The next game finds nothing, and the old draft is gone for good.
    expect(readDraft('g2')).toEqual(emptyDraft());
    expect(readStored(KEY)).toBeNull();
    expect(readDraft('g1')).toEqual(emptyDraft());
  });

  test('removes the entry once nothing is left in the draft', () => {
    vi.stubGlobal('localStorage', undefined);
    writeDraft('g1', { word: '', count: 4, targets: [] });
    expect(readDraft('g1')).toEqual({ word: '', count: 4, targets: [] });
    writeDraft('g1', emptyDraft());
    expect(readStored(KEY)).toBeNull();
    expect(isEmptyDraft(emptyDraft())).toBe(true);
    expect(isEmptyDraft({ word: '', count: null, targets: [2] })).toBe(false);
  });

  test('takes a stored value it does not understand as no draft', () => {
    vi.stubGlobal('localStorage', undefined);
    const stored = (value: unknown) => writeStored(KEY, typeof value === 'string' ? value : JSON.stringify(value));
    stored('Science');
    expect(readDraft('g1')).toEqual(emptyDraft());
    stored({ game: 'g1', word: 1, count: null, targets: [] });
    expect(readDraft('g1')).toEqual(emptyDraft());
    stored({ game: 'g1', word: 'Science', count: 'all', targets: [] });
    expect(readDraft('g1')).toEqual(emptyDraft());
    stored({ game: 'g1', word: 'Science', count: null, targets: ['3'] });
    expect(readDraft('g1')).toEqual(emptyDraft());
    stored({ game: 'g1', word: 'Science', count: null, targets: [1.5] });
    expect(readDraft('g1')).toEqual(emptyDraft());
    // No limit is a number too, and a card marked twice counts once.
    stored({ game: 'g1', word: 'Science', count: 'unlimited', targets: [3, 0, 3] });
    expect(readDraft('g1')).toEqual({ word: 'Science', count: 'unlimited', targets: [3, 0] });
  });
});

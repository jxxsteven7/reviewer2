import { describe, expect, test } from 'vitest';
import { checkClue, normalizeClue } from './clue';

// The fixtures that stand for Chinese words are written as \u escapes, because everything in
// the repository is in English (docs/rules/language.md).
const ATTENTION = '\u6ce8\u610f\u529b'; // "attention"
const NOTICE = '\u6ce8\u610f'; // the first two characters of ATTENTION
const FORCE = '\u529b'; // its last character
const REVIEWER = '\u5ba1\u7a3f\u4eba'; // "reviewer"
const MANUSCRIPT = '\u7a3f\u4ef6'; // "manuscript": shares a character with REVIEWER, but neither contains the other
const SPEED_UP = '\u52a0\u901f'; // "speed up"

const board = (...words: string[]) => words.map((word) => ({ word, revealed: false }));
const problemOf = (clue: string, words: string[]) => checkClue(clue, board(...words)).problem;

describe('normalizeClue', () => {
  test('folds width and case and trims', () => {
    expect(normalizeClue('  \uff2d\uff4f\uff44\uff45\uff4c ')).toBe('model');
    expect(normalizeClue('Self-Attention')).toBe('self-attention');
  });
});

describe('a clue must be one word', () => {
  test('refuses empty clues', () => {
    expect(problemOf('', [])).toBe('clue_empty');
    expect(problemOf('   ', [])).toBe('clue_empty');
  });

  test('refuses spaces and punctuation, but allows hyphens, apostrophes and digits', () => {
    expect(problemOf('peer review', [])).toBe('clue_not_one_word');
    expect(problemOf('review!', [])).toBe('clue_not_one_word');
    expect(problemOf('a,b', [])).toBe('clue_not_one_word');
    expect(problemOf('self-attention', [])).toBeNull();
    expect(problemOf("Bayes'", [])).toBeNull();
    expect(problemOf('covid19', [])).toBeNull();
    expect(problemOf(SPEED_UP, [])).toBeNull();
    expect(problemOf(`GPU${SPEED_UP}`, [])).toBeNull();
  });

  test('refuses long clues: 24 characters, or 10 when the clue has Chinese characters', () => {
    expect(problemOf('a'.repeat(24), [])).toBeNull();
    expect(problemOf('a'.repeat(25), [])).toBe('clue_too_long');
    expect(problemOf(SPEED_UP.repeat(5), [])).toBeNull();
    expect(problemOf(`${SPEED_UP.repeat(5)}x`, [])).toBe('clue_too_long');
  });
});

describe('a clue must not repeat a word on the board', () => {
  test('refuses the same word in any case or width', () => {
    expect(checkClue('Model', board('Baseline', 'MODEL'))).toEqual({
      problem: 'clue_on_board',
      conflict: 1,
      similar: [],
    });
    expect(problemOf('\uff4d\uff4f\uff44\uff45\uff4c', ['Model'])).toBe('clue_on_board');
  });

  test('refuses a part of the word, split at spaces, hyphens and apostrophes', () => {
    expect(problemOf('review', ['Peer review'])).toBe('clue_on_board');
    expect(problemOf('self-attention', ['Attention'])).toBe('clue_on_board');
    expect(problemOf('attention', ['Self-attention'])).toBe('clue_on_board');
    expect(problemOf('GPU' + SPEED_UP, ['GPU'])).toBe('clue_on_board');
  });

  test('refuses plain plurals both ways', () => {
    expect(problemOf('models', ['Model'])).toBe('clue_on_board');
    expect(problemOf('model', ['Models'])).toBe('clue_on_board');
    expect(problemOf('biases', ['Bias'])).toBe('clue_on_board');
    expect(problemOf('classes', ['Class'])).toBe('clue_on_board');
  });

  test('refuses Chinese words that contain each other', () => {
    expect(problemOf(NOTICE, [ATTENTION])).toBe('clue_on_board');
    expect(problemOf(FORCE, [ATTENTION])).toBe('clue_on_board');
    expect(problemOf(ATTENTION, [NOTICE])).toBe('clue_on_board');
    expect(problemOf(MANUSCRIPT, [REVIEWER])).toBeNull();
  });

  test('does not look for Latin words inside other words', () => {
    expect(problemOf('email', ['AI'])).toBeNull();
    expect(problemOf('ai', ['Email'])).toBeNull();
    expect(problemOf('mode', ['Model'])).toBeNull();
  });

  test('ignores revealed cards', () => {
    expect(checkClue('model', [{ word: 'Model', revealed: true }]).problem).toBeNull();
  });
});

describe('a clue that may be a form of a word on the board', () => {
  test('is allowed with a warning that names the card', () => {
    expect(checkClue('modeling', board('Baseline', 'Model'))).toEqual({ problem: null, conflict: null, similar: [1] });
    expect(checkClue('modelling', board('Model')).similar).toEqual([0]);
    expect(checkClue('biased', board('Bias')).similar).toEqual([0]);
    expect(checkClue('studies', board('Study')).similar).toEqual([0]);
    expect(checkClue('making', board('Make')).similar).toEqual([0]);
    expect(checkClue('reviewers', board('Peer review')).similar).toEqual([0]);
  });

  test('brings no warning for unrelated words', () => {
    expect(checkClue('gradient', board('Grant', 'Graduate', 'Model')).similar).toEqual([]);
    expect(checkClue('ai', board('Aim')).similar).toEqual([]);
  });
});

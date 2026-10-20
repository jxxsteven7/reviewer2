// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import { chapterById, chapters } from './chapters';

type ChapterText = { title: string; about: string; steps: Record<string, { title: string; body: string }> };

describe('the chapters of the tutorial', () => {
  test("come in their order, the game's first and then the site's, each once", () => {
    expect(chapters.map(({ id }) => id)).toEqual([
      'rules',
      'student',
      'pi',
      'extras',
      'settings',
      'account',
      'rooms',
      'lobby',
      'more',
      'feedback',
    ]);
    expect(chapters.map(({ game }) => game)).toEqual([
      ...Array<string>(5).fill('keywords'),
      ...Array<null>(5).fill(null),
    ]);
    expect(chapterById('pi')?.steps).toBe(8);
    expect(chapterById('nothing')).toBeNull();
  });

  test('have a title, a line and every step in both languages, and no step more', () => {
    for (const locale of [en, zh]) {
      const texts = locale.guide.chapters as Record<string, ChapterText>;
      expect(Object.keys(texts).sort()).toEqual(chapters.map(({ id }) => id).sort());
      for (const chapter of chapters) {
        const text = texts[chapter.id];
        expect(text?.title, chapter.id).toBeTruthy();
        expect(text?.about, chapter.id).toBeTruthy();
        expect(Object.keys(text?.steps ?? {})).toEqual(
          Array.from({ length: chapter.steps }, (_, at) => String(at + 1)),
        );
        for (const step of Object.values(text?.steps ?? {})) {
          expect(step.title, chapter.id).toBeTruthy();
          expect(step.body, chapter.id).toBeTruthy();
        }
      }
    }
  });

  test('end in a real game in the role that a chapter taught, or lead on', () => {
    expect(chapterById('student')?.end).toEqual({ play: 'guesser' });
    expect(chapterById('pi')?.end).toEqual({ play: 'captain' });
    expect(chapterById('rules')?.end).toEqual({ next: true });
    expect(chapterById('feedback')?.end).toEqual({ try: 'feedback' });
  });
});

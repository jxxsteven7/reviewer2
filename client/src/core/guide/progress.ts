import { readStored, writeStored } from '../storage';

// Where the tutorial is (docs/architecture.md#the-tutorial), and how far this browser has read it:
// the step it was at in each chapter, or that it read the chapter to its last step, and the chapter
// it read last, which the contents offer to go on with. Nothing of it goes to the server.

export const GUIDE_PATH = '/guide';

export const guidePath = (chapter: string, step = 1): string => `${GUIDE_PATH}/${chapter}/${step}`;

export type ChapterProgress = number | 'done';

export interface GuideProgress {
  chapters: Record<string, ChapterProgress>;
  last: string | null;
}

const KEY = 'r2.guide';

// What this browser has kept, or nothing read, of what can't be read.
export function readProgress(): GuideProgress {
  const text = readStored(KEY);
  const none: GuideProgress = { chapters: {}, last: null };
  if (text === null) return none;
  try {
    const kept: unknown = JSON.parse(text);
    if (kept === null || typeof kept !== 'object') return none;
    const { chapters, last } = kept as Partial<Record<keyof GuideProgress, unknown>>;
    const read: Record<string, ChapterProgress> = {};
    if (chapters !== null && typeof chapters === 'object' && !Array.isArray(chapters)) {
      for (const [id, at] of Object.entries(chapters)) {
        if (at === 'done' || (Number.isInteger(at) && (at as number) >= 1)) read[id] = at as ChapterProgress;
      }
    }
    return { chapters: read, last: typeof last === 'string' ? last : null };
  } catch {
    return none;
  }
}

// Keeps that the reader is at step `step` of the `steps` of a chapter. The last step reads the
// chapter to its end, which stays so when the reader goes back to an earlier step later.
export function keepProgress(chapter: string, step: number, steps: number): void {
  const progress = readProgress();
  const at = progress.chapters[chapter];
  progress.chapters[chapter] = at === 'done' || step >= steps ? 'done' : step;
  progress.last = chapter;
  writeStored(KEY, JSON.stringify(progress));
}

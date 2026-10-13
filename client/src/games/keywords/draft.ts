import type { ClueCount } from '@reviewer2/shared';
import { readStored, removeStored, writeStored } from '../../core/storage';

// The clue that a PI prepares ahead of their turn (docs/games/keywords.md#the-clue): the word,
// the number if they picked one, and the cards they marked, in the order marked. It lives in the
// PI's browser alone, under one key together with the ID of the game it belongs to, so that it
// comes back after a reload and never into another game. Nothing of it reaches the server until
// the clue is given. Storage that fails leaves the draft in memory for the page's life
// (core/storage.ts), and the game goes on either way.

const DRAFT = 'r2.clueDraft';

export interface ClueDraft {
  word: string;
  // The number the PI picked, or null while it follows the marked cards.
  count: ClueCount | null;
  targets: number[];
}

export const emptyDraft = (): ClueDraft => ({ word: '', count: null, targets: [] });

export const isEmptyDraft = (draft: ClueDraft): boolean =>
  draft.word === '' && draft.count === null && draft.targets.length === 0;

type Stored = ClueDraft & { game: string };

const isCount = (value: unknown): value is ClueCount | null =>
  value === null || value === 'unlimited' || (typeof value === 'number' && Number.isInteger(value) && value >= 0);

// Whether a stored value is a draft. Anything else, such as a value from an older build, counts
// as no draft.
function isStored(value: unknown): value is Stored {
  if (typeof value !== 'object' || value === null) return false;
  const { game, word, count, targets } = value as Record<string, unknown>;
  return (
    typeof game === 'string' &&
    typeof word === 'string' &&
    isCount(count) &&
    Array.isArray(targets) &&
    targets.every((card) => typeof card === 'number' && Number.isInteger(card) && card >= 0)
  );
}

// The draft stored for this game, or an empty one. A draft of another game is dropped.
export function readDraft(gameId: string): ClueDraft {
  let stored: unknown = null;
  try {
    stored = JSON.parse(readStored(DRAFT) ?? 'null');
  } catch {
    // not a draft
  }
  if (!isStored(stored)) return emptyDraft();
  if (stored.game !== gameId) {
    removeStored(DRAFT);
    return emptyDraft();
  }
  return { word: stored.word, count: stored.count, targets: [...new Set(stored.targets)] };
}

// Stores the draft for this game, or removes the entry when there is nothing left to store.
export function writeDraft(gameId: string, draft: ClueDraft): void {
  if (isEmptyDraft(draft)) removeStored(DRAFT);
  else writeStored(DRAFT, JSON.stringify({ game: gameId, ...draft }));
}

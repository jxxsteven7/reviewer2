import type { ClueCount, ClueRecord, Team } from '@reviewer2/shared/keywords';
import { readStored, removeStored, writeStored } from '../../core/storage';

// The clue that a PI prepares ahead of their turn (docs/games/keywords.md#the-clue): the word,
// the number if they picked one, and the cards they marked, in the order marked. It lives in the
// PI's browser alone, under one key together with the ID of the game it belongs to, so that it
// comes back after a reload and never into another game. Nothing of it reaches the server until
// the clue is given. Storage that fails leaves the draft in memory for the page's life
// (core/storage.ts), and the game goes on either way.
//
// The entry also notes how long the game's history was when the draft was last changed, so that
// a draft whose clue went meanwhile, when the page was reloaded before the server's snapshot
// with the clue came, is seen for what it is and dropped rather than offered again.

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

type Stored = ClueDraft & { game: string; since: number };

const isCount = (value: unknown): value is ClueCount | null =>
  value === null || value === 'unlimited' || (typeof value === 'number' && Number.isInteger(value) && value >= 0);

// Whether a stored value is a draft. Anything else, such as a value from an older build, counts
// as no draft.
function isStored(value: unknown): value is Stored {
  if (typeof value !== 'object' || value === null) return false;
  const { game, since, word, count, targets } = value as Record<string, unknown>;
  return (
    typeof game === 'string' &&
    typeof since === 'number' &&
    Number.isInteger(since) &&
    since >= 0 &&
    typeof word === 'string' &&
    isCount(count) &&
    Array.isArray(targets) &&
    targets.every((card) => typeof card === 'number' && Number.isInteger(card) && card >= 0)
  );
}

// The draft stored for this game, or an empty one. A draft of another game is dropped, and so is
// one whose group gave a clue since it was last changed, which is the draft itself, given.
export function readDraft(gameId: string, team: Team, history: readonly ClueRecord[]): ClueDraft {
  let stored: unknown = null;
  try {
    stored = JSON.parse(readStored(DRAFT) ?? 'null');
  } catch {
    // not a draft
  }
  if (!isStored(stored)) return emptyDraft();
  const given = history.slice(stored.since).some((record) => record.team === team && record.word !== null);
  if (stored.game !== gameId || given) {
    removeStored(DRAFT);
    return emptyDraft();
  }
  return { word: stored.word, count: stored.count, targets: [...new Set(stored.targets)] };
}

// Stores the draft for this game, with how long the game's history is now, or removes the entry
// when there is nothing left to store.
export function writeDraft(gameId: string, draft: ClueDraft, since: number): void {
  if (isEmptyDraft(draft)) removeStored(DRAFT);
  else writeStored(DRAFT, JSON.stringify({ game: gameId, since, ...draft }));
}

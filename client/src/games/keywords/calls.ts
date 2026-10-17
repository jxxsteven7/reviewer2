import { firstTurnReject, heavenlyHand, instantReject, openingRecord, type Played, type Team } from '@reviewer2/shared';
import { fnv1a } from '../../core/hash';
import type { Sound } from '../../core/sound';

// The titles that a group earns together, which the room calls out as the card that brings them
// comes (useGroupCalls.ts, docs/games/keywords.md#titles): the heavenly hand and the opening record,
// to the sound of an acceptance, and the instant desk reject and the fall at the first hurdle, to
// the sound of Reviewer 2 on the way. Each has a few lines under game.calls.<call> in the locale
// files, numbered from 1, which name the group and nobody in it.
export const GROUP_CALLS = ['heavenly_hand', 'opening_record', 'instant_reject', 'first_turn_reject'] as const;
export type GroupCall = (typeof GROUP_CALLS)[number];
export const CALL_LINES = 4;

export const JUDGES: Record<GroupCall, (game: Played, team: Team) => boolean> = {
  heavenly_hand: heavenlyHand,
  opening_record: openingRecord,
  instant_reject: instantReject,
  first_turn_reject: firstTurnReject,
};

export const CALL_SOUNDS: Record<GroupCall, Sound> = {
  heavenly_hand: 'accept',
  opening_record: 'accept',
  instant_reject: 'reviewer2',
  first_turn_reject: 'reviewer2',
};

// Which line the room reads, the same for everyone: it comes from the game, the turn and the call.
export const callLine = (gameId: string, turn: number, call: GroupCall): number =>
  (fnv1a(`${gameId}:${turn}:${call}`) % CALL_LINES) + 1;

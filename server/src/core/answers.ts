import type { Ack, FeedbackError, RoomError } from '@reviewer2/shared';

// The answers of the shared layer: every room method and every message handler gives `done`, an
// answer with something in it, or a refusal.
//
// Refusals are made here and nowhere else, from the room's own error codes and those of feedback.
// A code that is misspelled, or that someone forgot to add to ROOM_ERRORS or FEEDBACK_ERRORS,
// would reach the client as an error without a text; this way it doesn't compile. A game's own
// refusals have the game's own codes, and pass through as the module made them.

export type Refusal = Extract<Ack, { ok: false }>;

export const done: Ack = { ok: true };
export const fail = (error: RoomError | FeedbackError): Refusal => ({ ok: false, error });

// A game module's refusal, reduced to its error code. Whatever else a module put into it stays on
// the server: view() is the only way a game's data leaves, and an answer must be something that
// can be sent at all.
export const refusalOf = (refusal: Refusal): Refusal => ({ ok: false, error: String(refusal.error) });

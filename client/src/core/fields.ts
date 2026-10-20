import type { FieldInfo } from '@reviewer2/shared';
import { shallowRef } from 'vue';
import { unconnected } from './errors';
import { onceConnected, send } from './socket';

// The word lists on the server, with how many terms each has in each language, for setting up a
// room and for the chair's desk. They don't change while the server runs, so they are asked for
// once and kept for every page that needs them. Until the answer has come, `fields` is null.
export const fields = shallowRef<FieldInfo[] | null>(null);

// How long to wait before asking again after an answer that didn't come.
const RETRY_MS = 3000;
let asking = false;

// Asks the server for the word lists, unless they are here or on their way. An answer that
// doesn't come is asked for again: on the next connection, or after a pause.
export function loadFields(): void {
  if (fields.value || asking) return;
  asking = true;
  onceConnected(() => void ask());
}

async function ask(): Promise<void> {
  const reply = await send<{ fields: FieldInfo[] }>('meta:fields');
  if (reply.ok) {
    fields.value = reply.fields;
    asking = false;
  } else if (unconnected(reply.error)) {
    onceConnected(() => void ask());
  } else {
    setTimeout(() => void ask(), RETRY_MS);
  }
}

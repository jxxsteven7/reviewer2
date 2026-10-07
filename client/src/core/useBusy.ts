import { ref } from 'vue';

// One action at a time. `busy` is true while an action is on its way to the server, so that
// the buttons which would send another can be disabled: a second tap on "Reveal" or "Give the
// clue" would otherwise reach the server after the first has changed the game, and come back
// with an error about a move that in fact succeeded.
export function useBusy() {
  const busy = ref(false);

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (busy.value) return undefined;
    busy.value = true;
    try {
      return await action();
    } finally {
      busy.value = false;
    }
  }

  return { busy, run };
}

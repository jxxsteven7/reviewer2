import { ref } from 'vue';

// Which players' lines of titles are unfolded (TitleLine.vue), by player ID, where each line shows
// as many titles as fit and folds the rest into a "…" that unfolds them: `setOpen` is for the line
// itself, and `fold` for a tap anywhere on the player's line, but on a button, which folds the
// titles again.
export function useTitleFolds() {
  const unfolded = ref(new Set<string>());
  const setOpen = (id: string, open: boolean) => {
    const next = new Set(unfolded.value);
    if (open) next.add(id);
    else next.delete(id);
    unfolded.value = next;
  };
  const fold = (id: string | null, event: MouseEvent) => {
    if (id !== null && !(event.target as Element | null)?.closest('button')) setOpen(id, false);
  };
  return { unfolded, setOpen, fold };
}

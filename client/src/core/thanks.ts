// How many people a list of thanks names, as its card's title counts them (FoldedList.vue):
// someone listed more than once counts once, and every anonymous player, whose name is null,
// counts on their own.
export function countPeople(names: readonly (string | null)[]): number {
  return new Set(names.filter((name) => name !== null)).size + names.filter((name) => name === null).length;
}

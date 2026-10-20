// Points as the interface shows them (docs/rules/display.md#type-numbers-and-text): with a real minus sign, never a
// hyphen, and, for the points of one game, with their sign, or a dash where there are none.
export const points = (total: number): string => (total < 0 ? `\u2212${-total}` : String(total));

export function signedPoints(delta: number | null): string {
  if (delta === null) return '\u2013';
  if (delta > 0) return `+${delta}`;
  return delta < 0 ? `\u2212${-delta}` : '0';
}

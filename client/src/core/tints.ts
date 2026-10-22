// The tints that a side of a game may have, as the first game's two groups have red and blue
// (docs/rules/display.md): what a number that rises, a call about a side or a chip takes its color
// from. A game whose players play alone has none.
export const TINTS = ['red', 'blue'] as const;
export type Tint = (typeof TINTS)[number];

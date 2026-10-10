// The acknowledgments (docs/architecture.md#acknowledgments): the players whose suggestions were
// adopted, who added words or who tested, by the names they gave. The home page lists them, the
// repository's ACKNOWLEDGMENTS.md repeats them, and an account shows how often it is among them.

// What someone is thanked for: ideas and bug reports, the word lists, or playtesting.
export const ACKNOWLEDGMENT_KINDS = ['feedback', 'words', 'playtesting'] as const;
export type AcknowledgmentKind = (typeof ACKNOWLEDGMENT_KINDS)[number];

// One entry as everyone sees it: the name, what it is for and the day it was given, as
// YYYY-MM-DD. Nothing of the suggestion, the contact or the account comes with it.
export interface Acknowledgment {
  name: string;
  kind: AcknowledgmentKind;
  date: string;
}

// How often an account is thanked for each kind, on its own page.
export interface AcknowledgmentCount {
  kind: AcknowledgmentKind;
  count: number;
}

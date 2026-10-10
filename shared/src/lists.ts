import { checkCredit, checkLink, MAX_LINK_LENGTH } from './feedback';
import { MAX_NAME_LENGTH } from './protocol';

// The lists of thanks at the foot of the home page, ACKNOWLEDGMENTS.md and SPONSORS.md
// (docs/architecture.md#lists-of-thanks), are Markdown of one shape: an introduction, then
// sections, each under a heading of its own and holding entries of one line each. The server reads
// them (server/src/thanks.ts) and the home page asks it for what they list. What both lists have
// in common is here, so that one parser checks both, for the server and for the test that keeps
// the files in shape; acknowledgments.ts and sponsors.ts hold the rules of each.

// The largest list that the server reads, in bytes.
export const MAX_LIST_BYTES = 64 * 1024;

// Where the home page asks the server for each list, which it answers with { ok: true, sections }.
export const LIST_API = { acknowledgments: '/api/acknowledgments', sponsors: '/api/sponsors' } as const;
export type ListName = keyof typeof LIST_API;

// Something in a list that breaks its rules, on a line counted from 1.
export interface ListProblem {
  line: number;
  message: string;
}

export interface ListSection<Kind extends string, Entry> {
  kind: Kind;
  entries: Entry[];
}

// A list as the home page shows it, and what in it breaks the rules.
export interface ParsedList<Kind extends string, Entry> {
  sections: ListSection<Kind, Entry>[];
  problems: ListProblem[];
}

// What sets one list apart from the other: its name in the messages, the heading of each kind of
// section, what an entry looks like, for the messages, and how one is read.
export interface ListFormat<Kind extends string, Entry> {
  list: ListName;
  headings: Record<Kind, string>;
  shape: string;
  // What follows the "- " of an entry, or what is wrong with it.
  entry(text: string): Entry | string;
}

// A section as it is read: with the line of its heading and the number of entries written in it.
export type ReadSection<Kind extends string, Entry> = ListSection<Kind, Entry> & { line: number; written: number };

// A name in a list escapes every ASCII punctuation character with a backslash, so that a player's
// name shows as itself on GitHub too, and never as a link, a heading or a tag.
const PUNCTUATION = /[!-/:-@[-`{-~]/g;
export const escapeName = (name: string): string => name.replace(PUNCTUATION, '\\$&');
const unescapeName = (text: string): string => text.replace(/\\([!-/:-@[-`{-~])/g, '$1');

const HEADING = /^## (.*)$/;
// [name](link), where the name may hold escaped brackets.
export const LINKED = /^\[((?:\\.|[^\\\]])+)\]\(([^\s()]+)\)$/;
// What an introduction says while nobody is listed, which goes with the first entry.
const NO_ONE = /no one yet/i;

// A name that someone chose, perhaps with a link to a page of theirs, as a list has it: the name,
// escaped, alone or as "[<name>](https://<link>)". The name keeps to the rules of a nickname, and
// the link to those of the feedback (feedback.ts), which keeps it as the list has it, so that
// GitHub and the home page link to the same address.
export function parseName(who: string, list: ListName): { name: string; link: string | null } | string {
  const linked = LINKED.exec(who);
  if (who.startsWith('[') && !linked) {
    return 'A name with a link is "[<name>](https://<link>)", with no space, ( or ) in the link and nothing after it.';
  }
  const written = linked ? (linked[1] as string) : who;
  const name = unescapeName(written);
  if (escapeName(name) !== written) {
    return `Escape every ASCII punctuation character in a name with a backslash: ${escapeName(name)}`;
  }
  const { credit, problem } = checkCredit(name);
  if (problem !== null || credit !== name) {
    return `"${name}" can't be a name for the ${list}: it needs 1 to ${MAX_NAME_LENGTH} visible characters, as a nickname does, and mustn't be a reserved name.`;
  }
  const link = linked ? (linked[2] as string) : null;
  if (link !== null && checkLink(link, name).link !== link) {
    const printed = list === 'acknowledgments' ? ', as the commands print it' : '';
    return `"${link}" can't be a link for the ${list}: it must start with https://, hold no email address, &...; reference or \\, have at most ${MAX_LINK_LENGTH} characters, and have ( ) percent-encoded${printed}.`;
  }
  return { name, link };
}

// Lines of a list, the first of which is line `first` of the file, read in sections. Anything goes
// before the first heading, which is the introduction, except an entry, which GitHub would show
// and the home page wouldn't; with no introduction, nothing but blank lines does. A section starts
// with one of the headings, each at most once, and holds entries, each on a line of its own, and
// blank lines. An entry that breaks the rules is left out of its section, and so are the entries
// under a heading that breaks them. Also returns the lines of the introduction that say that
// nobody is listed, which finish() checks once the whole file is read.
export function readLines<Kind extends string, Entry>(
  lines: string[],
  first: number,
  format: ListFormat<Kind, Entry>,
  introduction = true,
): { sections: ReadSection<Kind, Entry>[]; problems: ListProblem[]; noOne: number[] } {
  const kinds = new Map(Object.entries<string>(format.headings).map(([kind, heading]) => [heading, kind as Kind]));
  const headings = [...kinds.keys()].map((heading) => `"## ${heading}"`).join(', ');
  const sections: ReadSection<Kind, Entry>[] = [];
  const problems: ListProblem[] = [];
  const noOne: number[] = [];
  // Whether no heading has come yet, and the section that the lines go in, if any.
  let before = true;
  let section: ReadSection<Kind, Entry> | undefined;
  lines.forEach((line, index) => {
    const problem = (message: string) => problems.push({ line: first + index, message });
    const heading = HEADING.exec(line);
    if (heading) {
      before = false;
      const kind = kinds.get(heading[1] as string);
      section = undefined;
      if (kind === undefined) problem(`A section's heading is one of ${headings}.`);
      else if (sections.some((other) => other.kind === kind)) problem(`"${line}" comes once only.`);
      else sections.push((section = { kind, entries: [], line: first + index, written: 0 }));
      return;
    }
    if (before) {
      if (NO_ONE.test(line)) noOne.push(first + index);
      if (line.startsWith('- ')) problem(`An entry goes under one of the headings, ${headings}.`);
      else if (!introduction && line !== '') problem(`Only blank lines come before the heading here, ${headings}.`);
      return;
    }
    if (line === '') return;
    if (!line.startsWith('- ')) {
      problem(`A section holds entries, "${format.shape}", and blank lines.`);
      return;
    }
    if (section) section.written += 1;
    const entry = format.entry(line.slice(2));
    if (typeof entry === 'string') problem(entry);
    else section?.entries.push(entry);
  });
  return { sections, problems, noOne };
}

// The size of a text in UTF-8, as the server finds it on disk.
function bytes(text: string): number {
  let count = 0;
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    count += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return count;
}

// The list that the sections read from `text` make, with the rules of the whole file: at most
// MAX_LIST_BYTES, every section with one entry or more, and "No one yet" only while there is no
// section. A section that has no entries that keep to the rules is left out.
export function finish<Kind extends string, Entry>(
  text: string,
  sections: ReadSection<Kind, Entry>[],
  problems: ListProblem[],
  noOne: number[],
): ParsedList<Kind, Entry> {
  if (bytes(text) > MAX_LIST_BYTES) {
    problems.push({ line: 1, message: `A list has at most ${MAX_LIST_BYTES} bytes, or the server won't read it.` });
  }
  for (const { line, written } of sections) {
    if (written === 0) problems.push({ line, message: 'A section holds one entry or more.' });
  }
  if (sections.length > 0) {
    for (const line of noOne) problems.push({ line, message: 'Take "No one yet" out once someone is listed.' });
  }
  problems.sort((a, b) => a.line - b.line);
  return {
    sections: sections.filter(({ entries }) => entries.length > 0).map(({ kind, entries }) => ({ kind, entries })),
    problems,
  };
}

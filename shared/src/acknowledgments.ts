import { checkCredit, checkLink, MAX_LINK_LENGTH } from './feedback';
import { MAX_NAME_LENGTH } from './protocol';

// The acknowledgments (docs/architecture.md#acknowledgments). The list is ACKNOWLEDGMENTS.md in
// the repository, which maintainers write by hand and the build bundles for the home page; its
// rules are here, for the page and for the test that keeps the file in shape. Apart from it, the
// server's acknowledgments table records whom the operator thanked, which an account's page
// counts and which nobody else sees.

// What someone is thanked for: ideas and bug reports, the word lists, or playtesting.
export const ACKNOWLEDGMENT_KINDS = ['feedback', 'words', 'playtesting'] as const;
export type AcknowledgmentKind = (typeof ACKNOWLEDGMENT_KINDS)[number];

// The heading of each kind's section in ACKNOWLEDGMENTS.md, as a paper's acknowledgments put it.
// The home page shows them in its own language (acknowledgments.kinds in the locale files).
export const ACKNOWLEDGMENT_HEADINGS: Record<AcknowledgmentKind, string> = {
  feedback: 'Helpful discussions',
  words: 'Data',
  playtesting: 'Pilot study',
};

// What an entry has in place of a name for a player who left none. No name can be this: it is
// longer than a nickname may be.
export const ANONYMOUS = 'An anonymous player';

// The longest description of what someone did.
export const MAX_CONTRIBUTION_LENGTH = 200;

// The repository, whose issues and pull requests an entry may name by number, as #12.
export const REPOSITORY_URL = 'https://github.com/jxxsteven7/reviewer2';

// One entry: the name, or null for an anonymous player, the link that may go with a name, and
// what they did, in English.
export interface Acknowledgment {
  name: string | null;
  link: string | null;
  contribution: string;
}

export interface AcknowledgmentSection {
  kind: AcknowledgmentKind;
  entries: Acknowledgment[];
}

// Something in ACKNOWLEDGMENTS.md that breaks the rules, on a line counted from 1.
export interface AcknowledgmentProblem {
  line: number;
  message: string;
}

// How often an account is thanked for each kind, on its own page.
export interface AcknowledgmentCount {
  kind: AcknowledgmentKind;
  count: number;
}

// A name in the file escapes every ASCII punctuation character with a backslash, so that a
// player's name shows as itself on GitHub too, and never as a link, a heading or a tag.
const PUNCTUATION = /[!-/:-@[-`{-~]/g;
export const escapeName = (name: string): string => name.replace(PUNCTUATION, '\\$&');
const unescapeName = (text: string): string => text.replace(/\\([!-/:-@[-`{-~])/g, '$1');

const SEPARATOR = ' \u{2014} ';
const HEADING = /^## (.*)$/;
// [name](link), where the name may hold escaped brackets.
const LINKED = /^\[((?:\\.|[^\\\]])+)\]\(([^\s()]+)\)$/;
// Characters that Markdown could read as markup in what someone did, which the home page shows as
// plain text.
const MARKUP = /[\\`*_[\]<>~]/;

// An entry as ACKNOWLEDGMENTS.md has it, one line.
export function acknowledgmentLine({ name, link, contribution }: Acknowledgment): string {
  const who = name === null ? ANONYMOUS : link === null ? escapeName(name) : `[${escapeName(name)}](${link})`;
  return `- ${who}${SEPARATOR}${contribution}`;
}

function checkContribution(contribution: string): string | null {
  if (!/^[ -~]+$/.test(contribution) || contribution.trim() !== contribution) {
    return 'Say what they did in English, in printable ASCII, with no spaces at the ends.';
  }
  if (MARKUP.test(contribution)) return 'Leave Markdown out of what they did: no \\ ` * _ [ ] < > ~.';
  if (contribution.length > MAX_CONTRIBUTION_LENGTH) {
    return `Say what they did in at most ${MAX_CONTRIBUTION_LENGTH} characters.`;
  }
  return null;
}

// What follows the "- " of an entry, or what is wrong with it. The contribution can't hold the
// separator, so the last one ends the name, whatever the name is made of.
function parseEntry(text: string): Acknowledgment | string {
  const at = text.lastIndexOf(SEPARATOR);
  if (at < 0) return `An entry is "- <name>${SEPARATOR}<what they did>".`;
  const who = text.slice(0, at);
  const contribution = text.slice(at + SEPARATOR.length);
  const wrong = checkContribution(contribution);
  if (wrong) return wrong;
  if (who === ANONYMOUS) return { name: null, link: null, contribution };
  const linked = LINKED.exec(who);
  const written = linked ? (linked[1] as string) : who;
  const name = unescapeName(written);
  if (escapeName(name) !== written) {
    return `Escape every ASCII punctuation character in a name with a backslash: ${escapeName(name)}`;
  }
  const { credit, problem } = checkCredit(name);
  if (problem !== null || credit !== name) {
    return `"${name}" can't be a name for the acknowledgments: it needs 1 to ${MAX_NAME_LENGTH} visible characters, as a nickname does, and mustn't be a reserved name.`;
  }
  const link = linked ? (linked[2] as string) : null;
  if (link !== null && checkLink(link, name).problem !== null) {
    return `"${link}" can't be a link for the acknowledgments: it must start with https://, hold no email address and have at most ${MAX_LINK_LENGTH} characters.`;
  }
  return { name, link, contribution };
}

// ACKNOWLEDGMENTS.md as the home page shows it, and what in it breaks the rules. Anything goes
// before the first section, which is the introduction. A section starts with one of the headings,
// each at most once, and holds one entry or more, each on a line of its own, and blank lines. An
// entry that breaks the rules is left out of the sections, and so is a section that has none.
export function parseAcknowledgments(text: string): {
  sections: AcknowledgmentSection[];
  problems: AcknowledgmentProblem[];
} {
  const kinds = new Map(ACKNOWLEDGMENT_KINDS.map((kind) => [ACKNOWLEDGMENT_HEADINGS[kind], kind]));
  const headings = ACKNOWLEDGMENT_KINDS.map((kind) => `"## ${ACKNOWLEDGMENT_HEADINGS[kind]}"`).join(', ');
  // Each section with the line of its heading and the number of entries written in it.
  const sections: (AcknowledgmentSection & { line: number; written: number })[] = [];
  const problems: AcknowledgmentProblem[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const problem = (message: string) => problems.push({ line: index + 1, message });
    const heading = HEADING.exec(line);
    if (heading) {
      const kind = kinds.get(heading[1] as string);
      if (kind === undefined) problem(`A section's heading is one of ${headings}.`);
      else if (sections.some((section) => section.kind === kind)) problem(`"${line}" comes once only.`);
      else sections.push({ kind, entries: [], line: index + 1, written: 0 });
      return;
    }
    const section = sections.at(-1);
    if (!section || line === '') return;
    if (!line.startsWith('- ')) {
      problem(`A section holds entries, "- <name>${SEPARATOR}<what they did>", and blank lines.`);
      return;
    }
    section.written += 1;
    const entry = parseEntry(line.slice(2));
    if (typeof entry === 'string') problem(entry);
    else section.entries.push(entry);
  });
  for (const { line, written } of sections) {
    if (written === 0) problems.push({ line, message: 'A section holds one entry or more.' });
  }
  problems.sort((a, b) => a.line - b.line);
  return {
    sections: sections.filter(({ entries }) => entries.length > 0).map(({ kind, entries }) => ({ kind, entries })),
    problems,
  };
}

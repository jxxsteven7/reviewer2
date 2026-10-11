import { escapeName, finish, type ListFormat, type ListProblem, type ListSection, parseName, readLines } from './lists';

// The acknowledgments (docs/architecture.md#acknowledgments). The list is ACKNOWLEDGMENTS.md in
// the repository, which maintainers write by hand and the home page shows as the server reads it;
// its rules are here, and those that it shares with SPONSORS.md in lists.ts. Apart from it, the
// server's acknowledgments table records whom the operator thanked, which an account's page
// counts and which nobody else sees.

// What someone is thanked for: ideas, new games and bug reports, the word lists, or playtesting.
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

export type AcknowledgmentSection = ListSection<AcknowledgmentKind, Acknowledgment>;

// How often an account is thanked for each kind, on its own page.
export interface AcknowledgmentCount {
  kind: AcknowledgmentKind;
  count: number;
}

const SEPARATOR = ' \u{2014} ';
// What GitHub would not show as it is written in what someone did, which the home page shows as
// plain text: Markdown's characters, an @mention, an HTML character reference such as &lt;, an
// emoji code such as :tada:, and a web address, which it would link.
const MARKUP = /[\\`*_[\]<>~@]|&#?\w+;|:[\w+-]+:|https?:\/\/|www\./i;
// An issue or pull request named by its number, #12, which the home page links: after a space, a
// bracket, (, or the start, so not inside a word such as C#10 or a path such as a/#12, and with no
// 0 in front.
const ISSUE = /(^|[ (])#([1-9]\d*)(?!\w)/;

// An entry as ACKNOWLEDGMENTS.md has it, one line.
export function acknowledgmentLine({ name, link, contribution }: Acknowledgment): string {
  const who = name === null ? ANONYMOUS : link === null ? escapeName(name) : `[${escapeName(name)}](${link})`;
  return `- ${who}${SEPARATOR}${contribution}`;
}

// What someone did, in pieces of text and numbers of issues, as the home page shows it. The
// pieces are what split() gives with the two groups of ISSUE: the text before, what came before
// the #, and the number.
export const contributionPieces = (contribution: string): { text: string; issue: boolean }[] =>
  contribution.split(ISSUE).map((text, index) => ({ text, issue: index % 3 === 2 }));

function checkContribution(contribution: string): string | null {
  if (!/^[ -~]+$/.test(contribution) || contribution.trim() !== contribution) {
    return 'Say what they did in English, in printable ASCII, with no spaces at the ends.';
  }
  if (MARKUP.test(contribution)) {
    return 'Leave Markdown out of what they did: no \\ ` * _ [ ] < > ~ @, &...; references, :emoji: codes or web addresses.';
  }
  if (contributionPieces(contribution).some(({ text, issue }) => !issue && text.includes('#'))) {
    return 'Name an issue or pull request as #12, after a space or a bracket.';
  }
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
  const named = parseName(who, 'acknowledgments');
  return typeof named === 'string' ? named : { ...named, contribution };
}

const FORMAT: ListFormat<AcknowledgmentKind, Acknowledgment> = {
  list: 'acknowledgments',
  headings: ACKNOWLEDGMENT_HEADINGS,
  shape: `- <name>${SEPARATOR}<what they did>`,
  entry: parseEntry,
};

// ACKNOWLEDGMENTS.md as the home page shows it, and what in it breaks the rules: an introduction,
// then the sections, in any order, by the rules of lists.ts.
export function parseAcknowledgments(text: string): { sections: AcknowledgmentSection[]; problems: ListProblem[] } {
  const { sections, problems, noOne } = readLines(text.split(/\r?\n/), 1, FORMAT);
  return finish(text, sections, problems, noOne);
}

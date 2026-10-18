import { GITHUB_LOGIN, GITHUB_URL } from './contributions';
import {
  finish,
  LINKED,
  type ListFormat,
  type ListProblem,
  type ListSection,
  parseName,
  readLines,
  SEPARATOR,
} from './lists';
import { cleanLine, MAX_MARKS, showsSomething, textLength } from './text';

// The sponsors (docs/architecture.md#sponsors): SPONSORS.md in the repository, a list by the rules
// of lists.ts. Every day, .github/workflows/sponsors.yml writes those who sponsor on GitHub
// Sponsors and made it public, by their GitHub usernames, between two lines that mark them
// (scripts/update-sponsors.mjs). Maintainers add those who sponsor in other ways, such as a WeChat
// tip, by hand, and only those who asked to be named, and may write a line of thanks to them after
// their names. No list shows an amount, a tier or whether a sponsorship is monthly, and a line of
// thanks is the maintainers' own choice, whatever someone gave.

export const SPONSOR_KINDS = ['github', 'other'] as const;
export type SponsorKind = (typeof SPONSOR_KINDS)[number];

// The heading of each section in SPONSORS.md. The home page shows them in its own language
// (sponsors.kinds in the locale files).
export const SPONSOR_HEADINGS: Record<SponsorKind, string> = {
  github: 'GitHub Sponsors',
  other: 'Other ways',
};

// The lines that the GitHub Sponsors go between, which scripts/update-sponsors.mjs has too.
export const SPONSORS_START = '<!-- start of GitHub Sponsors, which .github/workflows/sponsors.yml writes -->';
export const SPONSORS_END = '<!-- end of GitHub Sponsors -->';

// The page where people sponsor the author.
export const SPONSORS_PAGE = 'https://github.com/sponsors/jxxsteven7';

// A sponsor: the name, which is the GitHub username of a sponsor on GitHub, the link that may go
// with it, which a sponsor on GitHub always has, to their profile, and the line of thanks that the
// maintainers may write to a sponsor of another way, in any language, or null.
export interface Sponsor {
  name: string;
  link: string | null;
  thanks: string | null;
}

// The longest line of thanks, in the characters that a reader sees (text.ts).
export const MAX_THANKS_LENGTH = 40;

export type SponsorSection = ListSection<SponsorKind, Sponsor>;

function onGitHub(text: string): Sponsor | string {
  const linked = LINKED.exec(text);
  const name = linked?.[1];
  if (name === undefined || !GITHUB_LOGIN.test(name) || linked?.[2] !== `${GITHUB_URL}/${name}`) {
    return 'A sponsor on GitHub is "- [<username>](https://github.com/<username>)", as the workflow writes it.';
  }
  return { name, link: linked[2], thanks: null };
}

// What would make a line of thanks a link, on GitHub or in an app that shows it, which it never is:
// a web address, with its scheme, with www. or as a bare domain such as example.com, which an
// email address holds too, and a Markdown link. GitHub links neither @name nor #12 in a file.
const LINKS = /http|www\.|:\/\/|[a-z\d]\.[a-z]{2}|\]\(/i;
// What GitHub would show otherwise than as it is written, where the home page shows the line as
// plain text: an HTML tag, which could be a link too, an HTML character reference such as &lt;,
// and an emoji code such as :tada:. Markdown's characters, such as * and _, are let through, so
// that a line can be kept as it is written.
const MARKUP = /[<>]|&#?\w+;|:[\w+-]+:/;
// A space that isn't the ASCII one: a tab, a no-break space, or the full-width space that a Chinese
// input method writes, which cleanLine would turn into an ASCII space.
const ODD_SPACE = /[^\S ]/u;

// What is wrong with a line of thanks, if anything. It is shown as the maintainers wrote it, so it
// is refused, not cleaned, when the rules of text.ts would change it. The home page shows it as
// plain text.
function checkThanks(thanks: string): string | null {
  if (!showsSomething(thanks)) {
    return `Write the line of thanks after "${SEPARATOR}", or leave "${SEPARATOR.trimEnd()}" out.`;
  }
  if (ODD_SPACE.test(thanks)) {
    return 'Use ordinary spaces in a line of thanks: no tab, no-break space or full-width space.';
  }
  if (cleanLine(thanks) !== thanks) {
    return `A line of thanks has single spaces, none at its ends, no control or hidden characters, and at most ${MAX_MARKS} marks of a kind on a character.`;
  }
  if (LINKS.test(thanks)) {
    return 'Leave links out of a line of thanks: no http, www., domain such as example.com, email address or Markdown link.';
  }
  if (MARKUP.test(thanks)) {
    return 'Leave HTML out of a line of thanks: no < or >, &...; reference or :emoji: code.';
  }
  const length = textLength(thanks);
  if (length > MAX_THANKS_LENGTH) {
    return `A line of thanks has at most ${MAX_THANKS_LENGTH} visible characters, and this one has ${length}.`;
  }
  return null;
}

// What is nearly the separator, in an entry that has none: an em dash with a space on one side
// only, or doubled, as a Chinese input method writes it, or a hyphen between spaces, which a name
// would escape. The message then points at the separator, not at the name's length.
const NEARLY_SEPARATOR = / \u{2014}|\u{2014} |\u{2014}\u{2014}| - /u;

// What follows the "- " of an entry of another way, or what is wrong with it: a name, alone or with
// a line of thanks after the separator, which comes once at most, so that neither the name nor the
// thanks is cut in the wrong place. A separator at the end of the line, with its last space
// trimmed, as an editor may do, still counts as one.
function byHand(text: string): Sponsor | string {
  const padded = `${text} `;
  const at = padded.indexOf(SEPARATOR);
  if (at >= 0 && padded.lastIndexOf(SEPARATOR) !== at) {
    return `An entry has "${SEPARATOR}" once at most, between the name and the line of thanks.`;
  }
  if (at < 0 && NEARLY_SEPARATOR.test(text)) {
    return `Write the line of thanks after "${SEPARATOR}", an em dash with one space on each side.`;
  }
  const thanks = at < 0 ? null : text.slice(at + SEPARATOR.length);
  const wrong = thanks === null ? null : checkThanks(thanks);
  if (wrong) return wrong;
  const named = parseName(at < 0 ? text : text.slice(0, at), 'sponsors');
  return typeof named === 'string' ? named : { ...named, thanks };
}

// What the workflow writes, and the rest of the file.
const GITHUB: ListFormat<'github', Sponsor> = {
  list: 'sponsors',
  headings: { github: SPONSOR_HEADINGS.github },
  shape: '- [<username>](https://github.com/<username>)',
  entry: onGitHub,
};
const BY_HAND: ListFormat<SponsorKind, Sponsor> = {
  list: 'sponsors',
  headings: SPONSOR_HEADINGS,
  // Either shape, as the message quotes it.
  shape: `- <name>" or "- <name>${SEPARATOR}<thanks>`,
  entry: byHand,
};

const MARKERS = `SPONSORS.md has the line "${SPONSORS_START}" once, and the line "${SPONSORS_END}" once after it, which the workflow writes the GitHub Sponsors between.`;

// SPONSORS.md as the home page shows it, and what in it breaks the rules: the introduction, then
// the two lines that mark the GitHub Sponsors, with nothing between them but blank lines or the
// section "## GitHub Sponsors", and after them the section "## Other ways", which follows the rules
// of names in lists.ts, and those of a line of thanks here.
export function parseSponsors(text: string): { sections: SponsorSection[]; problems: ListProblem[] } {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf(SPONSORS_START);
  const end = lines.indexOf(SPONSORS_END);
  if (
    start < 0 ||
    end < start ||
    lines.lastIndexOf(SPONSORS_START) !== start ||
    lines.lastIndexOf(SPONSORS_END) !== end
  ) {
    return finish(text, [], [{ line: 1, message: MARKERS }], []);
  }
  const block = readLines(lines.slice(start + 1, end), start + 2, GITHUB, false);
  // The rest, with the lines of the block left blank, so that each keeps its number.
  const rest = readLines(
    lines.map((line, index) => (index >= start && index <= end ? '' : line)),
    1,
    BY_HAND,
  );
  const problems = [...block.problems, ...rest.problems];
  const misplaced = (line: number, message: string) => problems.push({ line, message });
  for (const { kind, line } of rest.sections) {
    if (line < start + 1) misplaced(line, `The sections come after "${SPONSORS_END}".`);
    else if (kind === 'github') misplaced(line, `"## ${SPONSOR_HEADINGS.github}" goes between the lines that mark it.`);
  }
  // Whatever followed the block would show under the GitHub Sponsors on GitHub.
  for (let index = end + 1; index < lines.length && !(lines[index] as string).startsWith('## '); index += 1) {
    const line = lines[index] as string;
    if (line !== '' && !line.startsWith('- ')) {
      misplaced(index + 1, `Only blank lines come between "${SPONSORS_END}" and the next heading.`);
    }
  }
  const sections = [...block.sections, ...rest.sections.filter(({ kind, line }) => kind !== 'github' && line > end)];
  return finish(text, sections, problems, [...block.noOne, ...rest.noOne]);
}

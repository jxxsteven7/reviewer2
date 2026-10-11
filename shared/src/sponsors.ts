import { finish, LINKED, type ListFormat, type ListProblem, type ListSection, parseName, readLines } from './lists';

// The sponsors (docs/architecture.md#sponsors): SPONSORS.md in the repository, a list by the rules
// of lists.ts. Every day, .github/workflows/sponsors.yml writes those who sponsor on GitHub
// Sponsors and made it public, by their GitHub usernames, between two lines that mark them
// (scripts/update-sponsors.mjs). Maintainers add those who sponsor in other ways, such as a WeChat
// tip, by hand, and only those who asked to be named. No list shows an amount, a tier or whether a
// sponsorship is monthly.

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

// A sponsor: the name, which is the GitHub username of a sponsor on GitHub, and the link that may
// go with it, which a sponsor on GitHub always has, to their profile.
export interface Sponsor {
  name: string;
  link: string | null;
}

export type SponsorSection = ListSection<SponsorKind, Sponsor>;

// A GitHub username: letters, digits and single hyphens between them, up to 39 characters.
const USERNAME = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

function onGitHub(text: string): Sponsor | string {
  const linked = LINKED.exec(text);
  const name = linked?.[1];
  if (name === undefined || !USERNAME.test(name) || linked?.[2] !== `https://github.com/${name}`) {
    return 'A sponsor on GitHub is "- [<username>](https://github.com/<username>)", as the workflow writes it.';
  }
  return { name, link: linked[2] };
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
  shape: '- <name>',
  entry: (text) => parseName(text, 'sponsors'),
};

const MARKERS = `SPONSORS.md has the line "${SPONSORS_START}" once, and the line "${SPONSORS_END}" once after it, which the workflow writes the GitHub Sponsors between.`;

// SPONSORS.md as the home page shows it, and what in it breaks the rules: the introduction, then
// the two lines that mark the GitHub Sponsors, with nothing between them but blank lines or the
// section "## GitHub Sponsors", and after them the section "## Other ways", which follows the rules
// of names in lists.ts.
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

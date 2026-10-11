import { describe, expect, test } from 'vitest';
import { parseAcknowledgments } from './acknowledgments';
import { MAX_LIST_BYTES } from './lists';
import { parseSponsors, SPONSOR_HEADINGS, SPONSOR_KINDS, SPONSORS_END, SPONSORS_START } from './sponsors';

// The rules of SPONSORS.md. The file itself is checked against them in server/src/thanks.test.ts,
// which also checks that the workflow writes it by them.

const INTRO = '# Sponsors\n\nWe thank the people who sponsor Reviewer 2.\n';
const NO_ONE = `${INTRO}\n_No one yet._\n`;
const HELLO = '\u4f60\u597d'; // "hello" in Chinese, as a name
const file = (...lines: string[]) => lines.join('\n');
const github = (...names: string[]) => [
  SPONSORS_START,
  '## GitHub Sponsors',
  '',
  ...names.map((name) => `- [${name}](https://github.com/${name})`),
  SPONSORS_END,
];

describe('the sponsors', () => {
  test('are those on GitHub between the lines that mark them, and those of other ways after them', () => {
    expect(
      parseSponsors(
        file(
          INTRO,
          ...github('octocat', 'Mona-Lisa-2'),
          '',
          '## Other ways',
          '',
          '- Ann',
          `- [${HELLO}](https://x.co)`,
          '',
        ),
      ),
    ).toEqual({
      sections: [
        {
          kind: 'github',
          entries: [
            { name: 'octocat', link: 'https://github.com/octocat' },
            { name: 'Mona-Lisa-2', link: 'https://github.com/Mona-Lisa-2' },
          ],
        },
        {
          kind: 'other',
          entries: [
            { name: 'Ann', link: null },
            { name: HELLO, link: 'https://x.co' },
          ],
        },
      ],
      problems: [],
    });
    expect(parseSponsors(file(NO_ONE, SPONSORS_START, SPONSORS_END, ''))).toEqual({ sections: [], problems: [] });
    expect(parseSponsors(file(INTRO, SPONSORS_START, '', SPONSORS_END, '', '## Other ways', '- Ann')).sections).toEqual(
      [{ kind: 'other', entries: [{ name: 'Ann', link: null }] }],
    );
    expect(parseSponsors(file(INTRO, ...github('octocat')).replaceAll('\n', '\r\n')).problems).toEqual([]);
  });

  test('have the two headings, one for each kind', () => {
    expect(Object.keys(SPONSOR_HEADINGS)).toEqual([...SPONSOR_KINDS]);
  });

  test('need the lines that mark the GitHub Sponsors, once each and in order', () => {
    const message = expect.stringMatching(/^SPONSORS\.md has the line/);
    for (const text of [
      INTRO,
      file(INTRO, SPONSORS_START),
      file(INTRO, SPONSORS_END, SPONSORS_START),
      file(INTRO, ...github('octocat'), SPONSORS_START, SPONSORS_END),
      file(INTRO, SPONSORS_START, ` ${SPONSORS_END}`),
    ]) {
      expect(parseSponsors(text)).toEqual({ sections: [], problems: [{ line: 1, message }] });
    }
  });

  test('on GitHub, list a username linked to its profile, as the workflow writes it', () => {
    const { sections, problems } = parseSponsors(
      file(
        INTRO,
        ...github(
          'octocat',
          'octo_cat',
          '-octocat',
          'octo--cat',
          'x'.repeat(40),
          'x'.repeat(39),
          'Ann](https://github.com/Ann',
        ),
      )
        .replace('- [octocat](https://github.com/octocat)', '- [octocat](https://github.com/octocat)\n- octocat')
        .replace('](https://github.com/octo_cat)', '](https://github.com/octocat)'),
    );
    expect(sections).toEqual([
      {
        kind: 'github',
        entries: [
          { name: 'octocat', link: 'https://github.com/octocat' },
          { name: 'x'.repeat(39), link: `https://github.com/${'x'.repeat(39)}` },
        ],
      },
    ]);
    const message =
      'A sponsor on GitHub is "- [<username>](https://github.com/<username>)", as the workflow writes it.';
    // Line 8 is octocat, as written; a name without its link, a _, hyphens at an end or side by side, 40
    // characters and a name that isn't one break the rules.
    expect(problems).toEqual([9, 10, 11, 12, 13, 15].map((line) => ({ line, message })));
  });

  test('keep the GitHub Sponsors between the lines that mark them, and the rest after them', () => {
    const problems = (...lines: string[]) =>
      parseSponsors(file(...lines)).problems.map(({ line, message }) => [line, message]);
    expect(problems(INTRO, SPONSORS_START, 'Our sponsors:', SPONSORS_END)).toEqual([
      [6, 'Only blank lines come before the heading here, "## GitHub Sponsors".'],
    ]);
    expect(problems(INTRO, SPONSORS_START, '- [octocat](https://github.com/octocat)', SPONSORS_END)).toEqual([
      [6, 'An entry goes under one of the headings, "## GitHub Sponsors".'],
    ]);
    // The entries under a heading that breaks the rules are checked all the same.
    expect(problems(INTRO, SPONSORS_START, '## Other ways', '- Ann', SPONSORS_END)).toEqual([
      [6, 'A section\'s heading is one of "## GitHub Sponsors".'],
      [7, expect.stringMatching(/^A sponsor on GitHub is/)],
    ]);
    expect(problems(INTRO, SPONSORS_START, SPONSORS_END, '## GitHub Sponsors', '- Ann')).toEqual([
      [7, '"## GitHub Sponsors" goes between the lines that mark it.'],
    ]);
    expect(problems(INTRO, '## Other ways', '- Ann', SPONSORS_START, SPONSORS_END)).toEqual([
      [5, `The sections come after "${SPONSORS_END}".`],
    ]);
    // On GitHub, what follows the block until the next heading shows under the GitHub Sponsors.
    expect(problems(INTRO, ...github('octocat'), 'Thanks!', '- Ann', '', '## Other ways', '- Bob')).toEqual([
      [10, `Only blank lines come between "${SPONSORS_END}" and the next heading.`],
      [11, 'An entry goes under one of the headings, "## GitHub Sponsors", "## Other ways".'],
    ]);
  });

  test('of other ways, take names and links by the rules of the acknowledgments', () => {
    const { sections, problems } = parseSponsors(
      file(
        INTRO,
        SPONSORS_START,
        SPONSORS_END,
        '## Other ways',
        '- Dr\\. Who',
        '- Dr. Who',
        `- ${'x'.repeat(17)}`,
        '- Reviewer 2',
        '- [Ann](http://ann.example)',
        '- [Ann](https://ann.example',
        'Ann',
      ),
    );
    expect(sections).toEqual([{ kind: 'other', entries: [{ name: 'Dr. Who', link: null }] }]);
    expect(problems.map(({ line, message }) => [line, message])).toEqual([
      [9, 'Escape every ASCII punctuation character in a name with a backslash: Dr\\. Who'],
      [10, expect.stringMatching(/^"x+" can't be a name for the sponsors: it needs 1 to 16 visible characters/)],
      [11, expect.stringMatching(/^"Reviewer 2" can't be a name for the sponsors/)],
      [
        12,
        '"http://ann.example" can\'t be a link for the sponsors: it must start with https://, hold no email address, ' +
          '&...; reference or \\, have at most 200 characters, and have ( ) percent-encoded.',
      ],
      [13, expect.stringMatching(/^A name with a link is/)],
      [14, 'A section holds entries, "- <name>", and blank lines.'],
    ]);
  });

  test('say no one yet only while nobody is listed, and hold no empty section', () => {
    expect(parseSponsors(file(NO_ONE, ...github('octocat'))).problems).toEqual([
      { line: 5, message: 'Take "No one yet" out once someone is listed.' },
    ]);
    expect(parseSponsors(file(INTRO, SPONSORS_START, '## GitHub Sponsors', SPONSORS_END)).problems).toEqual([
      { line: 6, message: 'A section holds one entry or more.' },
    ]);
  });
});

describe('a list', () => {
  test(`has at most ${MAX_LIST_BYTES} bytes, counted in UTF-8`, () => {
    const big = '\u4f60'.repeat(MAX_LIST_BYTES / 3);
    // SPONSORS.md of exactly the most bytes, and of one more, with the extra in its introduction.
    const room = MAX_LIST_BYTES - file(NO_ONE, SPONSORS_START, SPONSORS_END).length;
    const sponsors = (extra: number) => file(`${NO_ONE}${'x'.repeat(extra)}`, SPONSORS_START, SPONSORS_END);
    const message = `A list has at most ${MAX_LIST_BYTES} bytes, or the server won't read it.`;
    expect(parseSponsors(sponsors(room)).problems).toEqual([]);
    expect(parseSponsors(sponsors(room + 1)).problems).toEqual([{ line: 1, message }]);
    expect(parseAcknowledgments(`${NO_ONE}${big}`).problems).toEqual([{ line: 1, message }]);
    expect(parseAcknowledgments(`${NO_ONE}${big.slice(NO_ONE.length)}`).problems).toEqual([]);
  });
});

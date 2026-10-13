import { describe, expect, test } from 'vitest';
import { parseAcknowledgments } from './acknowledgments';
import { MAX_LIST_BYTES } from './lists';
import {
  MAX_THANKS_LENGTH,
  parseSponsors,
  SPONSOR_HEADINGS,
  SPONSOR_KINDS,
  SPONSORS_END,
  SPONSORS_START,
} from './sponsors';

// The rules of SPONSORS.md. The file itself is checked against them in server/src/thanks.test.ts,
// which also checks that the workflow writes it by them.

const INTRO = '# Sponsors\n\nWe thank the people who sponsor Reviewer 2.\n';
const NO_ONE = `${INTRO}\n_No one yet._\n`;
const HELLO = '\u4f60\u597d'; // "hello" in Chinese, as a name
const DASH = ' \u{2014} ';
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
            { name: 'octocat', link: 'https://github.com/octocat', thanks: null },
            { name: 'Mona-Lisa-2', link: 'https://github.com/Mona-Lisa-2', thanks: null },
          ],
        },
        {
          kind: 'other',
          entries: [
            { name: 'Ann', link: null, thanks: null },
            { name: HELLO, link: 'https://x.co', thanks: null },
          ],
        },
      ],
      problems: [],
    });
    expect(parseSponsors(file(NO_ONE, SPONSORS_START, SPONSORS_END, ''))).toEqual({ sections: [], problems: [] });
    expect(parseSponsors(file(INTRO, SPONSORS_START, '', SPONSORS_END, '', '## Other ways', '- Ann')).sections).toEqual(
      [{ kind: 'other', entries: [{ name: 'Ann', link: null, thanks: null }] }],
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
          { name: 'octocat', link: 'https://github.com/octocat', thanks: null },
          { name: 'x'.repeat(39), link: `https://github.com/${'x'.repeat(39)}`, thanks: null },
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
    expect(sections).toEqual([{ kind: 'other', entries: [{ name: 'Dr. Who', link: null, thanks: null }] }]);
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
      [14, `A section holds entries, "- <name>" or "- <name>${DASH}<thanks>", and blank lines.`],
    ]);
  });

  test('of other ways, may have a line of thanks from the maintainers after the name, in any language', () => {
    // "Thanks for all your support" in Chinese.
    const SUPPORT = '\u{611f}\u{8c22}\u{4e00}\u{76f4}\u{4ee5}\u{6765}\u{7684}\u{652f}\u{6301}';
    // A family of two, one emoji built from three code points, counts as one character.
    const FAMILY = '\u{1f468}\u{200d}\u{1f469}';
    const { sections, problems } = parseSponsors(
      file(
        INTRO,
        SPONSORS_START,
        SPONSORS_END,
        '## Other ways',
        `- Ann${DASH}Thanks for the late-night fixes`,
        `- ${HELLO}${DASH}${SUPPORT}`,
        '- Bob',
        `- [Cat](https://cat.example)${DASH}${'x'.repeat(MAX_THANKS_LENGTH)}`,
        `- Dan${DASH}${FAMILY.repeat(MAX_THANKS_LENGTH)}`,
        // Dots that make no domain, and # and @, which GitHub links nowhere in a file.
        `- Eve${DASH}Ph.D. thanks, e.g. 3.14 times! C# (@_@)`,
        `- Fay${DASH}Our #1 fan, @octocat and team@home`,
        // Markdown's characters, which stay as written.
        `- Gus${DASH}*you rock* \\o/ ~ _really_`,
      ),
    );
    expect(problems).toEqual([]);
    expect(sections).toEqual([
      {
        kind: 'other',
        entries: [
          { name: 'Ann', link: null, thanks: 'Thanks for the late-night fixes' },
          { name: HELLO, link: null, thanks: SUPPORT },
          { name: 'Bob', link: null, thanks: null },
          { name: 'Cat', link: 'https://cat.example', thanks: 'x'.repeat(MAX_THANKS_LENGTH) },
          { name: 'Dan', link: null, thanks: FAMILY.repeat(MAX_THANKS_LENGTH) },
          { name: 'Eve', link: null, thanks: 'Ph.D. thanks, e.g. 3.14 times! C# (@_@)' },
          { name: 'Fay', link: null, thanks: 'Our #1 fan, @octocat and team@home' },
          { name: 'Gus', link: null, thanks: '*you rock* \\o/ ~ _really_' },
        ],
      },
    ]);
  });

  test('of other ways, refuse a line of thanks that breaks its rules, and say how to mend it', () => {
    // The problems with the entries, each on the line it is written on, counted from the first.
    const problems = (...entries: string[]) => {
      const parsed = parseSponsors(
        file(INTRO, SPONSORS_START, SPONSORS_END, '## Other ways', ...entries.map((entry) => `- ${entry}`)),
      );
      expect(parsed.sections).toEqual([]);
      return parsed.problems.map(({ line, message }) => [line - 7, message]);
    };
    const thanks = (...texts: string[]) => problems(...texts.map((text) => `Ann${DASH}${text}`));
    const empty = `Write the line of thanks after "${DASH}", or leave "${DASH.trimEnd()}" out.`;
    // The separator alone, with or without its last space, which an editor may trim, or with spaces.
    expect(problems(`Ann${DASH}`, `Ann${DASH.trimEnd()}`, `Ann${DASH}   `)).toEqual([
      [1, empty],
      [2, empty],
      [3, empty],
    ]);
    expect(thanks('x'.repeat(MAX_THANKS_LENGTH + 1))).toEqual([
      [1, `A line of thanks has at most ${MAX_THANKS_LENGTH} visible characters, and this one has 41.`],
    ]);
    const unclean = expect.stringMatching(/^A line of thanks has single spaces, none at its ends, no control/);
    // A bell, a zero-width space, two spaces, and a space at the end.
    expect(thanks('hi\u{7}', 'hi\u{200b}there', 'hi  there', 'hi ')).toEqual(
      [1, 2, 3, 4].map((line) => [line, unclean]),
    );
    // A tab, a no-break space and a full-width space, which cleanLine would turn into a space, get
    // a message of their own, since the line looks right.
    const spaces = 'Use ordinary spaces in a line of thanks: no tab, no-break space or full-width space.';
    expect(thanks('hi\tthere', 'hi\u{a0}there', `${HELLO}\u{3000}${HELLO}`)).toEqual(
      [1, 2, 3].map((line) => [line, spaces]),
    );
    const links = expect.stringMatching(/^Leave links out of a line of thanks: no http, www\., domain/);
    expect(
      thanks(
        'see https://ann.example',
        'HTTP me',
        'www.ann',
        'ann.example',
        'Ann.Example',
        'mail ann@mail.example',
        'ftp://ann',
        '[hi](/issues)',
      ),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((line) => [line, links]));
    // HTML, which GitHub would render, a tag as a link too; a character reference and an emoji code,
    // which it would turn into the character.
    const html = 'Leave HTML out of a line of thanks: no < or >, &...; reference or :emoji: code.';
    expect(thanks('<a href="/issues">see</a>', 'thanks <!-- ok', '<3', '&lt;3', '&#60;3', ':tada: thanks')).toEqual(
      [1, 2, 3, 4, 5, 6].map((line) => [line, html]),
    );
    // The separator once at most, so that neither the name nor the thanks is cut in the wrong place.
    const once = `An entry has "${DASH}" once at most, between the name and the line of thanks.`;
    expect(thanks(`hi${DASH}there`, `${DASH}hi`)).toEqual([
      [1, once],
      [2, once],
    ]);
    // Nearly the separator: an em dash with a space on one side only or doubled, as a Chinese input
    // method writes it, or a hyphen between spaces. Without the hint, the whole line would be read
    // as a name, and the message would be about its length.
    const nearly = `Write the line of thanks after "${DASH}", an em dash with one space on each side.`;
    expect(
      problems(`Ann \u{2014}\u{2014} ${HELLO}`, `Ann \u{2014}${HELLO}`, `Ann\u{2014} ${HELLO}`, `Ann - ${HELLO}`),
    ).toEqual([1, 2, 3, 4].map((line) => [line, nearly]));
    // The name keeps its own rules.
    expect(problems(`${'x'.repeat(17)}${DASH}hi`, `${DASH}hi`)).toEqual([
      [1, expect.stringMatching(/^"x+" can't be a name for the sponsors/)],
      [2, expect.stringMatching(/^"" can't be a name for the sponsors/)],
    ]);
  });

  test('of other ways, take a name that ends in a hyphen, escaped as every ASCII punctuation character is', () => {
    const { sections, problems } = parseSponsors(
      file(INTRO, SPONSORS_START, SPONSORS_END, '## Other ways', `- re\\-${DASH}nb`, '- re\\-', `- re-${DASH}nb`),
    );
    // The backslash only escapes the hyphen, and is no part of the name.
    expect(sections).toEqual([
      {
        kind: 'other',
        entries: [
          { name: 're-', link: null, thanks: 'nb' },
          { name: 're-', link: null, thanks: null },
        ],
      },
    ]);
    expect(problems).toEqual([
      { line: 10, message: 'Escape every ASCII punctuation character in a name with a backslash: re\\-' },
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

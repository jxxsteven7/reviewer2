import { describe, expect, test } from 'vitest';
import {
  ACKNOWLEDGMENT_HEADINGS,
  ACKNOWLEDGMENT_KINDS,
  acknowledgmentLine,
  ANONYMOUS,
  contributionPieces,
  MAX_CONTRIBUTION_LENGTH,
  parseAcknowledgments,
} from './acknowledgments';
import { checkLink } from './feedback';
import { escapeName } from './lists';

// The rules of ACKNOWLEDGMENTS.md. The file itself is checked against them in
// server/src/thanks.test.ts, beside the code that reads it.

const DASH = '\u{2014}';
const HELLO = '\u4f60\u597d'; // "hello" in Chinese, as a name
const INTRO = '# Acknowledgments\n\nWe thank the players who helped.\n';
const NO_ONE = `${INTRO}\n_No one yet._\n`;
const parse = (...lines: string[]) => parseAcknowledgments(lines.join('\n'));

describe('the acknowledgments', () => {
  test('are in sections under the headings of their kinds, after an introduction', () => {
    expect(
      parse(
        INTRO,
        '## Pilot study',
        '',
        `- [Alice](https://alice.example) ${DASH} played the first games on her phone`,
        '',
        '## Helpful discussions',
        '',
        `- Bob ${DASH} suggested public rooms (#40)`,
        `- ${ANONYMOUS} ${DASH} reported the reconnect bug (#42, #43)`,
        `- ${HELLO} ${DASH} found a typo`,
        '',
      ),
    ).toEqual({
      sections: [
        {
          kind: 'playtesting',
          entries: [
            { name: 'Alice', link: 'https://alice.example', contribution: 'played the first games on her phone' },
          ],
        },
        {
          kind: 'feedback',
          entries: [
            { name: 'Bob', link: null, contribution: 'suggested public rooms (#40)' },
            { name: null, link: null, contribution: 'reported the reconnect bug (#42, #43)' },
            { name: HELLO, link: null, contribution: 'found a typo' },
          ],
        },
      ],
      problems: [],
    });
    expect(parseAcknowledgments(NO_ONE)).toEqual({ sections: [], problems: [] });
    expect(parseAcknowledgments(`## Data\r\n\r\n- Cy ${DASH} added words\r\n`).sections).toHaveLength(1);
  });

  test('go under a heading, and never in the introduction, which the home page leaves out', () => {
    const entry = `- [Alice](https://alice.example) ${DASH} suggested public rooms (#40)`;
    const misplaced = {
      line: 5,
      message: 'An entry goes under one of the headings, "## Helpful discussions", "## Data", "## Pilot study".',
    };
    // The first entry in place of "No one yet", without its heading, and one added after it.
    expect(parseAcknowledgments(NO_ONE.replace('_No one yet._', entry))).toEqual({
      sections: [],
      problems: [misplaced],
    });
    expect(parse(NO_ONE, entry).problems).toEqual([{ ...misplaced, line: 7 }]);
    expect(parse(INTRO, entry, '## Data', entry).problems).toEqual([misplaced]);
    expect(
      parseAcknowledgments(NO_ONE.replace('_No one yet._', `## Helpful discussions\n\n${entry}`)).problems,
    ).toEqual([]);
  });

  test('leave out what comes under a heading that breaks the rules, until the next one', () => {
    const { sections, problems } = parse(
      '## Data',
      `- Ann ${DASH} added words`,
      '## Pilot study',
      `- Bob ${DASH} tested`,
      '## Data',
      `- Cy ${DASH} added more words`,
      '## Thanks',
      `- Dan ${DASH} tested`,
      `- Dr. Eve ${DASH} tested`,
      '## Helpful discussions',
      `- Fay ${DASH} suggested a timer`,
    );
    expect(sections.map(({ kind, entries }) => [kind, entries.map(({ name }) => name)])).toEqual([
      ['words', ['Ann']],
      ['playtesting', ['Bob']],
      ['feedback', ['Fay']],
    ]);
    // The entries under it are checked all the same.
    expect(problems.map(({ line }) => line)).toEqual([5, 7, 9]);
  });

  test('say no one yet only while nobody is listed', () => {
    expect(parse(NO_ONE, '## Data', '', `- Cy ${DASH} added words`).problems).toEqual([
      { line: 5, message: 'Take "No one yet" out once someone is listed.' },
    ]);
    expect(parse(NO_ONE, '## Data').problems.map(({ line }) => line)).toEqual([5, 7]);
  });

  test('have the headings of a paper, one for each kind', () => {
    expect(Object.keys(ACKNOWLEDGMENT_HEADINGS)).toEqual([...ACKNOWLEDGMENT_KINDS]);
    expect(ACKNOWLEDGMENT_HEADINGS).toEqual({
      feedback: 'Helpful discussions',
      words: 'Data',
      playtesting: 'Pilot study',
    });
  });

  test('are written as the file has them, and read back as they were', () => {
    const entries = [
      { name: 'Ann L.', link: 'https://ann.example/', contribution: 'suggested a timer' },
      { name: '[a](http://x.co)', link: null, contribution: 'tested' },
      { name: '# Big', link: null, contribution: 'tested' },
      { name: '<b>x</b>', link: null, contribution: 'tested' },
      { name: '**Ann** _L_', link: null, contribution: 'tested' },
      { name: '- Ann \\ ]', link: 'https://x.co', contribution: 'tested' },
      { name: `A ${DASH} B`, link: null, contribution: 'tested' },
      { name: null, link: null, contribution: 'reported a bug (#7)' },
    ];
    const lines = entries.map(acknowledgmentLine);
    expect(lines.slice(0, 6)).toEqual([
      `- [Ann L\\.](https://ann.example/) ${DASH} suggested a timer`,
      `- \\[a\\]\\(http\\:\\/\\/x\\.co\\) ${DASH} tested`,
      `- \\# Big ${DASH} tested`,
      `- \\<b\\>x\\<\\/b\\> ${DASH} tested`,
      `- \\*\\*Ann\\*\\* \\_L\\_ ${DASH} tested`,
      `- [\\- Ann \\\\ \\]](https://x.co) ${DASH} tested`,
    ]);
    expect(lines.at(-1)).toBe(`- ${ANONYMOUS} ${DASH} reported a bug (#7)`);
    expect(parse('## Data', ...lines)).toEqual({ sections: [{ kind: 'words', entries }], problems: [] });
  });

  test('escape every ASCII punctuation character in a name, so that GitHub shows it as it is', () => {
    expect(escapeName('Dr. Ann-Lee (PhD)')).toBe('Dr\\. Ann\\-Lee \\(PhD\\)');
    expect(parse('## Data', `- Dr. Ann ${DASH} tested`).problems).toEqual([
      { line: 2, message: 'Escape every ASCII punctuation character in a name with a backslash: Dr\\. Ann' },
    ]);
    expect(parse('## Data', `- [Ann_L](https://x.co) ${DASH} tested`).problems).toEqual([
      { line: 2, message: 'Escape every ASCII punctuation character in a name with a backslash: Ann\\_L' },
    ]);
    expect(parse('## Data', `- Ann\\a ${DASH} tested`).problems).toHaveLength(1);
  });

  test('take names by the rules of a nickname, and links by the rules of the feedback', () => {
    const problems = parse(
      '## Data',
      `- ${'x'.repeat(17)} ${DASH} tested`,
      `- Reviewer 2 ${DASH} tested`,
      `- Ann  L ${DASH} tested`,
      `- Ann\u200bL ${DASH} tested`,
      `- [Ann](http://ann.example) ${DASH} tested`,
      `- [Ann](mailto:ann@example.com) ${DASH} tested`,
      `- [Ann](https://ann@example.com) ${DASH} tested`,
      `- [Ann](https://ann.example/${'x'.repeat(200)}) ${DASH} tested`,
      `- [Ann]() ${DASH} tested`,
    ).problems;
    expect(problems.map(({ line }) => line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(problems[0]?.message).toBe(
      `"${'x'.repeat(17)}" can't be a name for the acknowledgments: it needs 1 to 16 visible characters, as a ` +
        "nickname does, and mustn't be a reserved name.",
    );
    expect(problems[4]?.message).toBe(
      '"http://ann.example" can\'t be a link for the acknowledgments: it must start with https://, hold no email ' +
        'address, &...; reference or \\, have at most 200 characters, and have ( ) percent-encoded, as the ' +
        'commands print it.',
    );
    expect(problems[8]?.message).toBe(
      'A name with a link is "[<name>](https://<link>)", with no space, ( or ) in the link and nothing after it.',
    );
  });

  test('take every link the feedback takes, as it is kept, so that GitHub and the page link alike', () => {
    for (const typed of [
      'https://ann.example',
      'https://scholar.google.com/citations?user=AbCdEfGhIjK&hl=en',
      'https://en.wikipedia.org/wiki/Ann_(dev)',
      'https://ann.example/a)b(c',
      'HTTPS://Ann.Example:8443/a/b%20c#top',
    ]) {
      const { link } = checkLink(typed, 'Ann');
      if (link === null) throw new Error(`${typed} was refused`);
      const line = acknowledgmentLine({ name: 'Ann', link, contribution: 'tested' });
      expect(parse('## Data', line), line).toEqual({
        sections: [{ kind: 'words', entries: [{ name: 'Ann', link, contribution: 'tested' }] }],
        problems: [],
      });
    }
    // In the file, a link is as the feedback keeps it, and not as it might be typed.
    for (const link of [
      'https://a.example/x\\',
      'https://a.example/?q=a&amp;b',
      'https://a.example/(x)',
      'https://a.example/ x',
      'https://a.example/x)',
    ]) {
      const problems = parse('## Data', `- [Ann](${link}) ${DASH} tested`).problems;
      expect(problems, link).toHaveLength(1);
      expect(problems[0]?.message, link).toMatch(/can't be a link|A name with a link/);
    }
  });

  test('say what someone did in English, as plain text', () => {
    const problems = parse(
      '## Data',
      `- Ann ${DASH} `,
      `- Ann ${DASH}  added words`,
      `- Ann ${DASH} added ${HELLO}`,
      `- Ann ${DASH} added **many** words`,
      `- Ann ${DASH} added [words](https://x.co)`,
      `- Ann ${DASH} added <b>words</b>`,
      `- Ann ${DASH} fixed &lt;b&gt; tags`,
      `- Ann ${DASH} added words :tada:`,
      `- Ann ${DASH} added words, see https://x.co`,
      `- Ann ${DASH} added words, see www.x.co`,
      `- Ann ${DASH} added words with @octocat`,
      `- Ann ${DASH} ported the bot to C#10`,
      `- Ann ${DASH} reported a bug (#0)`,
      `- Ann ${DASH} fixed the docs/#12 link and "#13"`,
      `- Ann ${DASH} ${'x'.repeat(MAX_CONTRIBUTION_LENGTH + 1)}`,
      `- Ann ${DASH} ${'x'.repeat(MAX_CONTRIBUTION_LENGTH)}`,
      `- Ann ${DASH} reported a bug (#7), and #12, #13`,
    ).problems;
    const markdown =
      'Leave Markdown out of what they did: no \\ ` * _ [ ] < > ~ @, &...; references, :emoji: codes or web addresses.';
    const issue = 'Name an issue or pull request as #12, after a space or a bracket.';
    expect(problems.map(({ line, message }) => [line, message])).toEqual([
      [2, 'Say what they did in English, in printable ASCII, with no spaces at the ends.'],
      [3, 'Say what they did in English, in printable ASCII, with no spaces at the ends.'],
      [4, 'Say what they did in English, in printable ASCII, with no spaces at the ends.'],
      [5, markdown],
      [6, markdown],
      [7, markdown],
      [8, markdown],
      [9, markdown],
      [10, markdown],
      [11, markdown],
      [12, markdown],
      [13, issue],
      [14, issue],
      [15, issue],
      [16, 'Say what they did in at most 200 characters.'],
    ]);
  });

  test('come in pieces for the home page, with the numbers of issues apart', () => {
    const text = (piece: string) => ({ text: piece, issue: false });
    expect(contributionPieces('reported a bug (#7), and #12, #13')).toEqual([
      text('reported a bug '),
      text('('),
      { text: '7', issue: true },
      text('), and'),
      text(' '),
      { text: '12', issue: true },
      text(','),
      text(' '),
      { text: '13', issue: true },
      text(''),
    ]);
    expect(contributionPieces('#7 again')).toEqual([text(''), text(''), { text: '7', issue: true }, text(' again')]);
    for (const piece of ['added words', 'C#10', '#0', '#7a', 'a/#12', 'b-#13', 'c.#14', '"#15"']) {
      expect(contributionPieces(piece)).toEqual([text(piece)]);
    }
  });

  test('hold nothing but sections of entries and blank lines after the introduction', () => {
    const { sections, problems } = parse(
      NO_ONE,
      '## Thanks',
      '## Data',
      'Some prose.',
      `- Ann - added words`,
      `* Ann ${DASH} added words`,
      `- Ann ${DASH} added words`,
      '### More',
      '## Data',
      '## Pilot study',
      '',
      '## Helpful discussions',
      `- ${'x'.repeat(17)} ${DASH} tested`,
    );
    const at = NO_ONE.split('\n').length;
    expect(problems).toEqual([
      { line: 5, message: 'Take "No one yet" out once someone is listed.' },
      {
        line: at + 1,
        message: 'A section\'s heading is one of "## Helpful discussions", "## Data", "## Pilot study".',
      },
      { line: at + 3, message: `A section holds entries, "- <name> ${DASH} <what they did>", and blank lines.` },
      { line: at + 4, message: `An entry is "- <name> ${DASH} <what they did>".` },
      { line: at + 5, message: `A section holds entries, "- <name> ${DASH} <what they did>", and blank lines.` },
      { line: at + 7, message: `A section holds entries, "- <name> ${DASH} <what they did>", and blank lines.` },
      { line: at + 8, message: '"## Data" comes once only.' },
      { line: at + 9, message: 'A section holds one entry or more.' },
      { line: at + 12, message: expect.stringMatching(/can't be a name/) },
    ]);
    // What keeps to the rules is shown all the same.
    expect(sections).toEqual([{ kind: 'words', entries: [{ name: 'Ann', link: null, contribution: 'added words' }] }]);
  });
});

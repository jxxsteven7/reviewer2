import { describe, expect, test } from 'vitest';
import {
  ACKNOWLEDGMENT_HEADINGS,
  ACKNOWLEDGMENT_KINDS,
  acknowledgmentLine,
  ANONYMOUS,
  escapeName,
  MAX_CONTRIBUTION_LENGTH,
  parseAcknowledgments,
} from './acknowledgments';

// The rules of ACKNOWLEDGMENTS.md. The file itself is checked against them in
// client/src/core/acknowledgments.test.ts, beside the page that shows it.

const DASH = '\u{2014}';
const HELLO = '\u4f60\u597d'; // "hello" in Chinese, as a name
const INTRO = '# Acknowledgments\n\nWe thank the players who helped.\n\n_No one yet._\n';
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
    expect(parseAcknowledgments(INTRO)).toEqual({ sections: [], problems: [] });
    expect(parseAcknowledgments(`## Data\r\n\r\n- Cy ${DASH} added words\r\n`).sections).toHaveLength(1);
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
        'address and have at most 200 characters.',
    );
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
      `- Ann ${DASH} ${'x'.repeat(MAX_CONTRIBUTION_LENGTH + 1)}`,
      `- Ann ${DASH} ${'x'.repeat(MAX_CONTRIBUTION_LENGTH)}`,
    ).problems;
    expect(problems.map(({ line, message }) => [line, message])).toEqual([
      [2, 'Say what they did in English, in printable ASCII, with no spaces at the ends.'],
      [3, 'Say what they did in English, in printable ASCII, with no spaces at the ends.'],
      [4, 'Say what they did in English, in printable ASCII, with no spaces at the ends.'],
      [5, 'Leave Markdown out of what they did: no \\ ` * _ [ ] < > ~.'],
      [6, 'Leave Markdown out of what they did: no \\ ` * _ [ ] < > ~.'],
      [7, 'Leave Markdown out of what they did: no \\ ` * _ [ ] < > ~.'],
      [8, 'Say what they did in at most 200 characters.'],
    ]);
  });

  test('hold nothing but sections of entries and blank lines after the introduction', () => {
    const { sections, problems } = parse(
      INTRO,
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
    const at = INTRO.split('\n').length;
    expect(problems).toEqual([
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

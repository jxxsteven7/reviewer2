import { describe, expect, test } from 'vitest';
import { parseAcknowledgments } from './acknowledgments';
import { MAX_LIST_BYTES } from './lists';

// The rules of ACKNOWLEDGMENTS.md. The file itself is checked against them in
// server/src/thanks.test.ts, beside the code that reads it.

const HELLO = '\u4f60\u597d'; // "hello" in Chinese
const parse = (...lines: string[]) => parseAcknowledgments(lines.join('\n'));
const text = (value: string) => ({ kind: 'text', text: value });

describe('the acknowledgments', () => {
  test('are headings, paragraphs and lists, after a title that only GitHub shows', () => {
    expect(
      parse(
        '# Acknowledgments',
        '',
        '<!-- The home page shows this file. -->',
        '',
        'We thank the friends who',
        'played the first games.',
        '',
        '## Pilot study',
        '',
        '- Ann, on her phone',
        '* Bob',
        '',
        '### Late nights',
        HELLO,
      ),
    ).toEqual({
      blocks: [
        { kind: 'paragraph', pieces: [text('We thank the friends who played the first games.')] },
        { kind: 'heading', level: 2, pieces: [text('Pilot study')] },
        { kind: 'list', items: [[text('Ann, on her phone')], [text('Bob')]] },
        { kind: 'heading', level: 3, pieces: [text('Late nights')] },
        { kind: 'paragraph', pieces: [text(HELLO)] },
      ],
      problems: [],
    });
    expect(parseAcknowledgments('')).toEqual({ blocks: [], problems: [] });
    expect(parseAcknowledgments('# Acknowledgments\r\n\r\nThanks!\r\n').blocks).toEqual([
      { kind: 'paragraph', pieces: [text('Thanks!')] },
    ]);
  });

  test('keep a list together across blank lines, and a line right after an item on that item', () => {
    expect(parse('- Ann', '', '- Bob', 'and Cy', '', 'Then a paragraph.', '- and a new list').blocks).toEqual([
      { kind: 'list', items: [[text('Ann')], [text('Bob'), text(' and Cy')]] },
      { kind: 'paragraph', pieces: [text('Then a paragraph.')] },
      { kind: 'list', items: [[text('and a new list')]] },
    ]);
  });

  test('show bold, italic, links and escaped marks', () => {
    expect(
      parse('Thanks to **Ann** and *Bob*, to [Cy](https://cy.example/a%28b%29) and to \\*D\\* \\[E\\].').blocks,
    ).toEqual([
      {
        kind: 'paragraph',
        pieces: [
          text('Thanks to '),
          { kind: 'strong', text: 'Ann' },
          text(' and '),
          { kind: 'em', text: 'Bob' },
          text(', to '),
          { kind: 'link', text: 'Cy', href: 'https://cy.example/a%28b%29' },
          text(' and to *D* [E].'),
        ],
      },
    ]);
  });

  test('show what they make nothing of as it is written', () => {
    const lines = ['> a quote', '1. a number', '`code`', '_under_', 'a < b, 2 * 3', '**open', '[no link]'];
    expect(parse(...lines.flatMap((line) => [line, ''])).blocks).toEqual(
      lines.map((line) => ({ kind: 'paragraph', pieces: [text(line)] })),
    );
  });

  test('refuse what GitHub would show otherwise than the home page, by the line, and leave it out', () => {
    const { blocks, problems } = parse(
      '# Acknowledgments',
      'Thanks to <b>Ann</b>.',
      'Fish &amp; chips.',
      '![a cat](https://cat.example/cat.png)',
      'See https://ann.example or www.ann.example.',
      '[Ann](http://ann.example)',
      '[Ann](https://ann@example.com)',
      '#### Too deep',
      '# Another title',
      '<!-- a comment',
      'that goes on -->',
    );
    expect(problems.map(({ line, message }) => [line, message])).toEqual([
      [2, 'Leave HTML out: the home page shows no tags.'],
      [3, 'Write the character itself, not a reference such as &lt;.'],
      [4, 'Leave images out: the home page shows none.'],
      [5, 'Write a web address as a link, [text](https://...), which the home page links too.'],
      [6, expect.stringMatching(/^"http:\/\/ann\.example" can't be a link here: it must start with https:\/\//)],
      [7, expect.stringMatching(/^"https:\/\/ann@example\.com" can't be a link here/)],
      [8, 'A heading has ## or ###.'],
      [9, 'Only the title at the top has one #; a heading has ## or ###.'],
      [10, 'Leave HTML out: the home page shows no tags.'],
    ]);
    // A line that breaks the rules is left out, but one whose only problem is in its links still
    // goes on with its paragraph, which the server, seeing the problems, doesn't show: it shows the
    // copy that the build bundled instead. So does a line after a comment that isn't one line.
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'paragraph' });
  });

  test(`have at most ${MAX_LIST_BYTES} bytes, as the server reads them`, () => {
    const message = `A list has at most ${MAX_LIST_BYTES} bytes, or the server won't read it.`;
    // Three bytes each, and one byte short of the most.
    const big = '\u4f60'.repeat(Math.floor(MAX_LIST_BYTES / 3));
    expect(parseAcknowledgments(`${big}x`).problems).toEqual([]);
    expect(parseAcknowledgments(`${big}xy`).problems).toEqual([{ line: 1, message }]);
  });
});

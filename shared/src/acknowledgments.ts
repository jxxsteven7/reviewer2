import { checkWebLink } from './feedback';
import { type ListProblem, MAX_LIST_BYTES, utf8Length } from './lists';

// The acknowledgments (docs/architecture.md#acknowledgments): ACKNOWLEDGMENTS.md in the
// repository, which the maintainers write by hand, as they like and in any language, and which the
// home page shows as the server reads it. It thanks whoever they want to thank, with an account or
// without; the players whose feedback was adopted are listed apart, from the database
// (contributions.ts).
//
// The file is Markdown, of which the home page shows a little, the same as GitHub does: headings
// of two or three #, paragraphs, lists of "- " or "* " items, one line each, links as
// [text](https://...), **bold** and *italic*, and a backslash before a punctuation mark to write
// the mark itself. A title of one # and comments of one line, <!-- ... -->, are for GitHub alone.
// Anything else shows as it is written. What GitHub would show otherwise than the home page is
// refused: HTML, character references such as &lt;, images, web addresses that aren't written as
// links, and links that the link rules of the feedback form refuse (checkWebLink in feedback.ts).
// The page is built from what this returns, never from HTML, so nothing in the file becomes markup.

// A piece of a line: text, bold or italic text, or a link.
export type AcknowledgmentPiece =
  { kind: 'text' | 'strong' | 'em'; text: string } | { kind: 'link'; text: string; href: string };

// A heading, a paragraph, or a list, whose items are a line each.
export type AcknowledgmentBlock =
  | { kind: 'heading'; level: 2 | 3; pieces: AcknowledgmentPiece[] }
  | { kind: 'paragraph'; pieces: AcknowledgmentPiece[] }
  | { kind: 'list'; items: AcknowledgmentPiece[][] };

const TITLE = /^# /;
const HEADING = /^(#{2,3}) +(.*)$/;
const DEEPER = /^#{4,} /;
const ITEM = /^[-*] +(.*)$/;
const COMMENT = /^<!--.*-->$/;
const ESCAPE = /\\([!-/:-@[-`{-~])/g;
// [text](address), where the text may hold escaped brackets.
const LINK = /^\[((?:\\.|[^\\\]])+)\]\(([^\s()]*)\)/;
const PUNCTUATION = /[!-/:-@[-`{-~]/;

// What would show otherwise on GitHub than on the home page.
const HTML = /<[A-Za-z/!?]/;
const REFERENCE = /&#?\w+;/;
const IMAGE = /!\[/;
const ADDRESS = /https?:\/\/|www\./i;

const unescape = (text: string): string => text.replace(ESCAPE, '$1');

// A line's pieces, and what in them breaks the rules.
function readPieces(text: string): { pieces: AcknowledgmentPiece[]; problems: string[] } {
  const pieces: AcknowledgmentPiece[] = [];
  const problems: string[] = [];
  let plain = '';
  const push = (piece: AcknowledgmentPiece) => {
    if (plain !== '') pieces.push({ kind: 'text', text: plain });
    plain = '';
    pieces.push(piece);
  };
  let at = 0;
  while (at < text.length) {
    const char = text[at] as string;
    const next = text[at + 1];
    if (char === '\\' && next !== undefined && PUNCTUATION.test(next)) {
      plain += next;
      at += 2;
      continue;
    }
    const link = char === '[' ? LINK.exec(text.slice(at)) : null;
    if (link) {
      const href = link[2] as string;
      if (checkWebLink(href).link !== href) {
        problems.push(
          `"${href}" can't be a link here: it must start with https://, hold no email address, &...; reference or \\, and have at most 200 characters.`,
        );
      }
      push({ kind: 'link', text: unescape(link[1] as string), href });
      at += link[0].length;
      continue;
    }
    if (text.startsWith('**', at)) {
      const end = text.indexOf('**', at + 2);
      if (end > at + 2) {
        push({ kind: 'strong', text: unescape(text.slice(at + 2, end)) });
        at = end + 2;
        continue;
      }
    } else if (char === '*') {
      const end = text.indexOf('*', at + 1);
      if (end > at + 1 && text[end + 1] !== '*') {
        push({ kind: 'em', text: unescape(text.slice(at + 1, end)) });
        at = end + 1;
        continue;
      }
    }
    plain += char;
    at += 1;
  }
  if (plain !== '') pieces.push({ kind: 'text', text: plain });
  if (pieces.some((piece) => piece.kind !== 'link' && ADDRESS.test(piece.text))) {
    problems.push('Write a web address as a link, [text](https://...), which the home page links too.');
  }
  return { pieces, problems };
}

// What in a line, as it is written, the home page would show otherwise than GitHub.
function markupProblem(line: string): string | null {
  if (HTML.test(line)) return 'Leave HTML out: the home page shows no tags.';
  if (REFERENCE.test(line)) return 'Write the character itself, not a reference such as &lt;.';
  if (IMAGE.test(line)) return 'Leave images out: the home page shows none.';
  return null;
}

// ACKNOWLEDGMENTS.md as the home page shows it, and what in it breaks the rules, each on a line
// counted from 1. A line that breaks them is left out.
export function parseAcknowledgments(text: string): { blocks: AcknowledgmentBlock[]; problems: ListProblem[] } {
  const blocks: AcknowledgmentBlock[] = [];
  const problems: ListProblem[] = [];
  if (utf8Length(text) > MAX_LIST_BYTES) {
    problems.push({ line: 1, message: `A list has at most ${MAX_LIST_BYTES} bytes, or the server won't read it.` });
  }
  // The paragraph or the list that the next line may go on, and the text of the paragraph so far.
  let open: { kind: 'paragraph'; lines: string[] } | { kind: 'list' } | null = null;
  let blank = false;
  const pieces = (written: string, line: number): AcknowledgmentPiece[] => {
    const read = readPieces(written);
    for (const message of read.problems) problems.push({ line, message });
    return read.pieces;
  };
  // A paragraph's lines are checked one by one, as they come, so that a problem is told on its
  // line, and read together once the paragraph ends, as bold text may go on to the next line.
  const close = () => {
    if (open?.kind === 'paragraph') blocks.push({ kind: 'paragraph', pieces: readPieces(open.lines.join(' ')).pieces });
    open = null;
  };
  text.split(/\r?\n/).forEach((raw, index) => {
    const number = index + 1;
    const line = raw.trim();
    if (line === '') {
      if (open?.kind === 'paragraph') close();
      blank = true;
      return;
    }
    const wasBlank = blank;
    blank = false;
    if (COMMENT.test(line)) return;
    const wrong = markupProblem(line);
    if (wrong) {
      problems.push({ line: number, message: wrong });
      return;
    }
    if (TITLE.test(line)) {
      if (blocks.length > 0 || open !== null) {
        problems.push({ line: number, message: 'Only the title at the top has one #; a heading has ## or ###.' });
      }
      return;
    }
    if (DEEPER.test(line)) {
      problems.push({ line: number, message: 'A heading has ## or ###.' });
      return;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      close();
      const level = (heading[1] as string).length as 2 | 3;
      blocks.push({ kind: 'heading', level, pieces: pieces(heading[2] as string, number) });
      return;
    }
    const item = ITEM.exec(line);
    if (item) {
      if (open?.kind !== 'list') {
        close();
        blocks.push({ kind: 'list', items: [] });
        open = { kind: 'list' };
      }
      (blocks.at(-1) as { items: AcknowledgmentPiece[][] }).items.push(pieces(item[1] as string, number));
      return;
    }
    // A line after an item, with no blank line between them, goes on with that item, as on GitHub.
    if (open?.kind === 'list' && !wasBlank) {
      const items = (blocks.at(-1) as { items: AcknowledgmentPiece[][] }).items;
      items[items.length - 1] = [...(items.at(-1) as AcknowledgmentPiece[]), ...pieces(` ${line}`, number)];
      return;
    }
    pieces(line, number);
    if (open?.kind === 'paragraph') open.lines.push(line);
    else {
      close();
      open = { kind: 'paragraph', lines: [line] };
    }
  });
  close();
  return { blocks, problems };
}

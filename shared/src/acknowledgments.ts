import { CHARACTER_REFERENCE, checkWebLink, MAX_LINK_LENGTH } from './feedback';
import { type ListProblem, sizeProblem } from './lists';

// The acknowledgments (docs/architecture.md#acknowledgments): ACKNOWLEDGMENTS.md in the
// repository, which the maintainers write by hand, as they like and in any language, and which the
// home page shows as the server reads it. It thanks whoever they want to thank, with an account or
// without; the players whose feedback was adopted are listed apart, from the database
// (contributions.ts).
//
// The file is Markdown, of which the home page shows a little, as GitHub does: headings of two or
// three #, paragraphs, lists of "- " or "* " items, links as [text](https://...), **bold** and
// *italic*, and a backslash before a punctuation mark to write the mark itself. A title of one #
// and comments of one line, <!-- ... -->, are for GitHub alone. Refused, in CI and by the server,
// is what GitHub would show as something else: HTML, character references such as &lt;, images,
// horizontal rules, web addresses that aren't written as links, links that the link rules of a
// public profile refuse (checkWebLink in feedback.ts), and links inside bold or italic text.
// Anything else that this makes nothing of, such as a numbered list or _italic_ with underscores,
// shows as it is written, which may differ from GitHub. The page is built from what this returns,
// never from HTML, so nothing in the file becomes markup.

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
// [text](address), where the text may hold escaped brackets; and the same anywhere in a text.
const LINK = /^\[((?:\\.|[^\\\]])+)\]\(([^\s()]*)\)/;
const LINK_INSIDE = /\[(?:\\.|[^\\\]])+\]\([^\s()]*\)/;
const PUNCTUATION = /[!-/:-@[-`{-~]/;

// What would show otherwise on GitHub than on the home page.
const HTML = /<[A-Za-z/!?]/;
const IMAGE = /!\[/;
const RULE = /^([-*_])(?: *\1){2,}$/;
const ADDRESS = /https?:\/\/|www\./i;

const unescape = (text: string): string => text.replace(ESCAPE, '$1');

// What in a text breaks the rules, and where in it, counted from 0.
interface PieceProblem {
  at: number;
  message: string;
}

// A text's pieces, and what in them breaks the rules.
function readPieces(text: string): { pieces: AcknowledgmentPiece[]; problems: PieceProblem[] } {
  const pieces: AcknowledgmentPiece[] = [];
  const problems: PieceProblem[] = [];
  let plain = '';
  // Where the plain text so far begins.
  let plainAt = 0;
  const address = (piece: string, at: number) => {
    const found = ADDRESS.exec(piece);
    if (found) {
      problems.push({
        at: at + found.index,
        message: 'Write a web address as a link, [text](https://...), which the home page links too.',
      });
    }
  };
  const flush = () => {
    if (plain === '') return;
    address(plain, plainAt);
    pieces.push({ kind: 'text', text: plain });
    plain = '';
  };
  // A bold or italic piece, which is shown as written when a link is inside it.
  const marked = (kind: 'strong' | 'em', inner: string, at: number) => {
    flush();
    if (LINK_INSIDE.test(inner)) {
      problems.push({
        at,
        message: 'A link inside bold or italic text is shown as written here: write the link on its own.',
      });
    } else {
      address(inner, at);
    }
    pieces.push({ kind, text: unescape(inner) });
  };
  let at = 0;
  while (at < text.length) {
    const char = text[at] as string;
    const next = text[at + 1];
    if (char === '\\' && next !== undefined && PUNCTUATION.test(next)) {
      if (plain === '') plainAt = at;
      plain += next;
      at += 2;
      continue;
    }
    const link = char === '[' ? LINK.exec(text.slice(at)) : null;
    if (link) {
      const href = link[2] as string;
      if (checkWebLink(href).link !== href) {
        problems.push({
          at,
          message: `"${href}" can't be a link here: it must start with https://, hold no email address, &...; reference or \\, and have at most ${MAX_LINK_LENGTH} characters.`,
        });
      }
      flush();
      pieces.push({ kind: 'link', text: unescape(link[1] as string), href });
      at += link[0].length;
      continue;
    }
    if (text.startsWith('**', at)) {
      const end = text.indexOf('**', at + 2);
      if (end > at + 2) {
        marked('strong', text.slice(at + 2, end), at);
        at = end + 2;
        continue;
      }
    } else if (char === '*') {
      const end = text.indexOf('*', at + 1);
      if (end > at + 1 && text[end + 1] !== '*') {
        marked('em', text.slice(at + 1, end), at);
        at = end + 1;
        continue;
      }
    }
    if (plain === '') plainAt = at;
    plain += char;
    at += 1;
  }
  flush();
  return { pieces, problems };
}

// What in a line, as it is written, the home page would show otherwise than GitHub.
function markupProblem(line: string): string | null {
  if (HTML.test(line)) return 'Leave HTML out: the home page shows no tags.';
  if (CHARACTER_REFERENCE.test(line)) return 'Write the character itself, not a reference such as &lt;.';
  if (IMAGE.test(line)) return 'Leave images out: the home page shows none.';
  if (RULE.test(line)) return 'Leave horizontal rules out: the home page shows none.';
  return null;
}

// A line of the file, as written, with its number, counted from 1.
interface Line {
  number: number;
  text: string;
}

// ACKNOWLEDGMENTS.md as the home page shows it, and what in it breaks the rules, each on a line
// counted from 1. A line that breaks them is left out.
export function parseAcknowledgments(text: string): { blocks: AcknowledgmentBlock[]; problems: ListProblem[] } {
  const blocks: AcknowledgmentBlock[] = [];
  const problems: ListProblem[] = [];
  const size = sizeProblem(text);
  if (size) problems.push(size);
  // The lines are read together, joined with a space, since bold text or a link may go on from
  // one line to the next, and a problem is told on the line it is in.
  const pieces = (lines: Line[]): AcknowledgmentPiece[] => {
    const read = readPieces(lines.map(({ text: written }) => written).join(' '));
    for (const { at, message } of read.problems) {
      let start = 0;
      let line = lines[0] as Line;
      for (const next of lines) {
        line = next;
        if (at < start + next.text.length + 1) break;
        start += next.text.length + 1;
      }
      problems.push({ line: line.number, message });
    }
    return read.pieces;
  };
  // The paragraph or the list item that the next line may go on with, as its lines so far, and
  // whether the last block is a list that the next item goes on with.
  let open: { kind: 'paragraph' | 'item'; lines: Line[] } | null = null;
  let list = false;
  const finish = () => {
    if (open === null) return;
    const read = pieces(open.lines);
    if (open.kind === 'paragraph') blocks.push({ kind: 'paragraph', pieces: read });
    else (blocks.at(-1) as { items: AcknowledgmentPiece[][] }).items.push(read);
    open = null;
  };
  text.split(/\r?\n/).forEach((raw, index) => {
    const number = index + 1;
    const line = raw.trim();
    if (line === '') {
      finish();
      return;
    }
    // A comment is for GitHub alone, and neither starts nor ends anything.
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
      finish();
      list = false;
      const level = (heading[1] as string).length as 2 | 3;
      blocks.push({ kind: 'heading', level, pieces: pieces([{ number, text: heading[2] as string }]) });
      return;
    }
    const item = ITEM.exec(line);
    if (item) {
      finish();
      if (!list) {
        blocks.push({ kind: 'list', items: [] });
        list = true;
      }
      open = { kind: 'item', lines: [{ number, text: item[1] as string }] };
      return;
    }
    // A line right after an item, with no blank line between them, goes on with that item, as on
    // GitHub; one after a blank line starts a paragraph, and ends the list.
    if (open?.kind === 'item') {
      open.lines.push({ number, text: line });
      return;
    }
    if (open?.kind === 'paragraph') {
      open.lines.push({ number, text: line });
      return;
    }
    list = false;
    open = { kind: 'paragraph', lines: [{ number, text: line }] };
  });
  finish();
  problems.sort((a, b) => a.line - b.line);
  return { blocks, problems };
}

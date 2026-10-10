import { closeSync, constants, fstatSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  type ListName,
  type ListProblem,
  MAX_LIST_BYTES,
  parseAcknowledgments,
  parseSponsors,
} from '@reviewer2/shared';

// The lists of thanks at the foot of the home page, ACKNOWLEDGMENTS.md and SPONSORS.md
// (docs/architecture.md#lists-of-thanks), as the page asks for them: { ok: true, sections }, in
// JSON.
//
// The build bundles the lists as the repository has them (build.mjs). With CONTENT_DIR, the server
// shows the copies in that directory instead, as they change there, without a new build or a
// restart. Each request looks at the file's modification time and size, and the file is only read
// and checked again when they have changed. A file that is missing, larger than MAX_LIST_BYTES,
// not UTF-8, or that breaks the rules, which the same parser checks as in CI, leaves the bundled
// copy in use, and the log says why, once until something changes. The directory is only read.

type Log = (event: string, fields?: Record<string, unknown>) => void;

export const LIST_FILES: Record<ListName, string> = {
  acknowledgments: 'ACKNOWLEDGMENTS.md',
  sponsors: 'SPONSORS.md',
};

const PARSERS: Record<ListName, (text: string) => { sections: { entries: unknown[] }[]; problems: ListProblem[] }> = {
  acknowledgments: parseAcknowledgments,
  sponsors: parseSponsors,
};

// The lists that the build bundled, or the repository's when the server runs from source.
function bundled(): Record<ListName, string> {
  if (typeof __LISTS__ === 'object') return __LISTS__;
  const root = resolve(import.meta.dirname, '..', '..');
  return {
    acknowledgments: readFileSync(join(root, LIST_FILES.acknowledgments), 'utf8'),
    sponsors: readFileSync(join(root, LIST_FILES.sponsors), 'utf8'),
  };
}

const answer = (sections: unknown) => JSON.stringify({ ok: true, sections });

const describe = (error: unknown) =>
  (error as NodeJS.ErrnoException).code ?? (error instanceof Error ? error.message : String(error));

// A list's text from the file, or why it can't be used. The file is opened without waiting, so
// that a FIFO in its place can't hold the server up, and is read only if it is a regular file, and
// to one byte past the most a list may have, in case it grew since.
function readList(path: string): { text: string } | { reason: string } {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    return { reason: describe(error) };
  }
  try {
    if (!fstatSync(fd).isFile()) return { reason: 'not a file' };
    const buffer = Buffer.alloc(MAX_LIST_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > MAX_LIST_BYTES) return { reason: `larger than ${MAX_LIST_BYTES} bytes` };
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)) };
    } catch {
      return { reason: 'not UTF-8' };
    }
  } catch (error) {
    return { reason: describe(error) };
  } finally {
    closeSync(fd);
  }
}

export class ThanksLists {
  // Each list's answer from the bundled copy.
  private readonly bundled: Record<ListName, string>;
  // Each list's answer from the file in the directory, with the time and size it was read at.
  private readonly read = new Map<ListName, { version: string; answer: string }>();
  // What the log last said about each list's file, so that it says it once.
  private readonly said = new Map<ListName, string>();

  constructor(
    private readonly dir: string | null,
    private readonly log: Log,
    lists: Record<ListName, string> = bundled(),
  ) {
    this.bundled = {
      acknowledgments: answer(PARSERS.acknowledgments(lists.acknowledgments).sections),
      sponsors: answer(PARSERS.sponsors(lists.sponsors).sections),
    };
  }

  // The answer for the home page, from the file in the directory if it can be used, and otherwise
  // from the bundled copy.
  answer(name: ListName): string {
    if (this.dir === null) return this.bundled[name];
    const path = join(this.dir, LIST_FILES[name]);
    let version: string;
    try {
      const { mtimeMs, size, ino } = statSync(path);
      version = `${mtimeMs} ${size} ${ino}`;
    } catch (error) {
      this.read.delete(name);
      return this.skip(name, path, { reason: describe(error) });
    }
    const known = this.read.get(name);
    if (known?.version === version) return known.answer;
    const list = readList(path);
    let result: string;
    if ('reason' in list) {
      result = this.skip(name, path, list);
    } else {
      const { sections, problems } = PARSERS[name](list.text);
      if (problems.length > 0) {
        const [{ line, message }] = problems as [ListProblem];
        result = this.skip(name, path, { reason: 'breaks the rules', problems: problems.length, line, message });
      } else {
        result = answer(sections);
        const entries = sections.reduce((count, { entries }) => count + entries.length, 0);
        this.say(name, `read ${version}`, 'thanks_list_read', { file: path, entries });
      }
    }
    this.read.set(name, { version, answer: result });
    return result;
  }

  // The bundled copy, for a file that can't be used, with a line in the log that says why.
  private skip(name: ListName, path: string, why: { reason: string } & Record<string, unknown>): string {
    this.say(name, JSON.stringify(why), 'thanks_list_skipped', { file: path, ...why, shown: 'bundled' });
    return this.bundled[name];
  }

  private say(name: ListName, what: string, event: string, fields: Record<string, unknown>): void {
    if (this.said.get(name) === what) return;
    this.said.set(name, what);
    this.log(event, fields);
  }
}

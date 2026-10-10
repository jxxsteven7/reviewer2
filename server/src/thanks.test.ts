import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAX_LIST_BYTES, parseAcknowledgments, parseSponsors, SPONSORS_END, SPONSORS_START } from '@reviewer2/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { LIST_FILES, ThanksLists } from './thanks';

const root = join(import.meta.dirname, '..', '..');

// The checks of ACKNOWLEDGMENTS.md and SPONSORS.md, which the server reads as the build bundles
// them: CI runs them with the other tests, so that a list that breaks the rules
// (shared/src/lists.ts) can't be merged, whoever wrote it.
describe('the lists in the repository', () => {
  for (const [name, parse] of [
    [LIST_FILES.acknowledgments, parseAcknowledgments],
    [LIST_FILES.sponsors, parseSponsors],
  ] as const) {
    test(`${name} keeps to the rules`, () => {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(join(root, name)));
      const problems = parse(text).problems.map(({ line, message }) => `line ${line}: ${message}`);
      expect(problems).toEqual([]);
    });
  }

  test('the workflow writes SPONSORS.md by the rules', async () => {
    const script = pathToFileURL(join(root, 'scripts', 'update-sponsors.mjs')).href;
    const { START, END, writeSponsors } = (await import(script)) as {
      START: string;
      END: string;
      writeSponsors(text: string, usernames: string[]): string;
    };
    expect([START, END]).toEqual([SPONSORS_START, SPONSORS_END]);
    const file = readFileSync(join(root, LIST_FILES.sponsors), 'utf8');
    const others = `${file}\n## Other ways\n\n- Ann\n`;
    for (const text of [file, others, writeSponsors(file, ['octocat']), writeSponsors(others, ['octocat'])]) {
      for (const usernames of [[], ['octocat'], ['octocat', 'Mona-Lisa-2', 'x'.repeat(39)]]) {
        const written = writeSponsors(text, usernames);
        const { sections, problems } = parseSponsors(written);
        expect(problems, written).toEqual([]);
        expect(sections.find(({ kind }) => kind === 'github')?.entries ?? []).toEqual(
          usernames.map((name) => ({ name, link: `https://github.com/${name}` })),
        );
      }
    }
  });
});

const BUNDLED = {
  acknowledgments: '# Acknowledgments\n\n## Data\n\n- Ann \u{2014} added words\n',
  sponsors: `# Sponsors\n\n${SPONSORS_START}\n${SPONSORS_END}\n\n## Other ways\n\n- Bob\n`,
};
const NEWER = `# Sponsors\n\n${SPONSORS_START}\n## GitHub Sponsors\n\n- [octocat](https://github.com/octocat)\n${SPONSORS_END}\n`;
const sections = (answer: string) => (JSON.parse(answer) as { ok: true; sections: unknown }).sections;
const bundledSponsors = [{ kind: 'other', entries: [{ name: 'Bob', link: null }] }];
const newerSponsors = [{ kind: 'github', entries: [{ name: 'octocat', link: 'https://github.com/octocat' }] }];

describe('the lists of thanks', () => {
  let dir: string;
  let logs: { event: string; fields?: Record<string, unknown> }[];
  let lists: ThanksLists;
  const file = () => join(dir, 'SPONSORS.md');
  // Writes the file, with a modification time of its own, as a copy that arrives later would have.
  let mtime = 1_000_000;
  const write = (text: string | Buffer, path = file()) => {
    writeFileSync(path, text);
    mtime += 10;
    utimesSync(path, mtime, mtime);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reviewer2-lists-'));
    logs = [];
    lists = new ThanksLists(dir, (event, fields) => logs.push({ event, ...(fields && { fields }) }), BUNDLED);
  });

  afterEach(() => {
    chmodSync(dir, 0o755);
    rmSync(dir, { recursive: true, force: true });
  });

  test('are the bundled ones without a directory', () => {
    const bundled = new ThanksLists(null, () => expect.fail('nothing to log'), BUNDLED);
    expect(JSON.parse(bundled.answer('sponsors'))).toEqual({ ok: true, sections: bundledSponsors });
    expect(sections(bundled.answer('acknowledgments'))).toEqual([
      { kind: 'words', entries: [{ name: 'Ann', link: null, contribution: 'added words' }] },
    ]);
    // By default, as the build bundled them, which is the repository's when running from source.
    const repository = new ThanksLists(null, () => {});
    expect(sections(repository.answer('sponsors'))).toEqual(
      parseSponsors(readFileSync(join(root, 'SPONSORS.md'), 'utf8')).sections,
    );
  });

  test('are read from the directory, and read again only once the file has changed', () => {
    write(NEWER);
    expect(sections(lists.answer('sponsors'))).toEqual(newerSponsors);
    expect(logs).toEqual([{ event: 'thanks_list_read', fields: { file: file(), entries: 1 } }]);
    // Another file of the same size and time is taken for the same one, and not read.
    writeFileSync(file(), NEWER.replace('octocat', 'octodog'));
    utimesSync(file(), mtime, mtime);
    expect(sections(lists.answer('sponsors'))).toEqual(newerSponsors);
    write(NEWER.replaceAll('octocat', 'octodog'));
    expect(sections(lists.answer('sponsors'))).toEqual([
      { kind: 'github', entries: [{ name: 'octodog', link: 'https://github.com/octodog' }] },
    ]);
    expect(logs).toHaveLength(2);
    // The other list has no file here, so it is the bundled one.
    expect(sections(lists.answer('acknowledgments'))).toEqual(
      sections(new ThanksLists(null, () => {}, BUNDLED).answer('acknowledgments')),
    );
  });

  test('fall back to the bundled ones for a file that cannot be used, and say why once', () => {
    const skipped = (fields: Record<string, unknown>) => ({
      event: 'thanks_list_skipped',
      fields: { file: file(), ...fields, shown: 'bundled' },
    });
    const answers = () => [0, 1, 2].map(() => sections(lists.answer('sponsors')));
    const bundled = [bundledSponsors, bundledSponsors, bundledSponsors];

    expect(answers()).toEqual(bundled);
    write('# Sponsors\n\n- Ann\n');
    expect(answers()).toEqual(bundled);
    write('# Sponsors\n\n- Bob\n');
    expect(answers()).toEqual(bundled);
    write(NEWER.replace('octocat](', 'octo cat]('));
    expect(answers()).toEqual(bundled);
    write(`${NEWER}${'x'.repeat(MAX_LIST_BYTES)}`);
    expect(answers()).toEqual(bundled);
    write(Buffer.concat([Buffer.from(NEWER), Buffer.from([0xff])]));
    expect(answers()).toEqual(bundled);
    rmSync(file());
    mkdirSync(file());
    expect(answers()).toEqual(bundled);
    expect(logs).toEqual([
      skipped({ reason: 'ENOENT' }),
      skipped({
        reason: 'breaks the rules',
        problems: 1,
        line: 1,
        message: expect.stringMatching(/^SPONSORS\.md has the line/),
      }),
      // Another file with the same problem isn't logged again.
      skipped({
        reason: 'breaks the rules',
        problems: 1,
        line: 6,
        message: expect.stringMatching(/^A sponsor on GitHub is/),
      }),
      skipped({ reason: `larger than ${MAX_LIST_BYTES} bytes` }),
      skipped({ reason: 'not UTF-8' }),
      skipped({ reason: 'not a file' }),
    ]);

    // Once it can be used again, it is.
    rmSync(file(), { recursive: true });
    write(NEWER);
    expect(sections(lists.answer('sponsors'))).toEqual(newerSponsors);
    rmSync(file());
    expect(sections(lists.answer('sponsors'))).toEqual(bundledSponsors);
    expect(logs.slice(6).map(({ event }) => event)).toEqual(['thanks_list_read', 'thanks_list_skipped']);
  });

  test('are never held up by a FIFO in place of a file', () => {
    if (spawnSync('mkfifo', [file()]).status !== 0) return;
    expect(sections(lists.answer('sponsors'))).toEqual(bundledSponsors);
    expect(logs).toEqual([
      { event: 'thanks_list_skipped', fields: { file: file(), reason: 'not a file', shown: 'bundled' } },
    ]);
  });

  test('only read the directory', () => {
    write(NEWER);
    write(BUNDLED.acknowledgments, join(dir, 'ACKNOWLEDGMENTS.md'));
    const before = readdirSync(dir).map((name) => [name, statSync(join(dir, name)).mtimeMs]);
    chmodSync(dir, 0o555);
    lists.answer('sponsors');
    lists.answer('acknowledgments');
    expect(readdirSync(dir).map((name) => [name, statSync(join(dir, name)).mtimeMs])).toEqual(before);
    expect(logs.map(({ event }) => event)).toEqual(['thanks_list_read', 'thanks_list_read']);
  });
});

#!/usr/bin/env node
// Checks that README.md and its Chinese translation, README.zh-CN.md, are in sync.
//
// The two files must have the same structure: headings at the same levels in the same order,
// identical fenced code blocks, the same link targets, and tables of the same shape.
// README.zh-CN.md also ends with a sync stamp, which is a hash of both files. Any edit to either
// file changes the hash, so the check fails until someone brings the other file in line and
// records a new stamp with --update.
//
// Usage:
//   node scripts/check-readme-sync.mjs           check only (CI runs this)
//   node scripts/check-readme-sync.mjs --update  check the structure, then record a new stamp

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EN = 'README.md';
const ZH = 'README.zh-CN.md';
const STAMP_LINE = /^<!-- readme-sync: ([0-9a-f]{64}) -->[ \t]*$/gm;
const UPDATE_COMMAND = 'node scripts/check-readme-sync.mjs --update';

// In-page anchors and the language switcher (links between the two READMEs) legitimately
// differ between the languages, so they are left out of the link comparison.
const IGNORED_LINK = /^(#|README(\.zh-CN)?\.md(#|$))/;

function read(name) {
  return readFileSync(join(root, name), 'utf8').replace(/\r\n/g, '\n');
}

function outline(markdown) {
  const headings = [];
  const codeBlocks = [];
  const links = [];
  const tables = [];
  let fence = null;
  let tableRows = 0;
  let tableColumns = 0;

  const endTable = () => {
    if (tableRows > 0) {
      // The first two rows of a table are the header and the separator.
      tables.push(`${Math.max(tableRows - 2, 0)} rows x ${tableColumns} columns`);
    }
    tableRows = 0;
  };

  const addLink = (target) => {
    if (!IGNORED_LINK.test(target)) links.push(target);
  };

  for (const line of markdown.split('\n')) {
    if (fence) {
      if (fence.close.test(line)) {
        codeBlocks.push(fence.lines.join('\n'));
        fence = null;
      } else {
        // Remove the fence's own indentation so code blocks inside list items compare cleanly.
        fence.lines.push(line.replace(fence.indent, ''));
      }
      continue;
    }

    const open = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (open) {
      endTable();
      const [, indent, marker, info] = open;
      fence = {
        indent: new RegExp(`^ {0,${indent.length}}`),
        close: new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`),
        lines: [`${marker}${info.trim()}`],
      };
      continue;
    }

    if (line.trim().startsWith('|')) {
      if (tableRows === 0) {
        tableColumns = line
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|').length;
      }
      tableRows += 1;
    } else {
      endTable();
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) headings.push({ level: heading[1].length, text: heading[2] });

    const text = line.replace(/`[^`]*`/g, '');
    for (const match of text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) addLink(match[1]);
    for (const match of text.matchAll(/<(https?:\/\/[^>\s]+)>/g)) addLink(match[1]);
    const reference = text.match(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(\s|$)/);
    if (reference) addLink(reference[1]);
  }
  endTable();

  return { headings, codeBlocks, links, tables };
}

function compare(en, zh) {
  const problems = [];

  const headingCount = Math.max(en.headings.length, zh.headings.length);
  for (let i = 0; i < headingCount; i += 1) {
    const a = en.headings[i];
    const b = zh.headings[i];
    if (!a || !b || a.level !== b.level) {
      const describe = (h) => (h ? `"${'#'.repeat(h.level)} ${h.text}"` : 'nothing');
      problems.push(`Heading ${i + 1} is ${describe(a)} in ${EN} but ${describe(b)} in ${ZH}.`);
      break;
    }
  }

  if (en.codeBlocks.length !== zh.codeBlocks.length) {
    problems.push(`${EN} has ${en.codeBlocks.length} code blocks, but ${ZH} has ${zh.codeBlocks.length}.`);
  } else {
    en.codeBlocks.forEach((block, i) => {
      if (block !== zh.codeBlocks[i]) {
        problems.push(
          `Code block ${i + 1} differs. Code blocks must be identical in both files.\n` +
            `  ${EN}:\n${indent(block)}\n  ${ZH}:\n${indent(zh.codeBlocks[i])}`,
        );
      }
    });
  }

  const onlyInEn = subtract(en.links, zh.links);
  const onlyInZh = subtract(zh.links, en.links);
  if (onlyInEn.length) problems.push(`Links only in ${EN}: ${onlyInEn.join(', ')}`);
  if (onlyInZh.length) problems.push(`Links only in ${ZH}: ${onlyInZh.join(', ')}`);

  if (en.tables.join() !== zh.tables.join()) {
    problems.push(`Tables differ. ${EN}: [${en.tables.join('; ')}]. ${ZH}: [${zh.tables.join('; ')}].`);
  }

  return problems;
}

// Returns the items of `list` that `other` lacks, counting duplicates.
function subtract(list, other) {
  const remaining = [...other];
  return list.filter((item) => {
    const index = remaining.indexOf(item);
    if (index === -1) return true;
    remaining.splice(index, 1);
    return false;
  });
}

function indent(text) {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

function stampFor(enText, zhBody) {
  return createHash('sha256').update(enText.trimEnd()).update('\0').update(zhBody).digest('hex');
}

const update = process.argv.includes('--update');
const enText = read(EN);
const zhText = read(ZH);
// The stamp belongs on the last line, but tolerate text added after it: drop every stamp line
// from the body and treat the last one as the recorded stamp.
const zhBody = zhText.replace(STAMP_LINE, '').trimEnd();
const recorded = [...zhText.matchAll(STAMP_LINE)].at(-1)?.[1];
const expected = stampFor(enText, zhBody);

const problems = compare(outline(enText), outline(zhBody));
if (problems.length) {
  console.error(`${EN} and ${ZH} are out of sync:\n`);
  for (const problem of problems) console.error(`- ${problem}\n`);
  if (update) console.error('No stamp was recorded. Fix the problems above first.');
  process.exit(1);
}

if (update) {
  writeFileSync(join(root, ZH), `${zhBody}\n\n<!-- readme-sync: ${expected} -->\n`);
  console.log(`Recorded a new sync stamp in ${ZH}.`);
} else if (recorded !== expected) {
  console.error(
    recorded
      ? `The sync stamp in ${ZH} is out of date: one of the READMEs changed after the last sync.`
      : `${ZH} has no sync stamp.`,
  );
  console.error(`Update the other README to match, then run:\n\n  ${UPDATE_COMMAND}\n`);
  process.exit(1);
} else {
  console.log(`${EN} and ${ZH} are in sync.`);
}

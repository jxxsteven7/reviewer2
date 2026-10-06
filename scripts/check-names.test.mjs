// Tests for scripts/check-names.mjs. Run them with: node --test scripts/check-names.test.mjs
//
// The real spellings must not appear in the repository, so the tests look for made-up ones. The
// fixtures that stand for Chinese text are written as \u escapes, because everything in the
// repository is in English (docs/rules/language.md); the escapes spell out the same characters.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkPath, checkText, entryFor, findSpellings, masked, SPELLINGS } from './check-names.mjs';

const SCRIPT = fileURLToPath(new URL('./check-names.mjs', import.meta.url));

const FAKE_HAN = '假名字样'; // four made-up Chinese characters
const FAKE = [entryFor('zorblax'), entryFor(FAKE_HAN)];
const found = (text) => findSpellings(text, FAKE).length;

describe('spellings', () => {
  test('the stored entries are well formed', () => {
    for (const entry of SPELLINGS) {
      assert.ok(['latin', 'han'].includes(entry.script));
      assert.ok(Number.isInteger(entry.length) && entry.length > 0);
      assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    }
  });

  test('entryFor folds case, accents, separators and full-width forms', () => {
    const plain = entryFor('zorblax');
    assert.deepEqual(plain, { script: 'latin', length: 7, sha256: plain.sha256 });
    for (const spelling of ['Zorblax', 'ZOR-BLAX', 'zor blax', 'zórblàx', 'ｚｏｒｂｌａｘ']) {
      assert.deepEqual(entryFor(spelling), plain, spelling);
    }
    assert.equal(entryFor(FAKE_HAN).script, 'han');
    assert.equal(entryFor(FAKE_HAN).length, 4);
    assert.throws(() => entryFor('123 -'), /needs letters/);
  });
});

describe('finding a Latin spelling', () => {
  test('in any case and with separators between the letters', () => {
    for (const text of [
      'zorblax',
      'Zorblax',
      'ZORBLAX',
      'Zor Blax',
      'zor-blax',
      'zor_blax',
      'ZorBlax',
      'z.o.r.b.l.a.x',
      'zor/blax',
      'zórblàx',
      'ｚｏｒｂｌａｘ',
    ]) {
      assert.equal(found(text), 1, text);
    }
  });

  test('wherever a word starts', () => {
    for (const text of [
      'feat/zorblax',
      'https://zorblax.example/',
      'the zorblax board game',
      '#zorblax',
      '2zorblax',
      'myZorblax',
      '"Zorblax"',
      `${FAKE_HAN.slice(0, 2)}zorblax`,
    ]) {
      assert.equal(found(text), 1, text);
    }
  });

  test('not inside a word or across other punctuation', () => {
    for (const text of ['xzorblax', 'unzor blax', 'zor, blax', 'zor:blax', 'zorbl4x', 'zorbla', 'zor(blax)']) {
      assert.equal(found(text), 0, text);
    }
  });
});

describe('finding a Chinese spelling', () => {
  test('in a run of Chinese characters, which spaces and middle dots do not end', () => {
    for (const text of [
      FAKE_HAN,
      `一${FAKE_HAN}二`,
      `${FAKE_HAN.slice(0, 2)} ${FAKE_HAN.slice(2)}`,
      `${FAKE_HAN.slice(0, 2)}·${FAKE_HAN.slice(2)}`,
      `${FAKE_HAN.slice(0, 2)}　${FAKE_HAN.slice(2)}`,
    ]) {
      assert.equal(found(text), 1, text);
    }
  });

  test('not across other punctuation or letters', () => {
    for (const separator of ['。', '，', ',', 'a', '1']) {
      const text = `${FAKE_HAN.slice(0, 2)}${separator}${FAKE_HAN.slice(2)}`;
      assert.equal(found(text), 0, text);
    }
  });
});

describe('reports', () => {
  test('give the line and column where each spelling starts and ends', () => {
    assert.deepEqual(findSpellings('one\ntwo Zor-Blax three zorblax', FAKE), [
      { line: 2, column: 5, end: 12 },
      { line: 2, column: 20, end: 26 },
    ]);
    assert.deepEqual(findSpellings(`\r\n一${FAKE_HAN}`, FAKE), [{ line: 2, column: 2, end: 5 }]);
  });

  test('blot spellings out instead of repeating them', () => {
    assert.equal(masked('feat/zorblax-rules', FAKE), 'feat/•••••••-rules');
    assert.equal(masked('no match here', FAKE), 'no match here');

    const problems = [...checkText('see zorblax', 'branch zorblax', FAKE), ...checkPath('docs/Zorblax.md', FAKE)];
    assert.equal(problems.length, 2);
    for (const { where, detail } of problems) {
      assert.equal(found(`${where} ${detail}`), 0, where);
    }
    assert.equal(problems[0].where, 'branch •••••••:1:5');
  });

  test('find nothing in ordinary text', () => {
    assert.deepEqual(checkText('feat: add rooms\n\nPlayers join with a code.', 'commit', FAKE), []);
  });
});

describe('command line', () => {
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  test('passes text without the name', () => {
    const result = run('text', '--label', 'branch name', '--', 'feat/keywords-rules');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /OK \(branch name\)/);
  });

  test('prints the entry for a new spelling', () => {
    const result = run('hash', 'zorblax');
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`sha256: '${entryFor('zorblax').sha256}'`));
  });

  test('rejects wrong arguments', () => {
    assert.equal(run().status, 2);
    assert.equal(run('nonsense').status, 2);
    assert.equal(run('msg').status, 2);
    assert.equal(run('files', 'extra').status, 2);
    assert.equal(run('text').status, 2);
  });
});

// Tests for scripts/check-words.mjs. Run them with: node --test scripts/check-words.test.mjs
//
// The fixtures that stand for Chinese text are written as \u escapes, because everything in the
// repository is in English (docs/rules/language.md).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { annotation, checkAcrossLists, checkWordList, lineOf, main, MIN_TERMS, termLines } from './check-words.mjs';

const SCRIPT = fileURLToPath(new URL('./check-words.mjs', import.meta.url));
const ATTENTION = '\u6ce8\u610f\u529b';
const SUPERVISOR = '\u5bfc\u5e08'; // what the game calls the PI in Chinese
const REVIEWER = '\u5ba1\u7a3f\u4eba';
const REVIEWER_TRADITIONAL = '\u5be9\u7a3f\u4eba';

const terms = (count, make = (i) => ({ id: `term-${i}`, zh: `\u8bcd${i}`, en: `Term ${i}` })) =>
  Array.from({ length: count }, (_, i) => make(i));

const list = (overrides = {}) => ({
  id: 'ml',
  name: { zh: '\u673a\u5668\u5b66\u4e60', en: 'Machine Learning' },
  contributors: ['Ann'],
  terms: terms(MIN_TERMS),
  ...overrides,
});

const check = (data, file = 'ml.json') => checkWordList(data, file);
const has = (lines, pattern) => lines.some((line) => pattern.test(line));

describe('a word list', () => {
  test('in the documented format passes', () => {
    const result = check(list());
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.counts, { zh: MIN_TERMS, en: MIN_TERMS });
  });

  test('allows the optional fields', () => {
    const rich = terms(MIN_TERMS, (i) => ({
      id: `term-${i}`,
      zh: `\u8bcd${i}`,
      en: `Term ${i}`,
      difficulty: 1 + (i % 5),
      related: [`term-${(i + 1) % MIN_TERMS}`],
      note: { zh: '\u4e00\u53e5\u8bdd', en: 'One line' },
    }));
    assert.deepEqual(check(list({ terms: rich })).problems, []);
  });

  test('must match its file name and have a name, contributors and terms', () => {
    assert.ok(has(check(list(), 'nlp.json').problems, /"id" must be "nlp"/));
    assert.ok(has(check(list({ id: 'Bad_Name' }), 'Bad_Name.json').problems, /file name must be lowercase/));
    assert.ok(has(check(list({ name: { en: 'Machine Learning' } })).problems, /"name" needs both/));
    assert.ok(has(check(list({ contributors: [] })).problems, /"contributors" must list/));
    assert.ok(has(check(list({ terms: 'none' })).problems, /"terms" must be a list/));
    assert.ok(has(check(list({ extra: true })).problems, /unknown field "extra"/));
    assert.ok(has(check([]).problems, /one JSON object/));
  });

  test('needs 25 terms in at least one language', () => {
    assert.ok(has(check(list({ terms: terms(MIN_TERMS - 1) })).problems, /at least 25 different terms/));
    const englishOnly = terms(MIN_TERMS, (i) => ({ id: `term-${i}`, en: `Term ${i}` }));
    const result = check(list({ terms: englishOnly }));
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.counts, { zh: 0, en: MIN_TERMS });
  });

  test('warns about a language that has some terms, but fewer than 25', () => {
    const mixed = terms(MIN_TERMS, (i) => ({
      id: `term-${i}`,
      en: `Term ${i}`,
      ...(i < 3 ? { zh: `\u8bcd${i}` } : {}),
    }));
    const { problems, warnings } = check(list({ terms: mixed }));
    assert.deepEqual(problems, []);
    assert.ok(has(warnings, /only 3 terms have "zh"/));
  });
});

describe('a term', () => {
  const withTerm = (term) => check(list({ terms: [...terms(MIN_TERMS), term] }));

  test('needs a well-formed, unique id', () => {
    assert.ok(has(withTerm({ id: 'Attention', en: 'Attention' }).problems, /"id" must be lowercase/));
    assert.ok(has(withTerm({ id: 'term-3', en: 'Attention' }).problems, /already used by terms\[3\]/));
  });

  test('needs Chinese, English or both, as non-empty text', () => {
    assert.ok(has(withTerm({ id: 'empty' }).problems, /needs "zh", "en" or both/));
    assert.ok(has(withTerm({ id: 'blank', en: '  ' }).problems, /must be a non-empty string/));
    assert.ok(has(withTerm({ id: 'number', en: 3 }).problems, /must be a non-empty string/));
    assert.ok(has(withTerm({ id: 'padded', en: ' Attention' }).problems, /spaces at its ends/));
    assert.ok(has(withTerm({ id: 'spaced', en: 'Peer  review' }).problems, /two spaces in a row/));
  });

  test('holds no space but the plain one, and nothing invisible', () => {
    const hidden = {
      'deep\tlearning': 'U+0009',
      'deep\nlearning': 'U+000A',
      'Peer\u00a0review': 'U+00A0',
      'Peer\u3000review': 'U+3000',
      'atten\u200btion': 'U+200B',
      'soft\u00adware': 'U+00AD',
      'bell\u0007': 'U+0007',
      'Attention\n': 'U+000A',
    };
    for (const [text, code] of Object.entries(hidden)) {
      const { problems } = withTerm({ id: 'hidden', en: text });
      assert.ok(has(problems, new RegExp(`"en" .* holds ${code.replace('+', '\\+')}: use plain spaces only`)), code);
    }
    // Each character is named once, and the spaces around it aren't reported a second time.
    const several = withTerm({ id: 'hidden', en: 'a\t\tb\u200b' }).problems;
    assert.ok(has(several, /holds U\+0009, U\+200B: /));
    assert.equal(several.length, 1);
    assert.deepEqual(withTerm({ id: 'plain', en: 'Peer review', zh: ATTENTION }).problems, []);
  });

  test('must not be the same word as another term in the same language', () => {
    assert.ok(has(withTerm({ id: 'again', en: 'Term 3' }).problems, /"en" "Term 3" repeats terms\[3\]$/));
    // Only letters and digits count, as on the board: not case, width, spaces, hyphens or accents.
    for (const spelling of ['TERM 3', 'term-3', 'Term3', 'T\u00e9rm 3', '\uff34\uff45\uff52\uff4d \uff13']) {
      const { problems } = withTerm({ id: 'again', en: spelling });
      assert.ok(has(problems, /repeats terms\[3\] \("Term 3"\), which has the same letters and digits/), spelling);
    }
    assert.ok(has(withTerm({ id: 'again', zh: '\u8bcd\uff13' }).problems, /repeats terms\[3\]/));
    const both = (first, second) =>
      check(list({ terms: [...terms(MIN_TERMS), { id: 'first', ...first }, { id: 'second', ...second }] }));
    assert.ok(has(both({ en: 'C++' }, { en: 'C#' }).problems, /"en" "C#" repeats terms\[25\] \("C\+\+"\)/));
    // Traditional and simplified Chinese characters are the same too.
    assert.ok(has(both({ zh: REVIEWER }, { zh: REVIEWER_TRADITIONAL }).problems, /"zh" .* repeats terms\[25\]/));
    // The same spelling in the other language is another word.
    assert.deepEqual(both({ en: 'Model' }, { zh: 'Model' }).problems, []);
  });

  test('counts each word once', () => {
    const { counts } = check(list({ terms: [...terms(MIN_TERMS), { id: 'again', en: 'term-3', zh: ATTENTION }] }));
    assert.deepEqual(counts, { zh: MIN_TERMS + 1, en: MIN_TERMS });
  });

  test('needs a letter or a digit', () => {
    assert.ok(has(withTerm({ id: 'symbols', en: '+++' }).problems, /"en" "\+\+\+" has no letters or digits/));
    assert.deepEqual(withTerm({ id: 'number', en: '42' }).problems, []);
  });

  test('checks the optional fields', () => {
    assert.ok(has(withTerm({ id: 'hard', en: 'Hard', difficulty: 6 }).problems, /"difficulty" must be/));
    assert.ok(has(withTerm({ id: 'hard', en: 'Hard', difficulty: 1.5 }).problems, /"difficulty" must be/));
    assert.ok(has(withTerm({ id: 'rel', en: 'Rel', related: 'term-1' }).problems, /"related" must be/));
    assert.ok(has(withTerm({ id: 'note', en: 'Note', note: { fr: 'Non' } }).problems, /"note" must have/));
    assert.ok(has(withTerm({ id: 'extra', en: 'Extra', hint: 'x' }).problems, /unknown field "hint"/));
  });

  test('may be related only to other terms of the same file', () => {
    const related = (...ids) => withTerm({ id: 'rel', en: 'Rel', related: ids }).problems;
    assert.deepEqual(related('term-1', 'term-2'), []);
    assert.ok(has(related('term-1', 'nope'), /\(rel\): "related" names "nope", which is not the id of a term/));
    assert.ok(has(related('rel'), /\(rel\): "related" names the term itself/));
    // A term may name one that comes after it.
    const forward = [{ id: 'first', en: 'First', related: ['term-3'] }, ...terms(MIN_TERMS)];
    assert.deepEqual(check(list({ terms: forward })).problems, []);
  });

  test("brings warnings for long terms and the game's own names", () => {
    const long = withTerm({ id: 'long', en: 'Reproducibility', zh: '\u53ef\u91cd\u590d\u6027\u7814\u7a76' });
    assert.deepEqual(long.problems, []);
    assert.ok(has(long.warnings, /"en" "Reproducibility" is longer than 14/));
    assert.ok(has(long.warnings, /"zh" .* is longer than 5/));
    assert.ok(has(withTerm({ id: 'chair', en: 'Chair' }).warnings, /name of a role or card/));
    assert.ok(has(withTerm({ id: 'supervisor', zh: SUPERVISOR }).warnings, /name of a role or card/));
    assert.deepEqual(withTerm({ id: 'attention', zh: ATTENTION, en: 'Attention' }).warnings, []);
  });

  test('is measured as English when it has no Chinese characters, as on a card', () => {
    assert.deepEqual(withTerm({ id: 'github', zh: 'GitHub', en: 'GitHub' }).warnings, []);
    assert.deepEqual(withTerm({ id: 'transformer', zh: 'Transformer' }).warnings, []);
    assert.ok(
      has(withTerm({ id: 'long', zh: 'Reproducibility' }).warnings, /"zh" "Reproducibility" is longer than 14/),
    );
    // Chinese characters with others are measured as Chinese.
    assert.ok(has(withTerm({ id: 'mixed', zh: `GPU ${ATTENTION}` }).warnings, /"zh" .* is longer than 5/));
  });

  test('may list its other forms in each language', () => {
    const forms = { zh: [SUPERVISOR], en: ['modeling', 'modelled', 'remodel'] };
    assert.deepEqual(withTerm({ id: 'model', zh: ATTENTION, en: 'Model', forms }).problems, []);
    assert.deepEqual(withTerm({ id: 'model', en: 'Model', forms: { en: ['modeling'] } }).problems, []);
  });

  test('lists its forms as text, in "zh" and "en" lists', () => {
    const forms = (value) => withTerm({ id: 'model', en: 'Model', forms: value }).problems;
    for (const shape of [['modeling'], {}, { en: [] }, { fr: ['modele'] }, { en: 'modeling' }, null]) {
      assert.ok(has(forms(shape), /"forms" must have a "zh" list, an "en" list or both/), JSON.stringify(shape));
    }
    assert.ok(has(forms({ en: ['modeling', 3] }), /"forms\.en" must hold only non-empty strings/));
    assert.ok(has(forms({ zh: [' '] }), /"forms\.zh" must hold only non-empty strings/));
    assert.ok(has(forms({ en: ['model\u00a0ing'] }), /"forms\.en" "model.ing" holds U\+00A0: use plain spaces only/));
    assert.ok(has(forms({ en: ['model\u200bing'] }), /holds U\+200B/));
    assert.ok(has(forms({ en: ['mod  eling'] }), /"forms\.en" "mod {2}eling" has spaces at its ends or two spaces/));
    assert.ok(has(forms({ en: ['+++'] }), /"forms\.en" "\+\+\+" has no letters or digits/));
  });

  test('lists no form twice, and neither the term itself, its plain plural nor its singular', () => {
    const forms = (value) => withTerm({ id: 'model', zh: ATTENTION, en: 'Model', forms: value }).problems;
    for (const same of ['model', 'MODEL', 'Models', 'mo-del']) {
      assert.ok(has(forms({ en: [same] }), /\(model\): "forms\.en" .* is the term itself, its plain plural/), same);
    }
    assert.ok(has(forms({ zh: [ATTENTION] }), /"forms\.zh" .* is the term itself/));
    // The game takes a word and its plain plural for each other, so the singular of a term that
    // is a plural needs no listing either.
    const acoustics = (value) => withTerm({ id: 'acoustics', en: 'Acoustics', forms: value }).problems;
    assert.ok(has(acoustics({ en: ['acoustic'] }), /"acoustic" is the term itself, its plain plural or its singular/));
    assert.deepEqual(acoustics({ en: ['acoustical'] }), []);
    assert.ok(has(forms({ en: ['modeling', 'modeling'] }), /"modeling" repeats another form$/));
    assert.ok(
      has(
        forms({ en: ['modeling', 'Model-ing'] }),
        /"Model-ing" repeats another form \("modeling"\), which has the same/,
      ),
    );
    for (const [first, second] of [
      ['genetic', 'genetics'],
      ['genetics', 'genetic'],
    ]) {
      assert.ok(
        has(
          forms({ en: [first, second] }),
          new RegExp(`"${second}" repeats another form \\("${first}"\\), which the game takes for the same word`),
        ),
        second,
      );
    }
    // The game puts the forms of both languages together.
    assert.ok(has(forms({ zh: ['CV'], en: ['cv'] }), /"forms\.en" "cv" repeats another form \("CV"\)/));
  });

  test("takes other spellings and plurals of the game's names for those names", () => {
    for (const name of ['Students', 'PIs', 'Chairs', 'Reviewer2', 'Reviewer-2', 'REVIEWER 2', 'Irrelevant papers']) {
      assert.ok(has(withTerm({ id: 'name', en: name }).warnings, /name of a role or card/), name);
    }
    for (const word of ['Chairman', 'Pi\u00f1ata', 'Reviewer', 'Paper', 'Studentship', 'Pie']) {
      assert.deepEqual(withTerm({ id: 'word', en: word }).warnings, [], word);
    }
  });
});

describe('lists together', () => {
  const field = (id, extra) => ({ file: `${id}.json`, data: list({ id, terms: [...terms(MIN_TERMS), ...extra] }) });

  test('may share a word that has the same translation in each', () => {
    const shared = { id: 'attention', zh: ATTENTION, en: 'Attention' };
    assert.deepEqual(checkAcrossLists([field('ml', [shared]), field('nlp', [shared])]), [[], []]);
  });

  test('may not translate the same word differently', () => {
    const [ml, nlp, cv] = checkAcrossLists([
      field('ml', [{ id: 'attention', zh: ATTENTION, en: 'Attention' }]),
      field('nlp', [{ id: 'focus', zh: ATTENTION, en: 'Focus' }]),
      field('cv', [{ id: 'attention', zh: SUPERVISOR, en: 'attention' }]),
    ]);
    assert.deepEqual(ml, []);
    assert.equal(nlp.length, 1);
    assert.match(
      nlp[0],
      /^nlp\.json: terms\[25\] \(focus\): "zh" ".+" is translated "Focus" here but "Attention" in ml\.json/,
    );
    assert.equal(cv.length, 1);
    assert.match(
      cv[0],
      /^cv\.json: terms\[25\] \(attention\): "en" "attention" is translated ".+" here but ".+" in ml\.json/,
    );
  });

  test('needs the translation spelled the same way, since a card would show both spellings', () => {
    const [, second] = checkAcrossLists([
      field('a', [{ id: 'coauthor', zh: ATTENTION, en: 'Coauthor' }]),
      field('b', [{ id: 'coauthor', zh: ATTENTION, en: 'Co-author' }]),
    ]);
    assert.deepEqual(second.length, 1);
    assert.match(second[0], /"zh" ".+" is translated "Co-author" here but "Coauthor" in a\.json/);
  });

  test('leaves a word that one list holds twice to that list, and skips terms in one language', () => {
    const twice = [
      { id: 'attention', zh: ATTENTION, en: 'Attention' },
      { id: 'focus', zh: ATTENTION, en: 'Focus' },
    ];
    assert.deepEqual(checkAcrossLists([field('ml', twice)]), [[]]);
    assert.deepEqual(checkAcrossLists([field('nlp', [twice[0]]), field('ml', twice)]), [[], []]);
    const alone = [field('ml', [twice[0]]), field('nlp', [{ id: 'attention', zh: ATTENTION }])];
    assert.deepEqual(checkAcrossLists(alone), [[], []]);
  });

  test('passes over lists and terms in the wrong shape', () => {
    const broken = [
      { file: 'a.json', data: [] },
      { file: 'b.json', data: { terms: [null, 'x', { zh: ' ', en: 'X' }, { zh: '+', en: '-' }] } },
      { file: 'c.json', data: { terms: [{ zh: '+', en: '!' }] } },
    ];
    assert.deepEqual(checkAcrossLists(broken), [[], [], []]);
  });
});

describe('line numbers', () => {
  test('are found for each term of a list', () => {
    const text = JSON.stringify(list({ terms: terms(3) }), null, 2);
    const starts = text.split('\n').flatMap((line, index) => (line === '    {' ? [index + 1] : []));
    assert.equal(starts.length, 3);
    assert.deepEqual(termLines(text), starts);
    assert.deepEqual(termLines(JSON.stringify(list())), Array(MIN_TERMS).fill(1));
  });

  test('are not thrown off by brackets in strings, nested "terms" or a second "terms"', () => {
    const tricky = [
      '{ "name": "[{\\"terms\\": [", "terms":',
      '[ "a",',
      '  { "terms": [1, 2], "zh": "]," },',
      '',
      '  3 ] }',
    ].join('\n');
    assert.deepEqual(JSON.parse(tricky).terms.length, 3);
    assert.deepEqual(termLines(tricky), [2, 3, 5]);
    assert.deepEqual(termLines('{ "terms": [1],\n"terms": [\n2] }'), [3]);
    assert.deepEqual(termLines('{ "terms": [] }'), []);
  });

  test('go with the term that a problem names, or with the place where the JSON broke', () => {
    assert.equal(lineOf('ml.json: terms[1] (x): "en" "X" repeats terms[0]', [4, 9]), 9);
    assert.equal(lineOf('ml.json: "terms" must be a list', [4, 9]), undefined);
    let message = '';
    try {
      JSON.parse('{\n  "id": "ml"\n  "terms": []\n}');
    } catch (error) {
      message = `ml.json: not valid JSON: ${error.message}`;
    }
    // The versions of Node that the project supports name the line in the message.
    assert.equal(lineOf(message), 3);
  });
});

describe('command line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-words-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  // CI runs these tests on GitHub Actions, where the script writes its lines another way.
  const runWith = (env, ...args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  const run = (...args) => runWith({ GITHUB_ACTIONS: '' }, ...args);
  const good = join(dir, 'ml.json');
  writeFileSync(good, JSON.stringify(list()));
  const bad = join(dir, 'broken.json');
  writeFileSync(bad, '{ not json');

  test('passes good files and fails bad ones', () => {
    const ok = run(good);
    assert.equal(ok.status, 0, ok.stdout);
    assert.match(ok.stdout, /OK ml\.json \(25 zh, 25 en\)/);

    const failed = run(good, bad);
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /broken\.json: not valid JSON/);
  });

  test("reports a file that it can't read as an error, not as a broken list", () => {
    const mistyped = run(join(dir, 'ml.jsn'));
    assert.equal(mistyped.status, 2);
    assert.match(mistyped.stderr, /check-words: error: ENOENT.*ml\.jsn/);
    assert.doesNotMatch(mistyped.stdout, /not valid JSON/);

    const directory = run(dir);
    assert.equal(directory.status, 2);
    assert.match(directory.stderr, /check-words: error: EISDIR/);

    // The other files are still checked, but the run doesn't pass, whatever they hold.
    const mixed = run(join(dir, 'ml.jsn'), good, bad);
    assert.equal(mixed.status, 2);
    assert.match(mixed.stdout, /OK ml\.json/);
    assert.match(mixed.stdout, /broken\.json: not valid JSON/);
    assert.equal(run(join(dir, 'ml.jsn'), good).status, 2);
  });

  test('writes problems and warnings as annotations on GitHub Actions, once each', () => {
    const long = join(dir, 'long.json');
    writeFileSync(
      long,
      JSON.stringify(list({ id: 'long', terms: [...terms(MIN_TERMS), { id: 'x', en: '100% Reproducible' }] })),
    );
    const result = runWith({ GITHUB_ACTIONS: 'true' }, bad, long);
    assert.equal(result.status, 1);
    const lines = result.stdout.split('\n');
    assert.equal(lines.filter((line) => /broken\.json: not valid JSON/.test(line)).length, 1);
    assert.ok(has(lines, /^::error title=check-words::broken\.json: not valid JSON/));
    assert.ok(has(lines, /^::warning title=check-words::long\.json: .*"100%25 Reproducible" is longer than 14/));
    assert.ok(has(lines, /^check-words: OK long\.json/));

    const plain = run(bad, long).stdout.split('\n');
    assert.ok(has(plain, /^check-words: broken\.json: not valid JSON/));
    assert.ok(has(plain, /^check-words: warning: long\.json: .*"100% Reproducible"/));
    assert.ok(!has(plain, /^::/));
  });

  test('attaches an annotation to a file of the repository by its path from the root', () => {
    const inRepository = fileURLToPath(new URL('../words/ml.json', import.meta.url));
    assert.equal(
      annotation('error', 'ml.json: "terms" must be a list', inRepository),
      '::error file=words/ml.json,title=check-words::ml.json: "terms" must be a list',
    );
    assert.equal(
      annotation('error', 'ml.json: terms[3] (x): bad', inRepository, 12),
      '::error file=words/ml.json,line=12,title=check-words::ml.json: terms[3] (x): bad',
    );
    assert.equal(annotation('warning', 'a\nb', join(tmpdir(), 'ml.json')), '::warning title=check-words::a%0Ab');
    assert.equal(annotation('warning', 'a', join(tmpdir(), 'ml.json'), 12), '::warning title=check-words::a');
  });

  test('checks the lists against each other', (t) => {
    const log = t.mock.method(console, 'log', () => {});
    const printed = () => log.mock.calls.map((call) => call.arguments[0]);
    const lists = mkdtempSync(join(tmpdir(), 'check-words-across-'));
    t.after(() => rmSync(lists, { recursive: true, force: true }));
    const write = (id, term) =>
      writeFileSync(join(lists, `${id}.json`), JSON.stringify(list({ id, terms: [...terms(MIN_TERMS), term] })));
    write('ml', { id: 'attention', zh: ATTENTION, en: 'Attention' });
    write('nlp', { id: 'attention', zh: ATTENTION, en: 'Attention' });
    assert.equal(main([], lists), 0);

    log.mock.resetCalls();
    write('nlp', { id: 'focus', zh: ATTENTION, en: 'Focus' });
    assert.equal(main([], lists), 1);
    // Without an anchor, since CI prints the same line as an annotation.
    assert.ok(has(printed(), /nlp\.json: terms\[25\] \(focus\): "zh" .* but "Attention" in ml\.json/));
    assert.ok(has(printed(), /^check-words: OK ml\.json/));
    assert.ok(!has(printed(), /OK nlp\.json/));
    // Only the files named are checked against each other.
    log.mock.resetCalls();
    assert.equal(main([join(lists, 'nlp.json')], lists), 0);
  });

  test("checks the repository's own word lists by default", () => {
    const result = run();
    assert.equal(result.status, 0, result.stdout);
    // Either there are none yet, or each one is listed as passing, perhaps after its warnings.
    assert.match(result.stdout, /^check-words: (no word lists in words\/ yet|OK [a-z0-9-]+\.json \()/m);
  });

  test('checks every JSON file of the directory when no file is named', (t) => {
    const log = t.mock.method(console, 'log', () => {});
    const printed = () => log.mock.calls.map((call) => call.arguments[0]);
    const lists = mkdtempSync(join(tmpdir(), 'check-words-lists-'));
    t.after(() => rmSync(lists, { recursive: true, force: true }));
    writeFileSync(join(lists, 'README.md'), '# Word library');
    assert.equal(main([], lists), 0);
    assert.deepEqual(printed(), ['check-words: no word lists in words/ yet']);

    log.mock.resetCalls();
    writeFileSync(join(lists, 'nlp.json'), JSON.stringify(list({ id: 'nlp' })));
    writeFileSync(join(lists, 'ml.json'), JSON.stringify(list()));
    assert.equal(main([], lists), 0);
    assert.deepEqual(printed(), ['check-words: OK ml.json (25 zh, 25 en)', 'check-words: OK nlp.json (25 zh, 25 en)']);

    log.mock.resetCalls();
    writeFileSync(join(lists, 'cv.json'), JSON.stringify(list()));
    assert.equal(main([], lists), 1);
    assert.ok(has(printed(), /cv\.json: "id" must be "cv"/));
    assert.ok(has(printed(), /1 problem\(s\)/));
  });

  test("exits with 2 when it can't read the directory of the word lists", (t) => {
    const error = t.mock.method(console, 'error', () => {});
    assert.equal(main([], join(dir, 'missing')), 2);
    assert.match(error.mock.calls[0].arguments[0], /^check-words: error: ENOENT/);
  });
});

import { describe, expect, test, vi } from 'vitest';
import {
  cardsClash,
  checkClue,
  cleanClue,
  MAX_CLUE_INPUT,
  normalizeClue,
  wordKey,
  type BoardText,
  type ClueOptions,
} from './clue';

// The fixtures that stand for Chinese words are written as \u escapes, because everything in
// the repository is in English (docs/rules/language.md). So are invisible characters and
// combining marks, which would be hard to see.
const ATTENTION = '\u6ce8\u610f\u529b'; // "attention"
const NOTICE = '\u6ce8\u610f'; // the first two characters of ATTENTION
const FORCE = '\u529b'; // its last character
const REVIEWER = '\u5ba1\u7a3f\u4eba'; // "reviewer"
const REVIEWER_TRADITIONAL = '\u5be9\u7a3f\u4eba'; // the same word in traditional characters
const MANUSCRIPT = '\u7a3f\u4ef6'; // "manuscript": shares a character with REVIEWER, but neither contains the other
const SPEED_UP = '\u52a0\u901f'; // "speed up"
const DATA = '\u6570\u636e'; // "data"
const DATA_SCIENCE_TRADITIONAL = '\u6578\u64da\u79d1\u5b78'; // "data science" in traditional characters
const JOURNAL = '\u671f\u520a'; // "journal"
const PEER_REVIEW = '\u540c\u884c\u8bc4\u5ba1'; // "peer review"
const NUMBER = '\u6570\u5b57'; // "number": shares its first character with DATA
const NUMBER_TRADITIONAL = '\u6578\u5b57'; // the same word in traditional characters
const DATASET = '\u6570\u636e\u96c6'; // "dataset"
const SAMPLE = '\u6837\u672c'; // "sample": shares no character with DATA

const SOFT_HYPHEN = '\u00ad';
const ZERO_WIDTH_SPACE = '\u200b';
const GRAPHEME_JOINER = '\u034f';
const VARIATION_SELECTOR = '\ufe0f';
const HANGUL_FILLER = '\u3164'; // a letter that shows nothing
const ACUTE = '\u0301'; // a combining accent
const DOT_BELOW = '\u0323';
const CURLY_APOSTROPHE = '\u2019';

const board = (...words: string[]) => words.map((word) => ({ word, revealed: false }));
const problemOf = (clue: string, words: string[]) => checkClue(clue, board(...words)).problem;
const similarTo = (clue: string, words: string[]) => checkClue(clue, board(...words)).similar.map(({ card }) => card);

const LOOSE: ClueOptions = { words: 1, han: 10, strict: false };

describe('the forms of a clue', () => {
  test('normalizeClue folds width and case, trims, and drops invisible characters', () => {
    expect(normalizeClue('  \uff2d\uff4f\uff44\uff45\uff4c ')).toBe('model');
    expect(normalizeClue('Self-Attention')).toBe('self-attention');
    expect(normalizeClue(`Re${SOFT_HYPHEN}view${ZERO_WIDTH_SPACE}er`)).toBe('reviewer');
    expect(normalizeClue('Re\u00adview\u00ader')).toBe('reviewer');
  });

  test('cleanClue keeps what the captain typed, without invisible characters and stray spaces', () => {
    expect(cleanClue('  Self-Attention ')).toBe('Self-Attention');
    expect(cleanClue(' R\u00b2 ')).toBe('R\u00b2');
    expect(cleanClue('\uff27\uff30\uff35')).toBe('\uff27\uff30\uff35');
    expect(cleanClue(`Gra${SOFT_HYPHEN}di${GRAPHEME_JOINER}ent${VARIATION_SELECTOR}`)).toBe('Gradient');
    expect(cleanClue(` ${HANGUL_FILLER} `)).toBe('');
  });

  test('wordKey also drops accents and turns traditional characters into simplified ones', () => {
    expect(wordKey('Na\u00efve')).toBe('naive');
    expect(wordKey(`Cafe${ACUTE}`)).toBe('cafe');
    expect(wordKey(REVIEWER_TRADITIONAL)).toBe(REVIEWER);
    expect(wordKey(REVIEWER)).toBe(REVIEWER);
  });

  test('wordKey keeps only letters and digits', () => {
    for (const spelling of ['Co-author', 'co author', 'COAUTHOR', ' Co\u2013Author ', "co'author."]) {
      expect(wordKey(spelling), spelling).toBe('coauthor');
    }
    expect(wordKey('COVID-19')).toBe('covid19');
    expect(wordKey(`GPU ${SPEED_UP}`)).toBe(`gpu${SPEED_UP}`);
  });
});

describe('a clue must be one word', () => {
  test('refuses empty clues, also when they only look empty', () => {
    expect(problemOf('', [])).toBe('clue_empty');
    // Whatever a player sends instead of a text is no clue either.
    for (const clue of [42, null, undefined, ['model'], {}]) {
      expect(problemOf(clue as unknown as string, ['Model']), JSON.stringify(clue)).toBe('clue_empty');
    }
    expect(problemOf('   ', [])).toBe('clue_empty');
    expect(problemOf(HANGUL_FILLER, [])).toBe('clue_empty');
    expect(problemOf(`${GRAPHEME_JOINER}${VARIATION_SELECTOR}`, [])).toBe('clue_empty');
  });

  test('refuses spaces and punctuation, but allows hyphens, apostrophes and digits', () => {
    expect(problemOf('peer review', [])).toBe('clue_not_one_word');
    expect(problemOf('review!', [])).toBe('clue_not_one_word');
    expect(problemOf('a,b', [])).toBe('clue_not_one_word');
    expect(problemOf('self-attention', [])).toBeNull();
    expect(problemOf("Bayes'", [])).toBeNull();
    expect(problemOf(`Bayes${CURLY_APOSTROPHE}`, [])).toBeNull();
    expect(problemOf('covid19', [])).toBeNull();
    expect(problemOf('42', [])).toBeNull();
    expect(problemOf(SPEED_UP, [])).toBeNull();
    expect(problemOf(`GPU${SPEED_UP}`, [])).toBeNull();
  });

  test('needs a letter or a digit', () => {
    for (const clue of ['-', '--', "'", CURLY_APOSTROPHE, "-'-", ACUTE, `-${ACUTE}`]) {
      expect(problemOf(clue, []), JSON.stringify(clue)).toBe('clue_not_one_word');
    }
    expect(problemOf('-omics', [])).toBeNull();
  });

  test('allows accents, but not a pile of them on one letter', () => {
    expect(problemOf('na\u00efve', [])).toBeNull();
    expect(problemOf(`cafe${ACUTE}`, [])).toBeNull();
    expect(problemOf(`e${DOT_BELOW}${ACUTE}`, [])).toBeNull();
    expect(problemOf(`x${ACUTE.repeat(3)}`, [])).toBe('clue_not_one_word');
    // 24 characters, so only the pile itself is wrong.
    expect(problemOf(`\u0110${ACUTE.repeat(23)}`, [])).toBe('clue_not_one_word');
  });

  test('refuses long clues: 24 characters, or 10 when the clue has Chinese characters', () => {
    expect(problemOf('a'.repeat(24), [])).toBeNull();
    expect(problemOf('a'.repeat(25), [])).toBe('clue_too_long');
    expect(problemOf(SPEED_UP.repeat(5), [])).toBeNull();
    expect(problemOf(`${SPEED_UP.repeat(5)}x`, [])).toBe('clue_too_long');
  });

  test('refuses a very long text without normalizing it', () => {
    // Combining marks in the wrong order make normalizing slow, so nobody may make the server
    // normalize as much text as they like.
    const normalize = vi.spyOn(String.prototype, 'normalize');
    try {
      expect(problemOf(`a${ACUTE.repeat(4000)}${DOT_BELOW.repeat(4000)}`, ['Model'])).toBe('clue_too_long');
      expect(problemOf(' '.repeat(MAX_CLUE_INPUT + 1), [])).toBe('clue_too_long');
      expect(normalize).not.toHaveBeenCalled();
    } finally {
      normalize.mockRestore();
    }
    expect(problemOf(`${' '.repeat(MAX_CLUE_INPUT - 5)}model`, [])).toBeNull();
  });
});

describe('a clue must not repeat a word on the board', () => {
  test('refuses the same word in any case or width', () => {
    expect(checkClue('Model', board('Baseline', 'MODEL'))).toEqual({
      problem: 'clue_on_board',
      conflict: { card: 1, text: 'MODEL', kind: 'same' },
      similar: [],
    });
    expect(problemOf('\uff4d\uff4f\uff44\uff45\uff4c', ['Model'])).toBe('clue_on_board');
  });

  test('refuses the same word with or without accents', () => {
    expect(problemOf('godel', ['G\u00f6del'])).toBe('clue_on_board');
    expect(problemOf('na\u00efve', ['Naive Bayes'])).toBe('clue_on_board');
  });

  test('refuses a word with invisible characters inside it', () => {
    for (const invisible of [GRAPHEME_JOINER, VARIATION_SELECTOR, HANGUL_FILLER, SOFT_HYPHEN, ZERO_WIDTH_SPACE]) {
      const name = `U+${invisible.codePointAt(0)?.toString(16)}`;
      expect(problemOf(`Mo${invisible}del`, ['Model']), name).toBe('clue_on_board');
    }
  });

  test('refuses a part of the word, split at spaces, hyphens and apostrophes', () => {
    expect(problemOf('review', ['Peer review'])).toBe('clue_on_board');
    expect(problemOf('self-attention', ['Attention'])).toBe('clue_on_board');
    expect(problemOf('attention', ['Self-attention'])).toBe('clue_on_board');
    expect(problemOf('master', ["Master's"])).toBe('clue_on_board');
    expect(problemOf('master', [`Master${CURLY_APOSTROPHE}s`])).toBe('clue_on_board');
    expect(problemOf('GPU' + SPEED_UP, ['GPU'])).toBe('clue_on_board');
  });

  test('refuses the word spelled with other hyphens or spaces', () => {
    expect(problemOf('co-author', ['Coauthor'])).toBe('clue_on_board');
    expect(problemOf('co-authors', ['Coauthor'])).toBe('clue_on_board');
    expect(problemOf('coauthor', ['Co-author'])).toBe('clue_on_board');
    expect(problemOf('pre-print', ['Preprint'])).toBe('clue_on_board');
    expect(problemOf('jetlag', ['Jet lag'])).toBe('clue_on_board');
    expect(problemOf('masters', ["Master's"])).toBe('clue_on_board');
  });

  test('refuses the word spelled with other punctuation', () => {
    expect(problemOf('phd', ['Ph.D.'])).toBe('clue_on_board');
    expect(problemOf('qa', ['Q&A'])).toBe('clue_on_board');
    expect(problemOf('io', ['I/O'])).toBe('clue_on_board');
    expect(problemOf('unet', ['U\u2013Net'])).toBe('clue_on_board'); // an en dash
    expect(problemOf('ios', ['I/O'])).toBe('clue_on_board');
  });

  test('refuses the word with digits next to it', () => {
    expect(problemOf('model2', ['Model'])).toBe('clue_on_board');
    expect(problemOf('2model', ['Model'])).toBe('clue_on_board');
    expect(problemOf('gpt', ['GPT4'])).toBe('clue_on_board');
    expect(problemOf('gpt', ['GPT-4'])).toBe('clue_on_board');
    expect(problemOf('covid19', ['COVID-19'])).toBe('clue_on_board');
    // Digits alone are not a part of a word.
    expect(problemOf('19', ['COVID-19'])).toBeNull();
    expect(problemOf('gpt4', ['Llama 4'])).toBeNull();
  });

  test('does not take one letter for a part of a word', () => {
    expect(problemOf("Occam's", ["Master's"])).toBeNull();
    expect(problemOf("Bachelor's", ["Master's"])).toBeNull();
    expect(problemOf('US', ['U-Net'])).toBeNull();
    expect(problemOf("can't", ['T-test'])).toBeNull();
    expect(problemOf('p', ['P-value'])).toBeNull();
    // The rest of such a word still counts, and so does a word of one letter.
    expect(problemOf('net', ['U-Net'])).toBe('clue_on_board');
    expect(problemOf('unet', ['U-Net'])).toBe('clue_on_board');
    expect(problemOf('x', ['X'])).toBe('clue_on_board');
  });

  test('does not take the small words inside a compound for parts of it', () => {
    expect(problemOf('state-of-the-art', ['Out-of-distribution'])).toBeNull();
    expect(problemOf('state-of-the-art', ['Bag of words'])).toBeNull();
    expect(problemOf('end-to-end', ['Text-to-image'])).toBeNull();
    expect(problemOf('in-context', ['Human-in-the-loop'])).toBeNull();
    expect(problemOf('plug-and-play', ['Trial and error'])).toBeNull();
    // The words that carry the compound still count, and so does the compound itself.
    expect(problemOf('bag', ['Bag of words'])).toBe('clue_on_board');
    expect(problemOf('out-of-order', ['Out-of-distribution'])).toBe('clue_on_board');
    expect(problemOf('bagofwords', ['Bag of words'])).toBe('clue_on_board');
    expect(problemOf('the', ['The'])).toBe('clue_on_board');
  });

  test('refuses plain plurals both ways', () => {
    expect(problemOf('models', ['Model'])).toBe('clue_on_board');
    expect(problemOf('model', ['Models'])).toBe('clue_on_board');
    expect(problemOf('biases', ['Bias'])).toBe('clue_on_board');
    expect(problemOf('classes', ['Class'])).toBe('clue_on_board');
    expect(problemOf('boxes', ['Box'])).toBe('clue_on_board');
    expect(problemOf('batch', ['Batches'])).toBe('clue_on_board');
  });

  test('takes -es for a plural only after s, x, z, ch and sh', () => {
    for (const [clue, word] of [
      ['grades', 'Grad'],
      ['rates', 'Rat'],
      ['planes', 'Plan'],
      ['notes', 'Not'],
      ['slid', 'Slides'],
    ] as const) {
      expect(checkClue(clue, board(word)), clue).toEqual({
        problem: null,
        conflict: null,
        similar: [{ card: 0, text: word, kind: 'similar' }],
      });
    }
  });

  test('refuses Chinese words that contain each other', () => {
    expect(problemOf(NOTICE, [ATTENTION])).toBe('clue_on_board');
    expect(problemOf(FORCE, [ATTENTION])).toBe('clue_on_board');
    expect(problemOf(ATTENTION, [NOTICE])).toBe('clue_on_board');
    expect(problemOf(`${DATA}2`, [DATA])).toBe('clue_on_board');
    // A character in common is something else: see the strict rule below.
    expect(checkClue(MANUSCRIPT, board(REVIEWER), LOOSE).problem).toBeNull();
  });

  test('refuses the traditional spelling of a Chinese word', () => {
    expect(problemOf(REVIEWER_TRADITIONAL, [REVIEWER])).toBe('clue_on_board');
    expect(problemOf(REVIEWER, [REVIEWER_TRADITIONAL])).toBe('clue_on_board');
    expect(problemOf(DATA_SCIENCE_TRADITIONAL, [DATA])).toBe('clue_on_board');
  });

  test('does not look for Latin words inside other words', () => {
    expect(problemOf('email', ['AI'])).toBeNull();
    expect(problemOf('ai', ['Email'])).toBeNull();
    expect(problemOf('mode', ['Model'])).toBeNull();
  });

  test('ignores revealed cards', () => {
    expect(checkClue('model', [{ word: 'Model', revealed: true }]).problem).toBeNull();
    expect(checkClue('journal', [{ word: JOURNAL, revealed: true, translations: ['Journal'] }]).problem).toBeNull();
  });
});

describe("a clue must not be a card's word in another language", () => {
  const card = (word: string, ...translations: string[]) => [{ word, revealed: false, translations }];

  test('refuses the translation and its plain plural, and names the translation', () => {
    expect(checkClue('journal', card(JOURNAL, 'Journal'))).toEqual({
      problem: 'clue_on_board',
      conflict: { card: 0, text: 'Journal', kind: 'same' },
      similar: [],
    });
    expect(checkClue('Journals', card(JOURNAL, 'Journal')).problem).toBe('clue_on_board');
    expect(checkClue('peer-review', card(PEER_REVIEW, 'Peer review')).problem).toBe('clue_on_board');
    expect(checkClue(ATTENTION, card('Attention', ATTENTION)).problem).toBe('clue_on_board');
  });

  test('only warns about a part or a form of the translation, and names the translation', () => {
    const warned = (text: string) => ({ problem: null, conflict: null, similar: [{ card: 0, text, kind: 'similar' }] });
    expect(checkClue('review', card(PEER_REVIEW, 'Peer review'))).toEqual(warned('Peer review'));
    expect(checkClue('reviewing', card(PEER_REVIEW, 'Peer review'))).toEqual(warned('Peer review'));
    expect(checkClue(NOTICE, card('Attention', ATTENTION))).toEqual(warned(ATTENTION));
    expect(checkClue('gradient', card(JOURNAL, 'Journal')).similar).toEqual([]);
  });

  test("names the card's own word when the clue may be a form of both", () => {
    expect(checkClue('modeling', [{ word: 'Model', revealed: false, translations: ['Modell'] }]).similar).toEqual([
      { card: 0, text: 'Model', kind: 'similar' },
    ]);
  });
});

describe('a clue that may be a form of a word on the board', () => {
  test('is allowed with a warning that names the card', () => {
    expect(checkClue('modeling', board('Baseline', 'Model'))).toEqual({
      problem: null,
      conflict: null,
      similar: [{ card: 1, text: 'Model', kind: 'similar' }],
    });
    expect(similarTo('modelling', ['Model'])).toEqual([0]);
    expect(similarTo('biased', ['Bias'])).toEqual([0]);
    expect(similarTo('studies', ['Study'])).toEqual([0]);
    expect(similarTo('making', ['Make'])).toEqual([0]);
    expect(similarTo('reviewers', ['Peer review'])).toEqual([0]);
    expect(similarTo('co-authoring', ['Coauthor'])).toEqual([0]);
    expect(similarTo('used', ['Use'])).toEqual([0]);
    expect(similarTo('user', ['Use'])).toEqual([0]);
  });

  test('knows the verbs in -ate behind nouns in -ation', () => {
    expect(similarTo('simulate', ['Simulation'])).toEqual([0]);
    expect(similarTo('simulated', ['Simulation'])).toEqual([0]);
    expect(similarTo('simulator', ['Simulation'])).toEqual([0]);
    expect(similarTo('annotation', ['Annotate'])).toEqual([0]);
    expect(similarTo('cite', ['Citation'])).toEqual([0]);
  });

  test('knows Latin, Greek and irregular plurals', () => {
    for (const [clue, word] of [
      ['hypotheses', 'Hypothesis'],
      ['theses', 'Thesis'],
      ['appendices', 'Appendix'],
      ['indices', 'H-index'],
      ['spectra', 'Spectrum'],
      ['criteria', 'Criterion'],
      ['stimuli', 'Stimulus'],
      ['formulae', 'Formula'],
      ['mice', 'Mouse'],
      ['mouse', 'Mice'],
      ['axes', 'Axis'],
      ['corpora', 'Corpus'],
      ['genera', 'Genus'],
      ['schemata', 'Schema'],
      ['leaves', 'Leaf'],
      ['lives', 'Life'],
    ] as const) {
      expect(checkClue(clue, board(word)), clue).toEqual({
        problem: null,
        conflict: null,
        similar: [{ card: 0, text: word, kind: 'similar' }],
      });
    }
  });

  test('brings no warning for unrelated words', () => {
    expect(similarTo('gradient', ['Grant', 'Graduate', 'Model'])).toEqual([]);
    expect(similarTo('ai', ['Aim'])).toEqual([]);
    expect(similarTo('data', ['Date'])).toEqual([]);
    expect(similarTo('beta', ['Bet'])).toEqual([]);
  });
});

describe('a clue of several words', () => {
  const TWO: ClueOptions = { words: 2, han: 10, strict: true };
  const THREE: ClueOptions = { words: 3, han: 10, strict: true };

  test('is allowed up to the number of words that the room takes', () => {
    expect(checkClue('peer review', [], TWO).problem).toBeNull();
    expect(checkClue('peer review', []).problem).toBe('clue_not_one_word');
    expect(checkClue('one two three', [], TWO).problem).toBe('clue_too_many_words');
    expect(checkClue('one two three', [], THREE).problem).toBeNull();
    expect(checkClue('one two three four', [], THREE).problem).toBe('clue_too_many_words');
  });

  test('has one plain space between its words, however they were typed', () => {
    expect(checkClue('  peer \u00a0  review ', [], TWO).problem).toBeNull();
    expect(cleanClue('  peer \u00a0  review ')).toBe('peer review');
    expect(cleanClue(`peer${ZERO_WIDTH_SPACE} review`)).toBe('peer review');
  });

  test('checks the characters and the length of every word', () => {
    expect(checkClue('peer review!', [], TWO).problem).toBe('clue_not_one_word');
    expect(checkClue('peer -', [], TWO).problem).toBe('clue_not_one_word');
    expect(checkClue(`${'a'.repeat(24)} ${'b'.repeat(24)}`, [], TWO).problem).toBeNull();
    expect(checkClue(`${'a'.repeat(25)} b`, [], TWO).problem).toBe('clue_too_long');
  });

  test('holds every word against the board as if it were the clue', () => {
    expect(checkClue('deep models', board('Model'), TWO).conflict).toEqual({ card: 0, text: 'Model', kind: 'same' });
    expect(checkClue('deep jetlag', board('Jet lag'), TWO).problem).toBe('clue_on_board');
    expect(checkClue('deep modeling', board('Model'), TWO).similar).toEqual([
      { card: 0, text: 'Model', kind: 'similar' },
    ]);
    // The words together are a clue too: "machine learning" is the card's word.
    expect(checkClue('machine learning', board('Machinelearning'), TWO).problem).toBe('clue_on_board');
  });
});

describe('the number of Chinese characters', () => {
  test('is at most what the room allows', () => {
    const four: ClueOptions = { words: 1, han: 4, strict: true };
    expect(checkClue(NOTICE.repeat(2), [], four).problem).toBeNull();
    expect(checkClue(`${NOTICE.repeat(2)}${FORCE}`, [], four).problem).toBe('clue_too_long');
    expect(checkClue(`GPU${SPEED_UP}`, [], { ...four, han: 2 }).problem).toBeNull();
    expect(checkClue(`GPU${SPEED_UP}`, [], { ...four, han: 1 }).problem).toBe('clue_too_long');
    // Latin letters don't count against it, but a clue with Chinese characters is still at most
    // 10 characters long.
    expect(checkClue('abcdefghi', [], { ...four, han: 1 }).problem).toBeNull();
    expect(checkClue(`abcdefghi${FORCE}x`, [], { ...four, han: 1 }).problem).toBe('clue_too_long');
  });
});

describe('the strict and the loose clue rules', () => {
  const card = (word: string, more: { translations?: string[]; forms?: string[] } = {}) => ({
    word,
    revealed: false,
    ...more,
  });
  const strict = (clue: string, cards: ReturnType<typeof card>[], words = 1) =>
    checkClue(clue, cards, { words, han: 10, strict: true });
  const loose = (clue: string, cards: ReturnType<typeof card>[], words = 1) =>
    checkClue(clue, cards, { words, han: 10, strict: false });

  test('a form that the word library lists is refused under the strict rule and a warning under the loose one', () => {
    const data = [card('Data', { forms: ['dataset', 'database', DATASET] })];
    expect(strict('dataset', data)).toEqual({
      problem: 'clue_on_board',
      conflict: { card: 0, text: 'dataset', kind: 'form' },
      similar: [],
    });
    expect(loose('dataset', data)).toEqual({
      problem: null,
      conflict: null,
      similar: [{ card: 0, text: 'dataset', kind: 'form' }],
    });
    // Its plain plural, another spelling of it, and a form in the other language count as well.
    expect(strict('Datasets', data).conflict).toEqual({ card: 0, text: 'dataset', kind: 'form' });
    expect(strict('DataBase', data).conflict).toEqual({ card: 0, text: 'database', kind: 'form' });
    expect(strict(DATASET, data).conflict).toEqual({ card: 0, text: DATASET, kind: 'form' });
    // A form of a revealed card doesn't count, and neither does a word that only looks like one.
    expect(strict('dataset', [{ ...card('Data', { forms: ['dataset'] }), revealed: true }]).problem).toBeNull();
    expect(strict('datum', data).problem).toBeNull();
  });

  test('a form may be a word of the clue, or the clue as a whole', () => {
    const cv = [card('CV', { forms: ['Computer vision'] })];
    expect(strict('computer vision', cv, 2).conflict).toEqual({ card: 0, text: 'Computer vision', kind: 'form' });
    expect(strict('computervision', cv).conflict).toEqual({ card: 0, text: 'Computer vision', kind: 'form' });
    const data = [card('Data', { forms: ['dataset'] })];
    expect(strict('big dataset', data, 2).conflict).toEqual({ card: 0, text: 'dataset', kind: 'form' });
  });

  test('a clue repeats a form as it would repeat the word on the board', () => {
    // By a part of the clue: the form is a part of a hyphenated compound.
    const data = [card('Data', { forms: ['dataset', DATASET] })];
    expect(strict('dataset-scale', data).conflict).toEqual({ card: 0, text: 'dataset', kind: 'form' });
    expect(loose('dataset-scale', data).similar).toEqual([{ card: 0, text: 'dataset', kind: 'form' }]);
    // By a part of the form, or a plain plural of one: a form of several words gives the term
    // away word by word, and a room that takes one word could never see it whole.
    const cv = [card('CV', { forms: ['Computer vision'] })];
    expect(strict('vision', cv).conflict).toEqual({ card: 0, text: 'Computer vision', kind: 'form' });
    expect(strict('computers', cv).conflict).toEqual({ card: 0, text: 'Computer vision', kind: 'form' });
    expect(loose('vision', cv).similar).toEqual([{ card: 0, text: 'Computer vision', kind: 'form' }]);
    // By a run of Chinese characters inside a form.
    expect(strict(DATA, data).conflict).toEqual({ card: 0, text: DATASET, kind: 'form' });
    // The small words of a form are no part of it, and a Latin form is not looked for inside
    // other words: a clue that only contains one gets the warning that the word brings, if any.
    const sota = [card('SOTA', { forms: ['state of the art'] })];
    expect(strict('of', sota)).toEqual({ problem: null, conflict: null, similar: [] });
    expect(strict('artwork', sota)).toEqual({ problem: null, conflict: null, similar: [] });
    expect(strict('bigdataset', data)).toEqual({
      problem: null,
      conflict: null,
      similar: [{ card: 0, text: 'Data', kind: 'inside' }],
    });
  });

  test('a Chinese character in common with a word on the board is refused under the strict rule only', () => {
    expect(strict(NUMBER, [card(SAMPLE), card(DATA)])).toEqual({
      problem: 'clue_on_board',
      conflict: { card: 1, text: DATA, kind: 'character' },
      similar: [],
    });
    expect(strict(NUMBER_TRADITIONAL, [card(DATA)]).conflict).toEqual({ card: 0, text: DATA, kind: 'character' });
    expect(loose(NUMBER, [card(SAMPLE), card(DATA)])).toEqual({
      problem: null,
      conflict: null,
      similar: [{ card: 1, text: DATA, kind: 'character' }],
    });
    expect(strict(MANUSCRIPT, [card(REVIEWER)]).conflict).toEqual({ card: 0, text: REVIEWER, kind: 'character' });
    expect(strict(SAMPLE, [card(DATA)]).problem).toBeNull();
  });

  test("a Chinese character in common with a card's translation is only a warning", () => {
    expect(strict(NUMBER, [card('Data', { translations: [DATA] })])).toEqual({
      problem: null,
      conflict: null,
      similar: [{ card: 0, text: DATA, kind: 'character' }],
    });
  });

  test('a word on the board, or a part of one, of four letters or more inside the clue is a warning', () => {
    for (const check of [strict, loose]) {
      expect(check('datacenter', [card('Data')]).similar).toEqual([{ card: 0, text: 'Data', kind: 'inside' }]);
      expect(check('metadata', [card('Big data')]).similar).toEqual([{ card: 0, text: 'Big data', kind: 'inside' }]);
      expect(check('datacenter', [card(DATA, { translations: ['Data'] })]).similar).toEqual([
        { card: 0, text: 'Data', kind: 'inside' },
      ]);
    }
    // A clue of several words contains what runs across its words as well.
    expect(checkClue('big data center', [card('Datacenter')], { words: 3, han: 10, strict: true }).similar).toEqual([
      { card: 0, text: 'Datacenter', kind: 'inside' },
    ]);
    // Shorter words are left alone, and so are clues inside a word.
    expect(strict('email', [card('AI')]).similar).toEqual([]);
    expect(strict('datum', [card('Dat')]).similar).toEqual([]);
    expect(strict('data', [card('Datacenter')]).similar).toEqual([]);
  });

  test('what the endings suggest stays a warning under both rules', () => {
    expect(strict('modeling', [card('Model')]).similar).toEqual([{ card: 0, text: 'Model', kind: 'similar' }]);
    expect(loose('modeling', [card('Model')]).similar).toEqual([{ card: 0, text: 'Model', kind: 'similar' }]);
  });

  test('the loose rule still refuses what the rules always refuse', () => {
    expect(loose('models', [card('Model')]).conflict).toEqual({ card: 0, text: 'Model', kind: 'same' });
    expect(loose('journal', [card(JOURNAL, { translations: ['Journal'] })]).conflict).toEqual({
      card: 0,
      text: 'Journal',
      kind: 'same',
    });
    expect(loose(NOTICE, [card(ATTENTION)]).conflict).toEqual({ card: 0, text: ATTENTION, kind: 'same' });
  });

  test('names a conflict that every rule refuses before one that only the strict rule does', () => {
    const cards = [card('Data', { forms: ['dataset'] }), card('Dataset')];
    expect(strict('dataset', cards).conflict).toEqual({ card: 1, text: 'Dataset', kind: 'same' });
  });

  test('gives each card one warning, the strongest', () => {
    const cards = [card('Data', { forms: ['datacenter'] }), card('Model')];
    expect(loose('datacenter', cards).similar).toEqual([{ card: 0, text: 'datacenter', kind: 'form' }]);
  });
});

describe('words that clash on a board', () => {
  const GENE = '\u57fa\u56e0'; // "gene"
  const GENE_EDITING = '\u57fa\u56e0\u7f16\u8f91'; // "gene editing"
  const FOSSIL = '\u5316\u77f3'; // "fossil"
  const LIVING_FOSSIL = '\u6d3b\u5316\u77f3'; // "living fossil"
  const MATH = '\u6570\u5b66'; // "mathematics"
  const CHEMISTRY = '\u5316\u5b66'; // "chemistry": shares a character with MATH
  const GPU_ZH = '\u56fe\u5f62\u5904\u7406\u5668'; // "graphics processing unit"
  const PROCESSOR = '\u5904\u7406\u5668'; // "processor": the end of GPU_ZH
  const ELECTRICITY = '\u7535'; // "electricity", one character
  const ELECTRIC_FIELD = '\u7535\u573a'; // "electric field"
  const SQUARE = '\u5e73\u65b9'; // "square", as in "R squared" and "square root"
  const LINE = '\u7ebf'; // "line", as in "candlestick chart" ("K" and LINE) and "curve"

  // Fresh objects each time, so that nothing is remembered from one call to the next.
  const clash = (a: string | BoardText, b: string | BoardText) => {
    const card = (word: string | BoardText): BoardText => (typeof word === 'string' ? { word } : { ...word });
    const one = cardsClash(card(a), card(b));
    expect(cardsClash(card(b), card(a)), 'the other way around').toBe(one);
    return one;
  };

  test('when one contains the other as a whole word or a part', () => {
    expect(clash('Gene', 'Gene editing')).toBe(true);
    expect(clash('Neuron', 'Mirror neuron')).toBe(true);
    expect(clash('DNA', 'Junk DNA')).toBe(true);
    expect(clash('Attention', 'Self-attention')).toBe(true);
    expect(clash('Review', 'Peer review')).toBe(true);
    expect(clash('Gene editing', 'Gene editing tool')).toBe(true);
    // Two spellings of one word.
    expect(clash('Co-author', 'coauthor')).toBe(true);
    // A letter alone and digits count as pieces of the word that holds them.
    expect(clash('Test', 't-test')).toBe(true);
    expect(clash('Ray', 'X-ray')).toBe(true);
    expect(clash('3D', '3D printing')).toBe(true);
    expect(clash("Master's", "Master's degree")).toBe(true);
    expect(clash(SQUARE, `R${SQUARE}`)).toBe(true);
  });

  test('when one is a plain plural of the other or of its part', () => {
    expect(clash('Model', 'Models')).toBe(true);
    expect(clash('Model', 'Mixture models')).toBe(true);
    expect(clash('Matrix', 'Matrixes')).toBe(true);
  });

  test('when a run of Chinese characters contains the other', () => {
    expect(clash(GENE, GENE_EDITING)).toBe(true);
    expect(clash(FOSSIL, LIVING_FOSSIL)).toBe(true);
    expect(clash(GENE_EDITING, `GPU ${GENE_EDITING}`)).toBe(true);
    // One character inside a word is enough.
    expect(clash(ELECTRICITY, ELECTRIC_FIELD)).toBe(true);
    // Traditional and simplified characters are the same.
    expect(clash(REVIEWER_TRADITIONAL, `${REVIEWER}2`)).toBe(true);
  });

  test("when one repeats the other's form, in either language", () => {
    const gpu = { word: 'GPU', forms: ['graphics processing unit', GPU_ZH] };
    expect(clash('Unit', gpu)).toBe(true);
    expect(clash('Processing unit', gpu)).toBe(true);
    expect(clash(PROCESSOR, gpu)).toBe(true);
    expect(clash({ word: 'Data', forms: ['dataset'] }, 'Dataset')).toBe(true);
    expect(clash('Unit', 'GPU')).toBe(false);
  });

  test("when one is the other's term in another language", () => {
    expect(clash('Transformer', { word: '\u53d8\u6362\u5668', translations: ['Transformer'] })).toBe(true);
    expect(clash('Transformers', { word: '\u53d8\u6362\u5668', translations: ['Transformer'] })).toBe(true);
  });

  test('not for a part or a Chinese character in common, or for what only brings a warning', () => {
    // Neither lies inside the other.
    expect(clash('Data science', 'Data cleaning')).toBe(false);
    expect(clash('Test set', 'Training set')).toBe(false);
    expect(clash('Learning rate', 'Win rate')).toBe(false);
    expect(clash(`GPU ${GENE}`, GENE_EDITING)).toBe(false);
    // A letter alone or digits tell the words apart, even an "a".
    expect(clash('t-test', 'Turing test')).toBe(false);
    expect(clash('t-test', 'A/B test')).toBe(false);
    expect(clash('X-ray', 'Gamma ray')).toBe(false);
    expect(clash('Series A', 'Time series')).toBe(false);
    expect(clash('Vitamin C', 'Vitamin D')).toBe(false);
    expect(clash('GPT-3', 'GPT-4')).toBe(false);
    expect(clash('Type I error', 'Type II error')).toBe(false);
    expect(clash(`R${SQUARE}`, `${SQUARE}\u6839`)).toBe(false);
    expect(clash(`K${LINE}`, `\u66f2${LINE}`)).toBe(false);
    expect(clash('Graphics processing unit cluster', { word: 'GPU', forms: ['graphics processing unit'] })).toBe(false);
    // A part in common through a form, or between forms, is no clash either.
    const rlhf = { word: 'RLHF', forms: ['reinforcement learning from human feedback'] };
    expect(clash('Digital human', rlhf)).toBe(false);
    expect(clash({ word: 'Data', forms: ['dataset'] }, { word: 'Set', forms: ['dataset'] })).toBe(false);
    expect(clash(MATH, CHEMISTRY)).toBe(false);
    expect(clash(REVIEWER, MANUSCRIPT)).toBe(false);
    expect(clash(DATA, NUMBER)).toBe(false);
    // Another ending, a word inside another, a translation's part, and a small word.
    expect(clash('Model', 'Modeling')).toBe(false);
    expect(clash('Data', 'Datacenter')).toBe(false);
    expect(clash('AI', 'Email')).toBe(false);
    expect(clash('Attention', { word: '\u6ce8\u610f\u529b\u673a\u5236', translations: ['Attention mechanism'] })).toBe(
      false,
    );
    expect(clash('State of the art', 'Out of distribution')).toBe(false);
    expect(clash("Occam's razor", "Master's")).toBe(false);
    expect(clash('Gene', 'Genome')).toBe(false);
  });

  test('gives the same answer again for cards that it has seen', () => {
    const gene = { word: 'Gene' };
    const editing = { word: 'Gene editing' };
    const pool = { word: 'Pool' };
    expect(cardsClash(gene, editing)).toBe(true);
    expect(cardsClash(editing, gene)).toBe(true);
    expect(cardsClash(gene, pool)).toBe(false);
    expect(cardsClash(pool, gene)).toBe(false);
  });
});

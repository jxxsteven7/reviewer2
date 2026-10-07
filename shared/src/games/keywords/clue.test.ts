import { describe, expect, test, vi } from 'vitest';
import { checkClue, cleanClue, MAX_CLUE_INPUT, normalizeClue, wordKey } from './clue';

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
      conflict: { card: 1, text: 'MODEL' },
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
        similar: [{ card: 0, text: word }],
      });
    }
  });

  test('refuses Chinese words that contain each other', () => {
    expect(problemOf(NOTICE, [ATTENTION])).toBe('clue_on_board');
    expect(problemOf(FORCE, [ATTENTION])).toBe('clue_on_board');
    expect(problemOf(ATTENTION, [NOTICE])).toBe('clue_on_board');
    expect(problemOf(`${DATA}2`, [DATA])).toBe('clue_on_board');
    expect(problemOf(MANUSCRIPT, [REVIEWER])).toBeNull();
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
      conflict: { card: 0, text: 'Journal' },
      similar: [],
    });
    expect(checkClue('Journals', card(JOURNAL, 'Journal')).problem).toBe('clue_on_board');
    expect(checkClue('peer-review', card(PEER_REVIEW, 'Peer review')).problem).toBe('clue_on_board');
    expect(checkClue(ATTENTION, card('Attention', ATTENTION)).problem).toBe('clue_on_board');
  });

  test('only warns about a part or a form of the translation, and names the translation', () => {
    const warned = (text: string) => ({ problem: null, conflict: null, similar: [{ card: 0, text }] });
    expect(checkClue('review', card(PEER_REVIEW, 'Peer review'))).toEqual(warned('Peer review'));
    expect(checkClue('reviewing', card(PEER_REVIEW, 'Peer review'))).toEqual(warned('Peer review'));
    expect(checkClue(NOTICE, card('Attention', ATTENTION))).toEqual(warned(ATTENTION));
    expect(checkClue('gradient', card(JOURNAL, 'Journal')).similar).toEqual([]);
  });

  test("names the card's own word when the clue may be a form of both", () => {
    expect(checkClue('modeling', [{ word: 'Model', revealed: false, translations: ['Modell'] }]).similar).toEqual([
      { card: 0, text: 'Model' },
    ]);
  });
});

describe('a clue that may be a form of a word on the board', () => {
  test('is allowed with a warning that names the card', () => {
    expect(checkClue('modeling', board('Baseline', 'Model'))).toEqual({
      problem: null,
      conflict: null,
      similar: [{ card: 1, text: 'Model' }],
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
        similar: [{ card: 0, text: word }],
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

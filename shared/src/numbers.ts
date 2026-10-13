import type { Language } from './language';

// Numbers written out in words, for the streak titles (streaks.ts), which never show a digit:
// "Three Submissions, Three Rejections", and the same in Chinese characters. Both functions take a
// whole number from 0 up to 99,999,999, and throw a RangeError for anything else, which would be a
// bug rather than a number of games anyone has played. The Chinese characters are written as
// escapes, as the reserved names are (accounts.ts), so that the code stays in English.

const MAX = 99_999_999;

function check(n: number): void {
  if (!Number.isInteger(n) || n < 0 || n > MAX) throw new RangeError(`no words for the number ${n}`);
}

const HAN_DIGITS = ['\u96f6', '\u4e00', '\u4e8c', '\u4e09', '\u56db', '\u4e94', '\u516d', '\u4e03', '\u516b', '\u4e5d'];
// Ten, a hundred, a thousand, and ten thousand, which Chinese counts in.
const HAN_TEN = '\u5341';
const HAN_UNITS = ['', HAN_TEN, '\u767e', '\u5343'];
const HAN_WAN = '\u4e07';

// A number from 1 to 9999 in Chinese characters, as it is read aloud: one zero character for every
// run of zeros between other digits, and none after the last digit, so 101 reads "one hundred zero
// one", 110 "one hundred one ten" and 1001 "one thousand zero one". A one before the ten stays
// here, as it does after the ten thousands in 10,010; hanNumber() drops it at the start of a number.
function hanGroup(n: number): string {
  let out = '';
  let zeros = false;
  for (let unit = 3; unit >= 0; unit -= 1) {
    const digit = Math.floor(n / 10 ** unit) % 10;
    if (digit === 0) {
      zeros = out !== '';
      continue;
    }
    if (zeros) out += HAN_DIGITS[0];
    zeros = false;
    out += `${HAN_DIGITS[digit]}${HAN_UNITS[unit]}`;
  }
  return out;
}

// A number in Chinese characters, counted in ten thousands from 10,000 on, with a zero character
// before a low part under a thousand, as in 10,001. Ten to nineteen, and their ten thousands, begin
// with the ten alone rather than "one ten".
export function hanNumber(n: number): string {
  check(n);
  if (n === 0) return HAN_DIGITS[0] as string;
  const high = Math.floor(n / 10_000);
  const low = n % 10_000;
  let out = high > 0 ? `${hanGroup(high)}${HAN_WAN}` : '';
  if (low > 0) {
    if (high > 0 && low < 1000) out += HAN_DIGITS[0];
    out += hanGroup(low);
  }
  return out.startsWith(`${HAN_DIGITS[1]}${HAN_TEN}`) ? out.slice(1) : out;
}

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

// 1 to 99: "seven", "twenty-one".
function englishTens(n: number): string {
  if (n < 20) return ONES[n] as string;
  const ones = n % 10;
  return `${TENS[Math.floor(n / 10)]}${ones === 0 ? '' : `-${ONES[ones]}`}`;
}

// 1 to 999: "one hundred and one", with the "and" of British English.
function englishGroup(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return englishTens(rest);
  return `${ONES[hundreds]} hundred${rest === 0 ? '' : ` and ${englishTens(rest)}`}`;
}

// Every word with a capital, "and" apart, so that the number can stand in a title: "Twenty-One",
// "One Hundred and One".
function titleCase(words: string): string {
  return words
    .split(' ')
    .map((word) =>
      word === 'and' ? word : word.replace(/(^|-)([a-z])/g, (_, dash: string, c: string) => dash + c.toUpperCase()),
    )
    .join(' ');
}

// A number in English words, in title case: Three, Ten, Eleven, Twenty-One, One Hundred and One,
// One Thousand and One, Twelve Thousand Three Hundred and Forty-Five.
export function englishNumber(n: number): string {
  check(n);
  if (n === 0) return 'Zero';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor(n / 1000) % 1000;
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions > 0) parts.push(`${englishGroup(millions)} million`);
  if (thousands > 0) parts.push(`${englishGroup(thousands)} thousand`);
  if (rest > 0) parts.push(`${parts.length > 0 && rest < 100 ? 'and ' : ''}${englishGroup(rest)}`);
  return titleCase(parts.join(' '));
}

// The number in the words of the language.
export function numberWords(n: number, language: Language): string {
  return language === 'zh' ? hanNumber(n) : englishNumber(n);
}

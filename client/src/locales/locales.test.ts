import { readFileSync } from 'node:fs';
import { KEYWORDS_ERRORS, ROOM_ERRORS, SEAT_ERRORS } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import { CLIENT_ERRORS } from '../core/errors';

// Every interface string exists in both languages (docs/rules/constraints.md). The files are
// read as plain JSON: importing them would hand back the compiled messages instead.

type Messages = { [key: string]: string | Messages };

const read = (language: string): Messages =>
  JSON.parse(readFileSync(new URL(`./${language}.json`, import.meta.url), 'utf8')) as Messages;

function flatten(messages: Messages, prefix = ''): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') flat.set(path, value);
    else for (const [inner, message] of flatten(value, path)) flat.set(inner, message);
  }
  return flat;
}

// The named placeholders, such as {version}, and the number of plural forms.
const shape = (message: string) => ({
  placeholders: [...message.matchAll(/\{\s*(\w+)\s*\}/g)].map((match) => match[1]).sort(),
  forms: message.split('|').length,
});

const en = flatten(read('en'));
const zh = flatten(read('zh'));

describe('locale files', () => {
  test('have the same keys', () => {
    expect([...zh.keys()].sort()).toEqual([...en.keys()].sort());
  });

  test('have no empty messages', () => {
    for (const [key, message] of [...en, ...zh]) expect(message.trim(), key).not.toBe('');
  });

  test('use the same placeholders and plural forms in both languages', () => {
    for (const [key, message] of en) expect(shape(zh.get(key) ?? ''), key).toEqual(shape(message));
  });

  test('explain every error the server or the client can report', () => {
    for (const code of [...ROOM_ERRORS, ...KEYWORDS_ERRORS, ...SEAT_ERRORS, ...CLIENT_ERRORS]) {
      expect(en.has(`errors.${code}`), code).toBe(true);
    }
  });
});

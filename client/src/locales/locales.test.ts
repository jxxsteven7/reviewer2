import { readFileSync } from 'node:fs';
import {
  ACCOUNT_ERRORS,
  ACKNOWLEDGMENT_KINDS,
  DUO_TITLES,
  EMAIL_STATES,
  EMOTES,
  FEEDBACK_ERRORS,
  FEEDBACK_KINDS,
  FRIEND_ERRORS,
  KEYWORDS_ERRORS,
  RANKS,
  REPORT_ERRORS,
  ROOM_ERRORS,
  SEAT_ERRORS,
  SPONSOR_KINDS,
  START_PROBLEMS,
  STREAK_KINDS,
  TITLES,
  VERDICTS,
} from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import { DUO_LINES } from '../core/duos';
import { CLIENT_ERRORS } from '../core/errors';
import { LINES_PER_TIER, STREAK_TIERS } from '../core/streaks';
import { MISSED_LINES } from '../games/keywords/missed';

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
    for (const code of [
      ...ROOM_ERRORS,
      ...FEEDBACK_ERRORS,
      ...REPORT_ERRORS,
      ...FRIEND_ERRORS,
      ...ACCOUNT_ERRORS,
      ...KEYWORDS_ERRORS,
      ...SEAT_ERRORS,
      ...CLIENT_ERRORS,
    ]) {
      expect(en.has(`errors.${code}`), code).toBe(true);
    }
  });

  test('say every state of an email address, and name every title and every rank', () => {
    for (const state of EMAIL_STATES) expect(en.has(`account.profile.emailStates.${state}`), state).toBe(true);
    for (const title of TITLES) expect(en.has(`account.profile.titleNames.${title}`), title).toBe(true);
    for (const rank of RANKS) expect(en.has(`ranks.names.${rank}`), rank).toBe(true);
  });

  test('name every kind of feedback, of acknowledgment and of sponsor', () => {
    for (const kind of FEEDBACK_KINDS) expect(en.has(`feedback.kinds.${kind}`), kind).toBe(true);
    for (const kind of ACKNOWLEDGMENT_KINDS) expect(en.has(`acknowledgments.kinds.${kind}`), kind).toBe(true);
    for (const kind of SPONSOR_KINDS) expect(en.has(`sponsors.kinds.${kind}`), kind).toBe(true);
  });

  test('have every line with which the room teases a PI who missed the deadline', () => {
    for (let n = 1; n <= MISSED_LINES; n += 1) expect(en.has(`game.missed.lines.${n}`), String(n)).toBe(true);
    expect(en.has(`game.missed.lines.${MISSED_LINES + 1}`)).toBe(false);
    for (let n = 1; n <= MISSED_LINES; n += 1) expect(en.get(`game.missed.lines.${n}`)).toContain('{name}');
  });

  test('have a phrase for every quick reaction', () => {
    for (const emote of EMOTES) expect(en.has(`emotes.phrases.${emote}`), emote).toBe(true);
  });

  test('name every kind of streak, and have every line of every tier', () => {
    for (const kind of STREAK_KINDS) {
      expect(en.has(`streaks.kinds.${kind}`), kind).toBe(true);
      expect(en.has(`streaks.names.${kind}`), kind).toBe(true);
      for (const tier of STREAK_TIERS) {
        for (let n = 1; n <= LINES_PER_TIER; n += 1) expect(en.has(`streaks.lines.${kind}.${tier}.${n}`)).toBe(true);
        expect(en.has(`streaks.lines.${kind}.${tier}.${LINES_PER_TIER + 1}`)).toBe(false);
      }
    }
  });

  test('explain every title that a tap opens', () => {
    for (const title of TITLES) expect(en.has(`titles.award.${title}`), title).toBe(true);
    for (const kind of STREAK_KINDS) {
      expect(en.has(`titles.streak.${kind}`), kind).toBe(true);
      expect(en.has(`titles.streakNow.${kind}`), kind).toBe(true);
    }
    for (const kind of ACKNOWLEDGMENT_KINDS) expect(en.has(`titles.thanks.${kind}`), kind).toBe(true);
    for (const verdict of VERDICTS) {
      expect(en.has(`game.letter.verdicts.${verdict}`), verdict).toBe(true);
      expect(en.has(`game.letter.explain.${verdict}`), verdict).toBe(true);
    }
  });

  test('name and explain every friend title, with every line and every notice', () => {
    for (const title of DUO_TITLES) {
      for (const key of ['names', 'explain', 'notice'])
        expect(en.has(`duos.${key}.${title}`), `${key} ${title}`).toBe(true);
      for (let n = 1; n <= DUO_LINES; n += 1) expect(en.has(`duos.lines.${title}.${n}`), title).toBe(true);
      expect(en.has(`duos.lines.${title}.${DUO_LINES + 1}`)).toBe(false);
    }
  });

  test('say what keeps a game from starting', () => {
    for (const problem of START_PROBLEMS) {
      expect(en.has(`lobby.problems.${problem}`), problem).toBe(true);
    }
  });
});

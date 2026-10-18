import { describe, expect, test } from 'vitest';
import { versionCommit } from './versionCommit';

// An invented history of main, newest first, as `git log --first-parent --format='%H %s'` prints it.
const LOG = [
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa docs: thank a sponsor',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb v0.1.43 feat: add a game (#96)',
  'cccccccccccccccccccccccccccccccccccccccc docs: say what v0.1.42 changed',
  'dddddddddddddddddddddddddddddddddddddddd v0.1.42 fix: keep players in their team (#94)',
  'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee v0.1.4 feat: add rooms (#9)',
  '',
].join('\n');

describe('versionCommit', () => {
  test('is the commit whose title starts with the version, not one that only mentions it', () => {
    expect(versionCommit('v0.1.43', () => LOG)).toBe('b'.repeat(40));
    expect(versionCommit('v0.1.42', () => LOG)).toBe('d'.repeat(40));
  });

  test('never takes a version for a longer one that starts with it', () => {
    expect(versionCommit('v0.1.4', () => LOG)).toBe('e'.repeat(40));
    expect(versionCommit('v0.1.4', () => LOG.replace(/^.*v0\.1\.4 .*$/m, ''))).toBeNull();
  });

  test('is none when the history has no such title, or no history can be read', () => {
    expect(versionCommit('v0.2.0', () => LOG)).toBeNull();
    expect(versionCommit('v0.1.43', () => '')).toBeNull();
  });

  test('is the hash itself for a version that is a commit hash, without reading the history', () => {
    const log = () => {
      throw new Error('read the history');
    };
    expect(versionCommit('0a88766', log)).toBe('0a88766');
    expect(versionCommit('f'.repeat(40), log)).toBe('f'.repeat(40));
  });

  test('is none for a build without a version, without reading the history', () => {
    const log = () => {
      throw new Error('read the history');
    };
    expect(versionCommit('dev', log)).toBeNull();
    expect(versionCommit('', log)).toBeNull();
    expect(versionCommit('v0.1', log)).toBeNull();
  });
});

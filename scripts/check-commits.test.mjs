// Tests for scripts/check-commits.mjs. Run them with: node --test scripts/check-commits.test.mjs
//
// The fixtures that stand for Chinese text are written as \u escapes, because everything in the
// repository is in English (docs/rules/language.md); the escapes spell out the same characters.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkAttribution,
  checkIdentity,
  checkMessage,
  checkName,
  checkPackageJson,
  checkSubject,
  cleanMessage,
  fixedTitle,
  isAgent,
  isUnversioned,
  splitVersion,
  successors,
} from './check-commits.mjs';
import { entryFor } from './check-names.mjs';

const SCRIPT = fileURLToPath(new URL('./check-commits.mjs', import.meta.url));
const rules = (problems) => problems.map((problem) => problem.rule);

const CHINESE_SUBJECT = 'feat: \u52a0\u623f\u95f4\u7801'; // "feat: add room codes" in Chinese
const CHINESE_BODY = '\u4fee\u590d\u4e86\u95ee\u9898\u3002'; // "Fixed the problem." in Chinese
const FULLWIDTH_COMMA = '\uff0c';
// What git's localized template says in Chinese: "Please enter the commit message for your changes."
const CHINESE_TEMPLATE_LINE = '\u8bf7\u4e3a\u60a8\u7684\u53d8\u66f4\u8f93\u5165\u63d0\u4ea4\u8bf4\u660e';

describe('versions', () => {
  test('splitVersion reads a "vX.Y.Z " prefix', () => {
    assert.deepEqual(splitVersion('v1.2.3 feat: add rooms'), [[1, 2, 3], 'feat: add rooms']);
    assert.deepEqual(splitVersion('feat: add rooms'), [null, 'feat: add rooms']);
    assert.deepEqual(splitVersion('v1.2.3feat: add rooms'), [null, 'v1.2.3feat: add rooms']);
  });

  test('successors are the next patch, minor and major versions', () => {
    assert.deepEqual(successors([0, 1, 3]), { patch: [0, 1, 4], minor: [0, 2, 0], major: [1, 0, 0] });
  });

  test('fixedTitle fills in the next patch version', () => {
    const previous = [0, 1, 3];
    assert.equal(fixedTitle('feat: add rooms', previous), 'v0.1.4 feat: add rooms');
    assert.equal(fixedTitle('  feat: add rooms  ', previous), 'v0.1.4 feat: add rooms');
    assert.equal(fixedTitle('v0.1.3 feat: add rooms', previous), 'v0.1.4 feat: add rooms');
    assert.equal(fixedTitle('v0.1.9 feat: add rooms', previous), 'v0.1.4 feat: add rooms');
    assert.equal(fixedTitle('v0.0.0 feat: add rooms', previous), 'v0.1.4 feat: add rooms');
  });

  test('fixedTitle keeps a legal minor or major version and moves a stale one on', () => {
    assert.equal(fixedTitle('v0.2.0 feat: add rooms', [0, 1, 3]), 'v0.2.0 feat: add rooms');
    assert.equal(fixedTitle('v1.0.0 feat: add rooms', [0, 1, 3]), 'v1.0.0 feat: add rooms');
    assert.equal(fixedTitle('v0.2.0 feat: add rooms', [0, 2, 0]), 'v0.3.0 feat: add rooms');
    assert.equal(fixedTitle('v1.0.0 feat: add rooms', [1, 0, 0]), 'v2.0.0 feat: add rooms');
  });

  test('fixedTitle with patchOnly ignores a minor or major version', () => {
    const patchOnly = { patchOnly: true };
    assert.equal(fixedTitle('v0.2.0 feat: add rooms', [0, 1, 3], patchOnly), 'v0.1.4 feat: add rooms');
    assert.equal(fixedTitle('v1.0.0 feat: add rooms', [0, 1, 3], patchOnly), 'v0.1.4 feat: add rooms');
    assert.equal(fixedTitle('v0.1.4 feat: add rooms', [0, 1, 3], patchOnly), 'v0.1.4 feat: add rooms');
    assert.equal(fixedTitle('feat: add rooms', [0, 1, 3], patchOnly), 'v0.1.4 feat: add rooms');
  });

  test('fixedTitle with unversioned drops any version', () => {
    const unversioned = { unversioned: true };
    assert.equal(fixedTitle('docs: thank a tester', [0, 1, 3], unversioned), 'docs: thank a tester');
    assert.equal(fixedTitle(' v0.1.4 docs: thank a tester ', [0, 1, 3], unversioned), 'docs: thank a tester');
    assert.equal(fixedTitle('v0.2.0 docs: thank a tester', [0, 1, 3], unversioned), 'docs: thank a tester');
  });

  test('isUnversioned holds for the docs for people alone', () => {
    assert.ok(isUnversioned(['ACKNOWLEDGMENTS.md']));
    assert.ok(isUnversioned(['SPONSORS.md']));
    assert.ok(isUnversioned(['README.md', 'README.zh-CN.md', 'CONTRIBUTING.md']));
    assert.ok(isUnversioned(['docs/architecture.md', 'docs/decisions/0002-accounts.md', 'docs/maintainers.md']));
    assert.ok(!isUnversioned([]));
    assert.ok(!isUnversioned(['docs/rules/git.md']));
    assert.ok(!isUnversioned(['AGENTS.md']));
    assert.ok(!isUnversioned(['CLAUDE.md']));
    assert.ok(!isUnversioned(['words/README.md']));
    assert.ok(!isUnversioned(['LICENSE']));
    assert.ok(!isUnversioned(['.github/CODEOWNERS']));
    assert.ok(!isUnversioned(['client/README.md']));
    assert.ok(!isUnversioned(['ACKNOWLEDGMENTS.md', 'client/src/App.vue']));
    assert.ok(!isUnversioned(['SPONSORS.md', '.github/workflows/sponsors.yml']));
    assert.ok(!isUnversioned(['client/SPONSORS.md']));
  });
});

describe('subjects', () => {
  const branch = (subject) => rules(checkSubject(subject, 'test', { version: 'forbidden' }));
  const landed = (subject) => rules(checkSubject(subject, 'test', { version: 'required' }));

  test('accepts a well-formed subject', () => {
    assert.deepEqual(branch('feat: add room codes'), []);
    assert.deepEqual(branch('words: add 200 machine learning terms'), []);
    assert.deepEqual(landed('v0.0.7 fix: return players to their team after reconnecting'), []);
  });

  test('rejects subjects that break the format', () => {
    assert.deepEqual(branch('Add room codes'), ['type']);
    assert.deepEqual(branch('feature: add room codes'), ['type']);
    assert.deepEqual(branch('feat: Add room codes'), ['lowercase']);
    assert.deepEqual(branch('feat: add room codes.'), ['period']);
    assert.deepEqual(branch(`feat: ${'a'.repeat(70)}`), ['length']);
    assert.deepEqual(branch(CHINESE_SUBJECT), ['english', 'lowercase']);
    assert.deepEqual(branch('docs: explain the “stamp”'), ['english']);
    assert.deepEqual(branch(''), ['subject']);
  });

  test('requires or forbids the version prefix', () => {
    assert.deepEqual(branch('v0.0.1 feat: add room codes'), ['version']);
    assert.deepEqual(landed('feat: add room codes'), ['version']);
  });
});

describe('attribution', () => {
  const found = (message) => rules(checkAttribution(message, 'test'));

  test('rejects AI trailers, footers, addresses and session links', () => {
    assert.deepEqual(found('feat: x\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'), ['attribution']);
    assert.deepEqual(found('feat: x\n\nCo-authored-by: Claude <noreply@anthropic.com>'), ['attribution']);
    assert.deepEqual(found('feat: x\n\nCo-authored-by: openai-codex[bot] <bot@users.noreply.github.com>'), [
      'attribution',
    ]);
    assert.deepEqual(found('feat: x\n\nCo-authored-by: Copilot <175728472+Copilot@users.noreply.github.com>'), [
      'attribution',
    ]);
    assert.deepEqual(found('feat: x\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>'), ['attribution']);
    assert.deepEqual(found('feat: x\n\n  Signed-off-by: GitHub Copilot <copilot@github.com>'), ['attribution']);
    assert.deepEqual(found('feat: x\n\n\u{1f916} Generated with [Claude Code](https://claude.com/claude-code)'), [
      'attribution',
    ]);
    assert.deepEqual(found('feat: x\n\nGenerated by Codex CLI.'), ['attribution']);
    assert.deepEqual(found('feat: x\n\nClaude-Session: https://claude.ai/code/session_123'), ['attribution']);
    assert.deepEqual(found('feat: x\n\nSee https://chatgpt.com/codex/tasks/abc'), ['attribution']);
    assert.deepEqual(found('feat: x\n\nWritten with help from noreply@openai.com'), ['attribution']);
  });

  test('allows prose about the rule, human co-authors and AI disclosures', () => {
    assert.deepEqual(found('docs: forbid Co-Authored-By trailers from Claude or Codex'), []);
    assert.deepEqual(found('feat: x\n\nCo-authored-by: Alice Wang <alice@cursorlabs.example>'), []);
    assert.deepEqual(found('feat: x\n\nCo-authored-by: Claude Dupont <claude.dupont@example.com>'), []);
    assert.deepEqual(found('feat: x\n\nCo-authored-by: Devin Lee <devin@example.com>'), []);
    assert.deepEqual(found('feat: x\n\nCo-authored-by: Ana <ana@cursor.com>'), []);
    assert.deepEqual(found('feat: x\n\nGenerated by the word list validation script.'), []);
    assert.deepEqual(
      found('## AI assistance\n\n- Generated by Codex: the reconnect handler in server/src/core/rooms.ts'),
      [],
    );
    assert.deepEqual(found('Generated with Claude Code, then rewritten by hand.'), []);
  });

  test('isAgent knows the names, bots and addresses of AI agents', () => {
    assert.equal(isAgent({ name: 'Claude', email: 'noreply@anthropic.com' }), true);
    assert.equal(isAgent({ name: 'claude[bot]', email: '209825114+claude[bot]@users.noreply.github.com' }), true);
    assert.equal(isAgent({ name: 'copilot-swe-agent[bot]', email: 'copilot@users.noreply.github.com' }), true);
    assert.equal(isAgent({ name: 'chatgpt-codex-connector[bot]', email: 'codex@users.noreply.github.com' }), true);
    assert.equal(isAgent({ name: 'Jiaxiao Shi', email: 'noreply@openai.com' }), true);
    assert.equal(
      isAgent({ name: 'dependabot[bot]', email: '49699333+dependabot[bot]@users.noreply.github.com' }),
      false,
    );
    assert.equal(isAgent({ name: 'Claude Dupont', email: 'claude@example.com' }), false);
    assert.equal(isAgent({ name: 'GitHub', email: 'noreply@github.com' }), false);
  });

  test('checkIdentity rejects commits made in the name of an AI agent', () => {
    const commit = (authorName, authorEmail) => ({
      authorName,
      authorEmail,
      committerName: 'GitHub',
      committerEmail: 'noreply@github.com',
    });
    assert.deepEqual(rules(checkIdentity(commit('Test Person', 'test@example.com'), 'test')), []);
    assert.deepEqual(
      rules(checkIdentity(commit('dependabot[bot]', 'dependabot[bot]@users.noreply.github.com'), 'test')),
      [],
    );
    assert.deepEqual(rules(checkIdentity(commit('claude[bot]', 'claude[bot]@users.noreply.github.com'), 'test')), [
      'identity',
    ]);
    assert.deepEqual(rules(checkIdentity(commit('Claude', 'noreply@anthropic.com'), 'test')), ['identity']);
  });
});

describe('messages', () => {
  const branch = (message, options = {}) => rules(checkMessage(message, 'test', { version: 'forbidden', ...options }));
  const landed = (message) => rules(checkMessage(message, 'test', { version: 'required' }));

  test('needs a blank line before the body', () => {
    assert.deepEqual(branch('feat: add rooms\nBody text'), ['blank-line']);
    assert.deepEqual(branch('feat: add rooms\n\nBody text'), []);
  });

  test('rejects Chinese text in the body', () => {
    assert.deepEqual(branch(`feat: add rooms\n\n${CHINESE_BODY}`), ['english']);
    assert.deepEqual(branch(`feat: add rooms\n\nNow it works${FULLWIDTH_COMMA}see notes`), ['english']);
    assert.deepEqual(branch('docs: explain the stamp\n\nThe “stamp” — and why… \u{1f6a7} still early'), []);
  });

  test('keeps the line git writes in a revert on a branch, but not on main', () => {
    assert.deepEqual(branch('revert: add rooms'), ['revert']);
    assert.deepEqual(branch('revert: add rooms\n\nThis reverts commit 0123456789abcdef.'), []);
    // A squash merge carries only the pull request title.
    assert.deepEqual(landed('v0.0.3 revert: add rooms'), []);
  });

  test('allows fixup commits only where asked to', () => {
    assert.deepEqual(branch('fixup! feat: add rooms', { allowFixup: true }), []);
    assert.deepEqual(branch('fixup! fixup! feat: add rooms', { allowFixup: true }), []);
    assert.deepEqual(branch('amend! squash! feat: add rooms', { allowFixup: true }), []);
    assert.deepEqual(branch('fixup! feat: add rooms'), ['fixup']);
    assert.deepEqual(branch('fixup! fixup! feat: add rooms'), ['fixup']);
  });

  test('cleanMessage strips comments and the diff below the scissors line', () => {
    const raw =
      '\nfeat: add rooms\n\nBody\n# a comment\n# ------------------------ >8 ------------------------\ndiff --git a/x b/x\n+Co-Authored-By: Claude\n';
    assert.equal(cleanMessage(raw), 'feat: add rooms\n\nBody');
    assert.equal(cleanMessage('feat: x\r\n\r\nBody\r\n'), 'feat: x\n\nBody');
    assert.equal(cleanMessage('\ufefffeat: x\n'), 'feat: x');
  });

  test('cleanMessage follows the cleanup mode and the comment string', () => {
    const raw =
      'feat: add rooms  \n\n\n\n#kept\n; dropped\n; ------------------------ >8 ------------------------\ndiff\n';
    assert.equal(cleanMessage(raw, { mode: 'strip', comment: ';' }), 'feat: add rooms\n\n#kept');
    assert.equal(cleanMessage(raw, { mode: 'whitespace', comment: ';' }), 'feat: add rooms\n\n#kept\n; dropped');
    assert.equal(cleanMessage('feat: x \n\n#kept\n', { mode: 'whitespace' }), 'feat: x\n\n#kept');
    assert.equal(cleanMessage('feat: x \n\n#kept\n', { mode: 'verbatim' }), 'feat: x \n\n#kept');
  });

  test('package.json must hold the minor line', () => {
    assert.deepEqual(checkPackageJson([0, 3, 5], null, 'test'), []);
    assert.deepEqual(rules(checkPackageJson([0, 3, 5], '{"version": "0.3.0"}', 'test')), []);
    assert.deepEqual(rules(checkPackageJson([0, 3, 5], '{"version": "1.0.0"}', 'test')), ['package.json']);
  });
});

describe('the name of the board game', () => {
  // The real spellings must not appear in the repository, so the tests look for a made-up one.
  const spellings = [entryFor('zorblax')];

  test('checkName says where the name starts without repeating it', () => {
    const problems = checkName('feat: add rooms\n\nLike Zor-Blax, but online.', 'test', spellings);
    assert.deepEqual(rules(problems), ['name']);
    assert.match(problems[0].detail, /line 3, column 6 /);
    assert.doesNotMatch(problems[0].detail, /zor/i);
    assert.deepEqual(checkName('feat: add rooms', 'test', spellings), []);
  });

  test('is refused in the subject and in the body of a message', () => {
    const check = (message) => rules(checkMessage(message, 'test', { version: 'forbidden', spellings }));
    assert.deepEqual(check('feat: add zorblax rooms'), ['name']);
    assert.deepEqual(check('feat: add rooms\n\nThe rules of Zorblax.'), ['name']);
    assert.deepEqual(check('feat: add rooms\n\nThe rules of the game.'), []);
  });
});

describe('in a git repository', () => {
  const directories = [];
  after(() => directories.forEach((directory) => rmSync(directory, { recursive: true, force: true })));

  function makeRepo() {
    const directory = mkdtempSync(join(tmpdir(), 'check-commits-'));
    directories.push(directory);
    const git = (...args) => {
      const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Test Person');
    git('config', 'user.email', 'test@example.com');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'tag.gpgsign', 'false');
    mkdirSync(join(directory, 'no-hooks'));
    git('config', 'core.hooksPath', join(directory, 'no-hooks'));
    const commit = (subject, ...options) => git('commit', '-q', '--allow-empty', '-m', subject, ...options);
    const run = (args, env = {}) =>
      spawnSync(process.execPath, [SCRIPT, ...args], {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, ...env },
      });
    const cli = (...args) => run(args);
    return { directory, git, commit, cli, run };
  }

  test('counts from v0.0.0 when nothing has a version yet', () => {
    const { commit, cli } = makeRepo();
    commit('chore: initial commit');
    assert.equal(cli('next', '--base', 'main').stdout.trim(), 'v0.0.1');
    assert.equal(
      cli('pr-title', '--base', 'main', '--fix', '--', 'docs: add rules').stdout.trim(),
      'v0.0.1 docs: add rules',
    );
  });

  test('takes the highest version from subjects and tags', () => {
    const { git, commit, cli } = makeRepo();
    commit('chore: initial commit');
    commit('v0.0.1 docs: add rules (#1)');
    commit('v0.0.2 fix: correct a link (#2)');
    assert.equal(cli('next', '--base', 'main').stdout.trim(), 'v0.0.3');
    git('tag', 'v0.3.0');
    assert.equal(cli('next', '--base', 'main').stdout.trim(), 'v0.3.1');
    assert.equal(cli('next', '--base', 'main', '--minor').stdout.trim(), 'v0.4.0');
    assert.equal(cli('next', '--base', 'main', '--major').stdout.trim(), 'v1.0.0');
  });

  test('pr-title checks the version, the branch name and the body', () => {
    const { directory, commit, cli } = makeRepo();
    commit('v0.0.1 docs: add rules (#1)');
    assert.equal(
      cli('pr-title', '--base', 'main', '--head-ref', 'feat/rooms', '--', 'v0.0.2 feat: add rooms').status,
      0,
    );
    assert.equal(cli('pr-title', '--base', 'main', '--', 'v0.1.0 feat: add rooms').status, 0);
    assert.equal(cli('pr-title', '--base', 'main', '--', 'v0.0.1 feat: add rooms').status, 1);
    assert.equal(cli('pr-title', '--base', 'main', '--', 'feat: add rooms').status, 1);
    assert.equal(cli('pr-title', '--base', 'main', '--head-ref', 'rooms', '--', 'v0.0.2 feat: add rooms').status, 1);
    const body = join(directory, 'body.md');
    writeFileSync(body, '## What\n\nAdds rooms.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n');
    assert.equal(cli('pr-title', '--base', 'main', '--body-file', body, '--', 'v0.0.2 feat: add rooms').status, 1);
    writeFileSync(
      body,
      '## What\r\n\r\nAdds rooms.\r\n\r\n## AI assistance\r\n\r\n- Generated by Codex: the reconnect handler\r\n',
    );
    assert.equal(cli('pr-title', '--base', 'main', '--body-file', body, '--', 'v0.0.2 feat: add rooms').status, 0);
    writeFileSync(join(directory, 'package.json'), '{"version": "1.0.0"}\n');
    assert.equal(cli('pr-title', '--base', 'main', '--', 'v0.0.2 feat: add rooms').status, 1);
    writeFileSync(join(directory, 'package.json'), '{"version": "0.0.0"}\n');
    assert.equal(cli('pr-title', '--base', 'main', '--', 'v0.0.2 feat: add rooms').status, 0);
  });

  test('pr-title --fix takes a title that starts with a dash and honors --patch', () => {
    const { commit, cli } = makeRepo();
    commit('v0.0.1 docs: add rules (#1)');
    assert.equal(
      cli('pr-title', '--base', 'main', '--fix', '--', '-feat: add rooms').stdout.trim(),
      'v0.0.2 -feat: add rooms',
    );
    assert.equal(
      cli('pr-title', '--base', 'main', '--fix', '--', 'v0.1.0 feat: add rooms').stdout.trim(),
      'v0.1.0 feat: add rooms',
    );
    assert.equal(
      cli('pr-title', '--base', 'main', '--fix', '--patch', '--', 'v0.1.0 feat: add rooms').stdout.trim(),
      'v0.0.2 feat: add rooms',
    );
    assert.equal(cli('pr-title', '--base', 'main', '--patch', '--', 'v0.1.0 feat: add rooms').status, 2);
  });

  test('range checks every commit and rejects the commits of AI agents', () => {
    const { commit, cli } = makeRepo();
    commit('v0.0.1 docs: add rules (#1)');
    commit('feat: add rooms');
    commit('fixup! fixup! feat: add rooms');
    assert.equal(cli('range', 'main~2..main').status, 0);
    commit('chore: bump something', '--author=dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>');
    assert.equal(cli('range', 'main~1..main').status, 0);
    commit('feat: add a lobby', '--author=claude[bot] <209825114+claude[bot]@users.noreply.github.com>');
    const result = cli('range', 'main~1..main');
    assert.equal(result.status, 1);
    assert.match(result.stdout, /identity/);
  });

  test('head accepts the next version and rejects a skipped one', () => {
    const { commit, cli } = makeRepo();
    commit('chore: initial commit');
    commit('v0.0.1 docs: add rules (#1)');
    assert.equal(cli('head').status, 0);
    commit('v0.0.2 revert: add rules (#2)'); // a squash merge has no body
    assert.equal(cli('head').status, 0);
    commit('v0.0.5 feat: add rooms (#3)');
    const result = cli('head');
    assert.equal(result.status, 1);
    assert.match(result.stdout, /must be v0\.0\.3/);
    commit('feat: add a lobby');
    assert.equal(cli('head').status, 1);
  });

  test('a pull request or landed commit that changes only docs for people takes no version', () => {
    const { directory, git, commit, cli } = makeRepo();
    const change = (file, subject) => {
      mkdirSync(join(directory, file, '..'), { recursive: true });
      writeFileSync(join(directory, file), `${subject}\n`);
      git('add', file);
      commit(subject);
    };
    change('README.md', 'v0.0.1 docs: add a readme (#1)');
    git('switch', '-q', '-c', 'docs/thanks');
    change('ACKNOWLEDGMENTS.md', 'docs: thank a tester');
    change('docs/architecture.md', 'docs: describe the rooms');
    const title = (...args) => cli('pr-title', '--base', 'main', '--head', 'docs/thanks', ...args);
    assert.equal(title('--fix', '--', 'v0.0.2 docs: thank a tester').stdout.trim(), 'docs: thank a tester');
    assert.equal(title('--', 'docs: thank a tester').status, 0);
    const versioned = title('--', 'v0.0.2 docs: thank a tester');
    assert.equal(versioned.status, 1);
    assert.match(versioned.stdout, /carries no version/);
    git('switch', '-q', '-c', 'docs/rules');
    change('docs/rules/git.md', 'docs: change a rule');
    const rule = (...args) => cli('pr-title', '--base', 'main', '--head', 'docs/rules', ...args);
    assert.equal(rule('--fix', '--', 'docs: change a rule').stdout.trim(), 'v0.0.2 docs: change a rule');
    assert.equal(rule('--', 'docs: change a rule').status, 1);

    git('switch', '-q', 'main');
    change('ACKNOWLEDGMENTS.md', 'docs: thank a tester (#2)');
    assert.equal(cli('head').status, 0);
    change('docs/design.md', 'v0.0.2 docs: describe the look (#3)');
    assert.match(cli('head').stdout, /carries no version/);
    // A version that landed is used up, even on a commit that shouldn't have had it.
    change('server.js', 'v0.0.3 feat: add a server (#4)');
    assert.equal(cli('head').status, 0);
    change('docs/rules/git.md', 'docs: change a rule (#5)');
    assert.equal(cli('head').status, 1);
    assert.equal(cli('next', '--base', 'main').stdout.trim(), 'v0.0.4');

    // A rule moved out of docs/rules/ counts at both of its paths, so it still takes a version.
    git('switch', '-q', '-c', 'docs/move');
    git('mv', 'docs/rules/git.md', 'docs/git.md');
    commit('docs: move a rule');
    const moved = (...args) => cli('pr-title', '--base', 'main', '--head', 'docs/move', ...args);
    assert.equal(moved('--fix', '--', 'docs: move a rule').stdout.trim(), 'v0.0.4 docs: move a rule');
    git('switch', '-q', 'main');
    git('mv', 'docs/rules/git.md', 'docs/git.md');
    commit('docs: move a rule (#6)');
    assert.match(cli('head').stdout, /must start with "vX\.Y\.Z "/);
  });

  test('head takes a commit without a pull request only for the lists of thanks, titled "docs: <summary>"', () => {
    const { directory, git, commit, cli } = makeRepo();
    const change = (files, subject) => {
      for (const file of files) {
        writeFileSync(join(directory, file), `${subject}\n`);
        git('add', file);
      }
      commit(subject);
    };
    const landed = () => {
      const result = cli('head');
      return {
        status: result.status,
        rules: [...result.stdout.matchAll(/^check-commits: \w+ ([\w-]+):/gm)].map((m) => m[1]),
      };
    };
    change(['README.md'], 'v0.0.1 docs: add a readme (#1)');
    change(['SPONSORS.md'], 'docs: thank a sponsor');
    assert.deepEqual(landed(), { status: 0, rules: [] });
    change(['ACKNOWLEDGMENTS.md', 'SPONSORS.md'], 'docs: thank a tester and a sponsor\n\nBoth asked to be named.');
    assert.deepEqual(landed(), { status: 0, rules: [] });
    // They take no version, so the next pull request still takes the next one.
    assert.equal(cli('next', '--base', 'main').stdout.trim(), 'v0.0.2');

    change(['ACKNOWLEDGMENTS.md', 'README.md'], 'docs: thank a tester');
    assert.deepEqual(landed(), { status: 1, rules: ['direct'] });
    assert.match(cli('head').stdout, /may change only ACKNOWLEDGMENTS\.md and SPONSORS\.md, not README\.md/);
    change(['server.js'], 'v0.0.2 feat: add a server');
    assert.deepEqual(landed(), { status: 1, rules: ['direct', 'version', 'direct'] });
    change(['SPONSORS.md'], 'v0.0.2 docs: thank a sponsor');
    assert.deepEqual(landed(), { status: 1, rules: ['version'] });
    change(['SPONSORS.md'], 'chore: thank a sponsor');
    assert.deepEqual(landed(), { status: 1, rules: ['direct'] });
    change(['SPONSORS.md'], 'docs: Thank a sponsor.');
    assert.deepEqual(landed(), { status: 1, rules: ['period', 'lowercase'] });
    change(['SPONSORS.md'], 'Update SPONSORS.md');
    assert.deepEqual(landed(), { status: 1, rules: ['type'] });
    commit('docs: change nothing');
    assert.deepEqual(landed(), { status: 1, rules: ['direct'] });
    // A squash merge of the same change is a pull request's, as before.
    change(['SPONSORS.md'], 'docs: thank a sponsor (#2)');
    assert.deepEqual(landed(), { status: 0, rules: [] });
  });

  test('msg on main asks for the next version, or none for the docs for people alone', () => {
    const { directory, git, commit, cli } = makeRepo();
    commit('v0.0.1 docs: add rules (#1)');
    const file = join(directory, 'message.txt');
    const stage = (path) => {
      writeFileSync(join(directory, path), 'text\n');
      git('add', path);
    };
    stage('README.md');
    writeFileSync(file, 'docs: fix a typo\n');
    assert.equal(cli('msg', file).status, 0);
    writeFileSync(file, 'v0.0.2 docs: fix a typo\n');
    assert.match(cli('msg', file).stdout, /carries no version/);
    stage('server.js');
    assert.equal(cli('msg', file).status, 0);
    writeFileSync(file, 'docs: fix a typo\n');
    assert.match(cli('msg', file).stdout, /must start with "vX\.Y\.Z "/);
  });

  test('msg forbids a version on a branch commit', () => {
    const { directory, git, commit, cli } = makeRepo();
    commit('v0.0.1 docs: add rules (#1)');
    git('switch', '-q', '-c', 'feat/rooms');
    const file = join(directory, 'message.txt');
    writeFileSync(file, 'v0.0.2 feat: add rooms\n');
    assert.equal(cli('msg', file).status, 1);
    writeFileSync(file, 'feat: add rooms\n\n# Please enter the commit message\n');
    const result = cli('msg', file);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });

  test('msg cleans the message up the way git will', () => {
    const { directory, git, commit, run } = makeRepo();
    commit('v0.0.1 docs: add rules (#1)');
    git('switch', '-q', '-c', 'feat/rooms');
    const file = join(directory, 'message.txt');
    // `git commit -m` keeps lines that start with "#" and trims trailing whitespace.
    writeFileSync(file, 'feat: add rooms \n\n#fix\n');
    assert.equal(run(['msg', file], { GIT_EDITOR: ':' }).status, 0);
    writeFileSync(file, `feat: add rooms\n\n#${CHINESE_BODY}\n`);
    assert.equal(run(['msg', file], { GIT_EDITOR: ':' }).status, 1);
    assert.equal(run(['msg', file], { GIT_EDITOR: 'vi' }).status, 0);
    // The comment string comes from the configuration, and so does the cleanup mode.
    git('config', 'core.commentChar', ';');
    writeFileSync(file, `feat: add rooms\n\n; ${CHINESE_TEMPLATE_LINE}\n`);
    assert.equal(run(['msg', file], { GIT_EDITOR: 'vi' }).status, 0);
    git('config', 'commit.cleanup', 'whitespace');
    assert.equal(run(['msg', file], { GIT_EDITOR: 'vi' }).status, 1);
  });

  test('release names every minor or major version that has no tag yet', () => {
    const { git, commit, cli } = makeRepo();
    commit('v0.0.1 docs: add rules (#1)');
    assert.equal(cli('release').stdout, '');
    commit('v0.1.0 feat: play a full game (#2)');
    const minor = git('rev-parse', 'HEAD');
    commit('v0.1.1 fix: correct a link (#3)');
    commit('v1.0.0 chore: open the game to the public (#4)');
    const major = git('rev-parse', 'HEAD');
    assert.equal(cli('release').stdout, `v0.1.0\t${minor}\nv1.0.0\t${major}\n`);
    git('tag', 'v0.1.0', minor);
    assert.equal(cli('release').stdout, `v1.0.0\t${major}\n`);
    git('tag', 'v1.0.0', major);
    assert.equal(cli('release').stdout, '');
  });

  test('runs when invoked through a symlink', () => {
    const { directory, git, commit } = makeRepo();
    commit('v0.0.1 docs: add rules (#1)');
    git('switch', '-q', '-c', 'feat/rooms');
    const link = join(directory, 'check-commits-link.mjs');
    symlinkSync(SCRIPT, link);
    const file = join(directory, 'message.txt');
    writeFileSync(file, 'Bad subject\n');
    const result = spawnSync(process.execPath, [link, 'msg', file], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /type:/);
  });

  test('reports usage errors with exit code 2', () => {
    const { cli } = makeRepo();
    assert.equal(cli('pr-title', '--', 'feat: x').status, 2);
    assert.equal(cli('bogus').status, 2);
    assert.equal(cli().status, 2);
  });
});

#!/usr/bin/env node
// Turns on the repository's git hooks in .githooks/ (see docs/rules/git.md). npm runs this as
// the "prepare" script, so `npm install` in a new clone or worktree sets core.hooksPath.
//
// It does nothing, and succeeds, wherever there are no hooks to turn on: in CI, outside a git
// checkout and when git isn't installed. It never fails an install.

import { spawnSync } from 'node:child_process';

const git = (...args) => spawnSync('git', args, { encoding: 'utf8' });

function main() {
  if (process.env.CI) return;
  const inside = git('rev-parse', '--is-inside-work-tree');
  if (inside.error || inside.status !== 0) return;
  if (git('config', '--get', 'core.hooksPath').stdout.trim() === '.githooks') return;
  const result = git('config', 'core.hooksPath', '.githooks');
  if (result.status === 0) {
    console.log('install-hooks: turned on the git hooks in .githooks/');
  } else {
    console.warn(`install-hooks: could not set core.hooksPath: ${result.stderr.trim()}. See docs/rules/git.md.`);
  }
}

main();

# Branches, commits and pull requests

How to develop, commit and open pull requests. These rules apply to project members, outside contributors and AI coding assistants.

## Basics

- **`main` is protected.** Nobody, maintainers included, commits directly to `main`, pushes to it, force-pushes it or deletes it. Every change reaches `main` through a pull request.
- **Work in a worktree, on a branch of your own.** Project members create a new branch for each piece of work and work on it in a git worktree. They keep the main checkout on `main` and use it only to sync. Outside contributors fork the repository and work on a branch in their fork.
- **No AI or agent attribution in commits.** See [Commit messages](#commit-messages).
- **Every pull request is squash-merged and versioned.** It lands on `main` as one commit titled `vX.Y.Z <type>: <summary>`. See [versioning.md](versioning.md).

## Project members: worktree workflow

### Directory layout

Put the main checkout and all worktrees side by side inside one parent directory:

```
reviewer2-project/
├── reviewer2/              # main checkout: stays on main; used to sync and create worktrees, never to write code
├── feat-keywords-rules/    # a worktree for one piece of work, named after its branch
├── fix-reconnect/
├── keywords-stack/         # a worktree shared by a stack of branches
└── review-pr/              # a worktree for looking at other branches
```

### First-time setup

Install [Node.js](https://nodejs.org) 22.22.2 or later first (24.15 or later on Node 24), but not 23 or 25; [../development.md](../development.md) explains why. The git hooks, the repository's scripts and the app all run on it.

```bash
mkdir reviewer2-project && cd reviewer2-project
git clone git@github.com:jxxsteven7/reviewer2.git
cd reviewer2
git config core.hooksPath .githooks   # turn on the local hooks described below
```

### Starting a piece of work

From the main checkout:

```bash
git fetch origin
git worktree add ../feat-keywords-rules -b feat/keywords-rules origin/main
cd ../feat-keywords-rules
```

- Each piece of work gets its own branch, and each branch becomes one PR.
- A piece of work that stands on its own gets its own worktree too. Name the directory after the branch, with `/` replaced by `-`. You can have several open at once without them getting in each other's way.
- Each worktree has its own `node_modules`, so run `npm install` in each one.

### While you work

```bash
git commit                                   # commit in small steps
git push -u origin feat/keywords-rules       # first push
git fetch origin && git rebase origin/main   # catch up when main moves
git push --force-with-lease                  # push after a rebase; only ever on your own branch
```

### Worktrees that hold more than one branch

A worktree doesn't have to stay on one branch. Opening one per branch is wasted effort when the branches belong together or when you only want to look at one. Two kinds of worktree move between branches, and they are named after what they are for:

- **A stack.** Branches that build on each other share one worktree; see [Stacked pull requests](#stacked-pull-requests). Move between them with `git switch`.
- **A review worktree.** Keep one worktree for reading and running other branches. Create it once with `git worktree add --detach ../review-pr origin/main`. Check a branch out detached, so that the branch itself stays free for its own worktree:

  ```bash
  git fetch origin
  git switch --detach origin/feat/rooms
  ```

  To push a fix to that branch, run `git switch feat/rooms`, commit and push. Run `git switch --detach` when you are done.

In a worktree like this:

- Commit before you switch branches. A work-in-progress commit that you amend later is fine. All worktrees share one stash, so a stashed change is easy to pop in the wrong place.
- Git refuses to check out a branch that is checked out in another worktree. Don't force it. Switch the other worktree to a different branch, or do the work there.
- Install dependencies again after switching to a branch whose lockfile differs.
- The main checkout is never one of these. It stays on `main`.

### Stacked pull requests

When a change is too large for one PR, split it into a stack: a chain of branches in which each one builds on the one below it, with one PR per branch. The bottom PR targets `main`, and every other PR targets the branch below it, so each PR shows only its own changes.

```bash
git worktree add ../keywords-stack -b feat/keywords-rules origin/main   # the bottom of the stack
cd ../keywords-stack
# commit, push, and open a PR against main
git switch -c feat/keywords-online                                      # the next branch starts where this one ends
# commit, push, and open a PR against feat/keywords-rules
git switch -c feat/keywords-ui                                          # the top of the stack, for now
# commit, push, and open a PR against feat/keywords-online
```

A stack is rebased as a whole, from its top branch. With `--update-refs`, which needs Git 2.38 or later, `git rebase` moves every branch of the stack along with the commits it replays.

- **After changing a branch lower down**, for example to address a review, bring the branches above it along:

  ```bash
  git switch feat/keywords-ui                     # the top of the stack
  git rebase --update-refs feat/keywords-rules    # the branch you changed
  ```

- **When `main` moves**, run `git fetch origin && git rebase --update-refs origin/main` on the top branch.
- **After the bottom PR is merged.** A squash merge puts one new commit on `main` in place of the branch's commits, so take those commits out of the rest of the stack:

  ```bash
  git fetch origin
  git switch feat/keywords-ui
  git rebase --update-refs --onto origin/main feat/keywords-rules   # the branch that was merged
  ```

  GitHub points the next PR at `main` when the merged branch is deleted.

After each of these, push every branch that moved, for example `git push --force-with-lease origin feat/keywords-online feat/keywords-ui`.

Stacks merge from the bottom up, one PR at a time. Each PR is still reviewed and versioned on its own.

### Cleaning up after a merge

Back in the main checkout:

```bash
git switch main && git pull --ff-only
git worktree remove ../feat-keywords-rules
git branch -D feat/keywords-rules   # git doesn't recognize squash-merged branches as merged, so -D is needed
git fetch --prune
```

A worktree that holds more than one branch stays until all of its work has merged. Delete each of its branches as it lands.

`git worktree list` shows all existing worktrees.

### Local hooks

The repository ships four git hooks in `.githooks/` that catch rule violations on your machine:

- `pre-commit` and `pre-merge-commit` refuse commits, including the merge commits that `git merge` and `git pull` make, while `main` is checked out. On other branches they run `scripts/check-names.mjs`, which refuses staged files whose name or contents contain the name of the board game the first game is based on; see [constraints.md](constraints.md).
- `commit-msg` runs `scripts/check-commits.mjs`, the same checker CI uses. It refuses commit messages that break the format below, contain Chinese text, AI or agent attribution or the name of that board game, or carry a version.
- `pre-push` refuses pushes to `main` on the remote.

`npm install` turns the hooks on by running `git config core.hooksPath .githooks`, which applies to every worktree. You can also run that command yourself. Never bypass the hooks with `--no-verify`.

If you notice that you have already changed files on `main` in the main checkout, run `git stash`, create the worktree, and run `git stash pop` inside it.

Branch protection on GitHub is the last line of defense. The local hooks make sure mistakes are caught on your machine first.

## Outside contributors: fork workflow

1. **Fork** this repository on GitHub.
2. Clone your fork and add this repository as `upstream`:

   ```bash
   git clone git@github.com:<your-username>/reviewer2.git
   cd reviewer2
   git remote add upstream https://github.com/jxxsteven7/reviewer2.git
   ```

3. Start every change on a new branch from the latest upstream `main`. Don't work on your fork's `main`:

   ```bash
   git fetch upstream
   git switch -c fix/lobby-typo upstream/main
   ```

4. Commit, then push to your fork:

   ```bash
   git push -u origin fix/lobby-typo
   ```

5. Open a pull request against `main` in `jxxsteven7/reviewer2` and fill in the template. We recommend ticking **Allow edits by maintainers**.
6. Address review comments by pushing more commits to the same branch. The PR updates automatically. Once it is approved, a maintainer merges it.

When upstream `main` moves, run `git fetch upstream && git rebase upstream/main`, then `git push --force-with-lease`.

Worktrees work the same way in a fork. For larger changes, please open an issue first so that no effort is wasted.

## Branch names

Use `<type>/<short-description>`, in lowercase English with words separated by `-`.

| Type | Use for | Example |
|---|---|---|
| `feat` | New features | `feat/keywords-rules` |
| `fix` | Bug fixes | `fix/reconnect-after-lock` |
| `words` | Word lists | `words/ml` |
| `docs` | Documentation | `docs/contributing` |
| `refactor` | Restructuring without changing behavior | `refactor/room-manager` |
| `test` | Adding or changing tests only | `test/keywords-scoring` |
| `chore` | Build, dependencies, configuration | `chore/eslint` |
| `ci` | CI workflows | `ci/deploy-preview` |
| `perf` | Performance improvements | `perf/state-broadcast` |

## Commit messages

A commit message is a subject line, a blank line and an optional body:

```
fix: return players to their team after reconnecting

The reconnect handler looked players up by socket ID, which changes on
every reconnect. Look them up by their player token instead.
```

- The subject is `<type>: <summary>`. The type is one of `feat`, `fix`, `words`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf` and `revert`, usually the same as the branch type.
- The summary is one imperative sentence in English that makes sense on its own: "fix: return players to their team after reconnecting", not "fix: bug" or "chore: update code". It starts with a lowercase letter or a digit and doesn't end with a period.
- The subject uses printable ASCII only and is at most 72 characters long.
- The body, if there is one, explains what changed, why, and any known shortcomings. It is in English too.
- A revert is titled `revert: <summary>` and keeps the "This reverts commit <sha>." line that `git revert` writes. This is about branch commits: the squash commit on `main` carries only the PR title.
- Branch commits carry **no** version. The version goes on the PR title; see [versioning.md](versioning.md).
- **No AI or agent attribution.** Don't add trailers such as `Co-Authored-By: Claude …` or `Co-Authored-By: Codex …`, "Generated with …" lines, or links to AI sessions. The author of a commit is the person who commits it, and that person is responsible for its content. The same applies to PR titles and descriptions.
  - The `commit-msg` hook blocks these lines locally.
  - For Claude Code, the repository's `.claude/settings.json` already turns off its default attribution.
  - For other tools, turn off automatic attribution in the tool's settings.

## Pull request requirements

- Title the PR `<type>: <summary>`, following the same rules as a commit subject. CI puts the version in front of it, and the title becomes the commit on `main` when the PR is squash-merged. See [versioning.md](versioning.md).
- Each PR does one thing. Split large changes into several PRs so they are easy to review; when they build on each other, make them a [stack](#stacked-pull-requests).
- Base it on the latest `main`, with no conflicts. A PR in a stack is based on the branch below it instead.
- Fill in the template: what changed, why, and how you tested it.
- Before merging, check that the title and description still match the final change. Review often changes a PR along the way.
- Tests pass. If you change game rules, add unit tests.
- For UI changes, check them at phone width, attach screenshots, and look at both the Chinese and the English version.
- If you used an AI coding assistant, say which parts it generated in the template's "AI assistance" section. That section is for reviewers only. It is not attribution, and it does not end up in the commit message.
- You can open a **draft PR** before the work is finished to get early feedback.

How PRs are reviewed is described in [review.md](review.md).

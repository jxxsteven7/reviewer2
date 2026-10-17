# Branches, commits and pull requests

`main` is protected: nobody force-pushes or deletes it, and every change arrives through a pull request, squash-merged as one commit titled `vX.Y.Z <type>: <summary>`, or with no version for [docs for people](versioning.md#docs-for-people) alone ([versioning.md](versioning.md)). The one exception is an admin's commit of nothing but the lists of thanks, `ACKNOWLEDGMENTS.md` and `SPONSORS.md`, which goes to `main` directly, titled `docs: <summary>` with no version, such as `docs: thank a sponsor` ([maintainers.md](../maintainers.md#lists-of-thanks)). Nobody else commits or pushes to `main`, and AI assistants never do.

## Worktrees

Members work on a branch of their own, in a git worktree beside the main checkout (`reviewer2/`), which stays on `main`. A worktree is named after its branch with `/` as `-`. Install [Node.js](https://nodejs.org) ([../development.md](../development.md)), then, from the main checkout:

```bash
npm install                                   # also turns on the git hooks
git fetch origin
git worktree add ../feat-keywords-rules -b feat/keywords-rules origin/main
cd ../feat-keywords-rules && npm install
git push -u origin feat/keywords-rules
git fetch origin && git rebase origin/main    # when main moves
git push --force-with-lease                   # after a rebase, only on your own branch
```

After the merge, in the main checkout:

```bash
git switch main && git pull --ff-only
git worktree remove ../feat-keywords-rules
git branch -D feat/keywords-rules   # squash merges aren't seen as merged
git fetch --prune
```

A review worktree (`git worktree add --detach ../review-pr origin/main`) checks other branches out detached, `git switch --detach origin/feat/rooms`. In a worktree that switches branches, commit first, since all worktrees share one stash; never force the checkout of a branch another worktree has; `npm install` again if the lockfile differs.

## Stacked pull requests

A change too large for one PR becomes a chain of branches, one PR each, the bottom PR targeting `main`, the others the branch below. In their shared worktree, `git switch -c feat/keywords-online` starts the next branch where the last ends. Rebase from the top branch with `--update-refs` (Git 2.38 or later), which moves every branch along, then force-push the moved branches:

```bash
git rebase --update-refs feat/keywords-rules                      # after changing a lower branch
git fetch origin && git rebase --update-refs origin/main          # when main moves
git rebase --update-refs --onto origin/main feat/keywords-rules   # after the bottom PR was merged
```

## Local hooks

`npm install` turns on `.githooks/` (`git config core.hooksPath .githooks`) for every worktree. `pre-commit` and `pre-merge-commit` refuse commits on `main`, and elsewhere run `scripts/check-names.mjs` on the staged files ([constraints.md](constraints.md)); `commit-msg` runs `scripts/check-commits.mjs`, as CI does, refusing a bad format, Chinese text, AI attribution, the forbidden name or a version; `pre-push` refuses pushes to `main`. Never bypass them with `--no-verify`.

## Forks

1. Fork, clone your fork, and `git remote add upstream https://github.com/jxxsteven7/reviewer2.git`.
2. Branch from upstream, never from your fork's `main`: `git fetch upstream && git switch -c fix/lobby-typo upstream/main`.
3. Commit, push to your fork, and open a PR against `main` here, ticking **Allow edits by maintainers**. CI runs once a collaborator approves it.
4. Push review fixes to the same branch. When upstream moves: `git fetch upstream && git rebase upstream/main && git push --force-with-lease`.

## Branch names

`<type>/<short-description>`, lowercase English joined by `-`: `fix/reconnect-after-lock`, `words/ml`. Types: `feat`, `fix`, `words` (word lists), `docs`, `refactor`, `test`, `chore` (build, dependencies), `ci`, `perf`.

## Commit messages

```
fix: return players to their team after reconnecting

The reconnect handler looked players up by socket ID, which changes on
every reconnect. Look them up by their player token instead.
```

- Subject `<type>: <summary>`, with the types above and `revert`, which keeps the "This reverts commit <sha>." line.
- The summary is one imperative English sentence that stands on its own, lowercase or digit first, no final period, printable ASCII, at most 72 characters.
- The body, if any, says what changed and why, in English. No version: the PR title gets it.
- **No AI or agent attribution**: no `Co-Authored-By` trailers for AI tools, "Generated with" lines or session links, in commits, PR titles or descriptions; the committer is responsible for the content. `.claude/settings.json` turns Claude Code's off.

## Pull requests

- Title `<type>: <summary>`; CI puts the version in front, except for [docs for people](versioning.md#docs-for-people) alone, and the title becomes the commit on `main`.
- One thing per PR. A few small changes may share one branch, worktree and PR when a maintainer agrees; the description lists each.
- Based on the latest `main` (in a stack, the branch below), with no conflicts, and the template filled in and kept current.
- Tests pass; new game rules come with unit tests.
- A change to how anything players see looks or moves was shown to a maintainer before it was built, as screenshots and, for motion, short videos, at phone and computer width, in both languages, with invented data, and what the maintainer chose is what was built; the PR carries the final screenshots at phone width, in both languages, with invented data.
- The template's "AI assistance" section says which parts an assistant generated; it is for reviewers, not attribution.
- Draft PRs are welcome; see [review.md](review.md).

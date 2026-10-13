# Versioning

Every PR is squash-merged, so it lands on `main` as one commit, titled `vX.Y.Z <type>: <summary> (#N)` (with no version for [docs for people](#docs-for-people) alone), for example `v0.0.7 fix: keep players in their team (#12)`. GitHub adds the ` (#N)`. The whole title must fit in 72 characters, so keep PR titles to about 64.

| Part | Who changes it |
|---|---|
| `Z`, patch | CI: every merged PR adds one, except one that changes only [docs for people](#docs-for-people) |
| `Y`, minor | A maintainer, for a release with new features |
| `X`, major | A maintainer, for a milestone such as the first public release |

## How a PR gets its version

1. Title the PR `<type>: <summary>`, with no version.
2. The `Commits and version` check puts the next version in front of the title, again whenever the PR changes, and for every open PR after each merge to `main`. The previous version is the highest `vX.Y.Z` among the commit titles on `main` and the tags, or `v0.0.0`.
3. A collaborator merges with **Squash and merge**, with the PR title, version included, as the commit title; the repository settings ([../maintainers.md](../maintainers.md)) fill it in that way.

For a PR from a fork, which CI can't retitle, the check fails and prints the title it needs; a maintainer edits it in, and the check passes on its next run.

## Docs for people

A PR that changes only the docs written for people to read lands without a version: `ACKNOWLEDGMENTS.md`, `SPONSORS.md`, the two READMEs, `CONTRIBUTING.md`, and `docs/` apart from `docs/rules/`. Its title is `<type>: <summary>`, CI takes any version out of it, and its commit on `main` has none. A change to the rules (`docs/rules/`, `AGENTS.md`, `CLAUDE.md`, `words/README.md`), a license, or anything else takes a version as before. `UNVERSIONED_RE` in `scripts/check-commits.mjs` holds the list.

A maintainer's commit of the lists of thanks alone, which goes to `main` without a PR ([git.md](git.md)), has neither a version nor ` (#N)`. On `main`, the `Landed commits and release` check fails for any other commit without ` (#N)`.

## Minor and major versions

Only maintainers decide these: someone with the Admin or Maintain role edits the PR title to `vX.(Y+1).0` or `v(X+1).0.0` in place of the patch version. CI keeps it if a maintainer set it, and otherwise puts the patch version back with a warning. On a PR for the docs for people alone, CI takes it out like any other version. If another PR takes the number first, CI moves the title on.

Merging such a PR makes CI tag the commit `vX.Y.0` and publish a GitHub Release; if that run fails, the next run on `main` catches up. Patch versions get no tag or release. Once the root `package.json` exists, its `version` holds the minor line, `X.Y.0`: a minor or major PR updates it, patch PRs leave it alone, and CI checks this.

## Rules

- Branch commits carry no version; only the PR title does.
- Never skip, reuse or lower a number: CI accepts only the next patch, minor or major version.
- Nobody creates tags or releases by hand, and AI assistants never choose a minor or major version.
- `node scripts/check-commits.mjs next` (after `git fetch origin`) shows the next version, `--minor` or `--major` those.

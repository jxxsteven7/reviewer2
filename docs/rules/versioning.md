# Versioning

Every pull request is squash-merged, so each one lands on `main` as exactly one commit, and that commit carries the project's version.

## Format

Versions look like `vX.Y.Z`:

| Part | Name | Who changes it |
|---|---|---|
| `Z` | patch | CI, automatically: every merged PR adds one |
| `Y` | minor | A maintainer, for a release with new features, such as the first playable version |
| `X` | major | A maintainer, for a milestone, such as the first public release |

The commit on `main` is titled `vX.Y.Z <type>: <summary> (#N)`, for example `v0.0.7 fix: return players to their team after reconnecting (#12)`. GitHub adds the ` (#N)` when it merges. The title, version included, must fit in 72 characters, so keep PR titles to about 64.

## How a PR gets its version

1. Title your PR `<type>: <summary>`, like a commit subject. You don't need to work out the version.
2. The `Commits and version` check works out the next version and puts it in front of the title, for example `v0.0.7 fix: …`. It does this again whenever the PR is edited or updated. After every merge to `main`, CI also updates the titles of all open PRs, because each merge moves the next number on.
3. The maintainer merges with **Squash and merge**. The merge commit's title must be the PR title, version included. With the repository set up as in [github.md](github.md), GitHub fills it in that way.

The previous version is the highest `vX.Y.Z` in the titles of the commits on `main` or in the `vX.Y.Z` tags. When there is no version yet, it counts as `v0.0.0`.

## Minor and major versions

Only maintainers decide these. To make a PR a minor or major version, edit its title to start with that version instead of the patch version CI filled in:

- minor: `vX.(Y+1).0`, for example `v0.1.0 feat: play a full game of team word guessing`
- major: `v(X+1).0.0`, for example `v1.0.0 chore: open the game to the public`

CI keeps a legal minor or major version as it is. If another PR lands first and takes that number, CI moves the title on to the next version of the same kind.

When a PR with a new minor or major version is merged, CI tags the commit `vX.Y.0` and publishes a GitHub Release with notes generated from the merged PRs. Patch versions get no tag and no release. They exist only in the commit titles on `main`.

Once the root `package.json` exists, its `version` field holds the current minor line, `X.Y.0`. A PR that changes the minor or major version also updates `package.json`, and patch PRs leave it alone. CI checks this.

## Rules

- Branch commits carry **no** version. Only the PR title, and so the commit on `main`, has one.
- Don't skip, reuse or lower a number. CI accepts only the next patch, minor or major version.
- CI creates tags and releases. Nobody creates them by hand, and AI assistants never choose a minor or major version.
- To see the next version locally, run `git fetch origin && node scripts/check-commits.mjs next`. Add `--minor` or `--major` to see those instead.

## Pull requests from forks

GitHub doesn't let CI edit the title of a PR from a fork. For such a PR, the `Commits and version` check fails and prints the exact title the PR needs. A maintainer edits the title, and the check passes on its next run. CI also updates the title after the next merge to `main`.

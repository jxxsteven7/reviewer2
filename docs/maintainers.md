# Maintainer guide

How `main` is protected on GitHub.

## Branch protection

**Settings → Rules → Rulesets → New branch ruleset** `protect-main`: enforcement **Active**, no bypass list, targeting the default branch, with these rules:

- Restrict deletions; Block force pushes.
- Require a pull request before merging: required approvals **1**, dismiss stale approvals when new commits are pushed, require review from Code Owners, require approval of the most recent reviewable push, require conversation resolution, allowed merge method **Squash** only.
- Require status checks to pass: `Commits and version`, `Script tests` and `Forbidden name` from `conventions.yml`; `README sync` from `docs.yml`; `Lint and types`, `Tests`, `Lowest Node`, `Word lists`, `End-to-end` (summing up the per-browser jobs) and `Build` from `ci.yml`.
- Require branches to be up to date before merging, so that `Commits and version` reruns after every merge and two PRs can't land with the same version.

## Maintainers

A maintainer has the **Admin** or **Maintain** role; CI uses it to decide who may set a minor or major version ([rules/versioning.md](rules/versioning.md)). Every collaborator with the Write role may merge a PR that is approved and green; others contribute from a fork.

## Repository settings

- **General → Pull Requests**: only **Allow squash merging**, with the default commit message **Pull request title**; **Automatically delete head branches** on.
- **Actions → General → Fork pull request workflows**: "Require approval for all external contributors". A PR from a fork runs CI once a collaborator approves the run, also while the repository is private.
- **Code security → Private vulnerability reporting**: on, once the repository is public.
- `.github/CODEOWNERS` names the default reviewers.
- Default workflow permissions stay read-only; the Conventions workflow asks for its own.

## Notes

- Rulesets are enforced on this private repository.
- GitHub doesn't let you approve your own PR, so while there is one maintainer: required approvals 0, Require review from Code Owners and Require approval of the most recent reviewable push off, Require a pull request kept, and a review left on each PR. Switch back with a second maintainer. Until then, GitHub doesn't enforce the approval: a collaborator with the Write role merges only a PR that someone else has approved.
- Local hooks can't check GitHub's merge commit: the merge form must show the PR title, version included, or the `Landed commits and release` job on `main` fails.

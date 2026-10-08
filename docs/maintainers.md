# Maintainer guide

Settings and tasks for the people who maintain the repository. This file records how `main` is protected on GitHub; update it whenever the settings change.

## Branch protection

**Settings → Rules → Rulesets → New ruleset → New branch ruleset**

- Ruleset name: `protect-main`
- Enforcement status: **Active**
- Bypass list: empty, with no exception for admins
- Target branches: Add target → **Include default branch**
- Enable these rules:
  - Restrict deletions
  - Block force pushes
  - Require a pull request before merging, with:
    - Required approvals: **1**
    - Dismiss stale pull request approvals when new commits are pushed
    - Require review from Code Owners
    - Require approval of the most recent reviewable push
    - Require conversation resolution before merging
  - Require status checks to pass, with these checks. GitHub only lists a check after it has run at least once.
    - `Commits and version`, `Script tests` and `Forbidden name`, from `.github/workflows/conventions.yml`
    - `README sync`, from `.github/workflows/docs.yml`
    - `Lint and types`, `Tests`, `Word lists`, `End-to-end` and `Build`, from `.github/workflows/ci.yml`
  - Require branches to be up to date before merging. This one matters for versioning: once another PR has merged, a PR's `Commits and version` result is older than `main`, and without this rule two PRs could land with the same version. Updating the branch runs the check again, and the check retitles the PR to the version that is now next.

## Maintainers

A maintainer is anyone with the **Admin** or **Maintain** role on the repository (**Settings → Collaborators and teams**). CI uses the role to decide who may give a PR a minor or major version: when anyone else sets one, the `Commits and version` check puts the next patch version back and says so in a warning.

## Merging

**Settings → General → Pull Requests**

- Leave only **Allow squash merging** turned on, and set its default commit message to **Pull request title**. The squashed commit then contains only the PR title, so the PR description never ends up in a commit message.
- Turn on **Automatically delete head branches**.

## Outside contributions

- **Settings → Actions → General → Fork pull request workflows**: choose "Require approval for all external contributors".
- **Settings → Code security → Private vulnerability reporting**: turn it on once the repository is public.

## Notes

- On GitHub Free, rulesets are **not enforced on private repositories**. Enforcement needs GitHub Pro or Team, or starts once the repository is public. Until then, only the local hooks and everyone's discipline protect `main`.
- GitHub doesn't let you approve your own PR. While there is only one maintainer, the review settings above would make the maintainer's own PRs impossible to merge. During that period, set Required approvals to 0, and turn off Require review from Code Owners and Require approval of the most recent reviewable push. The last one needs approval from someone other than the person who pushed, whatever the number of required approvals. Keep Require a pull request so that every change still goes through a PR. The maintainer reviews each PR and leaves a record of the review on it. Switch the settings back as soon as there is a second maintainer.
- `.github/CODEOWNERS` decides who is asked to review by default. As the team grows, assign owners per directory, for example `words/` to whoever looks after the word lists.
- Local hooks can't check the commit that GitHub creates when merging. Before merging, make sure the merge form shows the PR title, version included. After the merge, the `Landed commits and release` job on `main` checks the commit and fails if its title is wrong.
- The Conventions workflow edits PR titles and creates tags and releases with the built-in `GITHUB_TOKEN`. It asks for those permissions itself, so the default workflow permissions under **Settings → Actions → General** can stay read-only.

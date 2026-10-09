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
    - Allowed merge methods: **Squash** only
  - Require status checks to pass, with these checks. GitHub only lists a check after it has run at least once.
    - `Commits and version`, `Script tests` and `Forbidden name`, from `.github/workflows/conventions.yml`
    - `README sync`, from `.github/workflows/docs.yml`
    - `Lint and types`, `Tests`, `Lowest Node`, `Word lists`, `End-to-end` and `Build`, from `.github/workflows/ci.yml`. `End-to-end` sums up the `End-to-end on …` jobs, one per browser project, which are not required on their own
  - Require branches to be up to date before merging. This one matters for versioning: once another PR has merged, a PR's `Commits and version` result is older than `main`, and without this rule two PRs could land with the same version. Updating the branch runs the check again, and the check retitles the PR to the version that is now next.

### Only admins merge

A second branch ruleset lets only admins merge into `main`:

- Ruleset name: `only-admins-merge`
- Enforcement status: **Active**
- Bypass list: **Repository admin**, set to **For pull requests only**
- Target branches: **Include default branch**
- Enable one rule: **Restrict updates**

Nobody may update `main` under this ruleset, so every merge needs a bypass, and only admins have one. To merge a PR that is approved and whose checks have passed, an admin chooses to bypass the rules in the merge box. The bypass covers this ruleset alone: `protect-main` has an empty bypass list, so its checks, its review settings and squash merging still hold for admins. Collaborators with the Write or Maintain role can push branches and open PRs, but can't merge them.

## Maintainers

A maintainer is anyone with the **Admin** or **Maintain** role on the repository (**Settings → Collaborators and teams**). CI uses the role to decide who may give a PR a minor or major version: when anyone else sets one, the `Commits and version` check puts the next patch version back and says so in a warning. Only admins merge; see [Only admins merge](#only-admins-merge).

## Merging

**Settings → General → Pull Requests**

- Leave only **Allow squash merging** turned on, and set its default commit message to **Pull request title**. The squashed commit then contains only the PR title, so the PR description never ends up in a commit message.
- Turn on **Automatically delete head branches**.

## Outside contributions

- **Settings → Actions → General → Fork pull request workflows**: choose "Require approval for all external contributors".
- While the repository is private, **Run workflows from fork pull requests** stays off, so a PR from a fork can't pass the required checks. Collaborators push their branches to this repository instead. Once the repository is public, GitHub runs the workflows of PRs from forks, after the approval above.
- **Settings → Code security → Private vulnerability reporting**: turn it on once the repository is public.

## Notes

- Rulesets are enforced on this repository while it is private: with `only-admins-merge` active, every open PR is blocked from merging until an admin bypasses it.
- GitHub doesn't let you approve your own PR. While there is only one maintainer, the review settings above would make the maintainer's own PRs impossible to merge. During that period, set Required approvals to 0, and turn off Require review from Code Owners and Require approval of the most recent reviewable push. The last one needs approval from someone other than the person who pushed, whatever the number of required approvals. Keep Require a pull request so that every change still goes through a PR. The maintainer reviews each PR and leaves a record of the review on it. Switch the settings back as soon as there is a second maintainer.
- `.github/CODEOWNERS` decides who is asked to review by default. As the team grows, assign owners per directory, for example `words/` to whoever looks after the word lists.
- Local hooks can't check the commit that GitHub creates when merging. Before merging, make sure the merge form shows the PR title, version included. After the merge, the `Landed commits and release` job on `main` checks the commit and fails if its title is wrong.
- The Conventions workflow edits PR titles and creates tags and releases with the built-in `GITHUB_TOKEN`. It asks for those permissions itself, so the default workflow permissions under **Settings → Actions → General** can stay read-only.

# Maintainer guide

How `main` is protected on GitHub, how the lists of thanks go to it, and the token that keeps the sponsors up to date.

## Branch protection

**Settings → Rules → Rulesets → New branch ruleset**, twice, both with enforcement **Active** and targeting the default branch.

`protect-main-history`, with no bypass list:

- Restrict deletions; Block force pushes.

`protect-main`, with **Repository admin** on the bypass list, **Always allow**, for the [lists of thanks](#lists-of-thanks):

- Require a pull request before merging: required approvals **1**, dismiss stale approvals when new commits are pushed, require review from Code Owners, require approval of the most recent reviewable push, require conversation resolution, allowed merge method **Squash** only.
- Require status checks to pass: `Checks` and `End-to-end` (summing up the per-browser jobs) from `ci.yml`; `Commits and version` and `Forbidden name` from `conventions.yml`.
- Require branches to be up to date before merging, so that `Commits and version` reruns after every merge and two PRs can't land with the same version.

A bypass lets its actors past every rule of its ruleset, so the two rules that nobody may get past are in a ruleset without one.

A PR that renames or removes a required check needs the list changed right before it merges: a name that no job reports any more keeps every PR waiting. For the PR that brought `Lint and types`, `Tests`, `Lowest Node`, `Build`, `Word lists` and `README sync` together in `Checks`: in `protect-main`, under **Require status checks to pass**, remove those six, **Add checks** `Checks`, and **Save changes**; then merge it. A PR from before it gets `Checks` once it is brought up to date with `main`, which the ruleset asks for anyway.

## Maintainers

A maintainer has the **Admin** or **Maintain** role; CI uses it to decide who may set a minor or major version ([rules/versioning.md](rules/versioning.md)). Every collaborator with the Write role may merge a PR that is approved and green; others contribute from a fork.

## Repository settings

- **General → Pull Requests**: only **Allow squash merging**, with the default commit message **Pull request title**; **Allow auto-merge** and **Automatically delete head branches** on.
- **Actions → General → Fork pull request workflows**: "Require approval for all external contributors". A PR from a fork runs CI once a collaborator approves the run, also while the repository is private.
- **Code security → Private vulnerability reporting**: on, once the repository is public.
- `.github/CODEOWNERS` names the default reviewers.
- Default workflow permissions stay read-only; the Conventions and Issues workflows ask for their own.

## Issues

Anyone opens an issue with one of the forms in `.github/ISSUE_TEMPLATE/`; `config.yml` turns blank issues off, so that is the only way for anyone below the Write role (those with Write and above still see **Blank issue**, marked "Maintainers only", and `gh issue create` and the API ignore the forms). Each form sets a label and a title prefix:

| Form | Label | Title | For |
|---|---|---|---|
| Idea | `idea` | `Idea: ` | A new feature or a change: the site, a game's rules or the AI players |
| New game | `new game` | `New game: ` | The next game to make |
| Bug report | `bug` | `Bug: ` | Something that doesn't work as it should |
| Word lists | `words` | `Word lists: ` | Terms, a field or a fix for the word lists |
| Code and docs | `code` | `Code: ` | Refactoring, performance, tests, CI, dependencies or the docs: what players don't see |

Each form ends with a dropdown on how to list the author on the site if the issue is adopted: by their GitHub username, or as an anonymous player. The labels' descriptions on GitHub are their definitions, for people and scripts alike. Two more labels say where an issue stands: `player feedback`, on every issue published from a player's feedback ([development.md](development.md#accounts-and-email)), which the maintainer opens on the player's behalf, so its reporter won't see replies on GitHub; and `adopted`, on every issue listed among the contributions on the site, from either place. The other labels are GitHub's defaults, as they are. The chooser also links to the site's feedback form, for players, to private vulnerability reporting, and to CONTRIBUTING.md.

Issues and comments may be in English or Chinese ([rules/language.md](rules/language.md)), but never name the board game that the first game is based on ([rules/constraints.md](rules/constraints.md#intellectual-property)): `.github/workflows/issues.yml` runs `scripts/check-names.mjs` on every issue and comment as it is opened or edited, with the text passed through the environment, never into a script, and asks the author once, in a comment, to edit the name out; a maintainer edits what is left.

### Adopting a contribution

A contribution is adopted on the server's data, with `admin.cjs`, where the home page reads it at once ([architecture.md](architecture.md#feedback-contributions)); the issue is labeled `adopted` and closed.

- **A player's feedback**, published as an issue with `player feedback`: `feedback adopt <id>` once the pull request that resolved it is in, which lists it by the account or the name the player left, or anonymously, and counts it for their account.
- **A developer's issue**: `github adopt <issue> --kind <kind> --login <author> --id <account id> [--anonymous] --zh … --en …`, with the kind from the issue's label (`idea`, `new game` is `game`, `bug`, `words`, `code`), the author's username and account id from GitHub (`gh api repos/{owner}/{repo}/issues/<n> --jq '.user.login, .user.id'`), `--anonymous` when the author chose so in the form's last dropdown, and the two sentences on what they contributed. An issue that a maintainer opened is no contribution, unless it relays someone else's report, which is then adopted under the reporter's name. An author who also fixed their issue in a pull request is listed for the issue all the same; the pull request is GitHub's to credit. At the author's request, `github anonymous` lists them anonymously from then on, and `github forget` also drops their username and id; nothing is ever deleted.
- **A security problem** reported through private vulnerability reporting is a draft advisory, `GHSA-xxxx-xxxx-xxxx`, that only the maintainers and the reporter see. Fix it and release the fix without a word in public, then publish the advisory, with the reporter credited on it if they agree, and adopt it as a bug: `github adopt --advisory GHSA-… --kind bug --login <reporter> --id <id> [--anonymous] --zh … --en …`; the home page links the advisory in place of an issue. A security problem that a player reports through the site's feedback is not published as an issue until it is fixed, and then goes the ordinary way.

## Lists of thanks

A maintainer with the Admin role may commit a change to nothing but `ACKNOWLEDGMENTS.md` and `SPONSORS.md` to `main` directly, without a PR ([rules/git.md](rules/git.md)). The daily update of the sponsors on GitHub still comes as a PR ([Sponsors](#sponsors)).

1. **Once:** create `protect-main-history` with Restrict deletions and Block force pushes, take those two rules out of `protect-main`, and there **Bypass list → Add bypass → Repository admin**, set to **Always allow**, and **Save changes** ([Branch protection](#branch-protection)). Or with `gh`, in a checkout; 5 is the ID of the Repository admin role, so check afterwards that the page of `protect-main` lists it:

   ```bash
   gh api -X POST 'repos/{owner}/{repo}/rulesets' --input - <<'EOF'
   {"name": "protect-main-history", "target": "branch", "enforcement": "active",
    "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
    "rules": [{"type": "deletion"}, {"type": "non_fast_forward"}]}
   EOF
   id=$(gh api 'repos/{owner}/{repo}/rulesets' --jq '.[] | select(.name == "protect-main") | .id')
   gh api "repos/{owner}/{repo}/rulesets/$id" \
     --jq '{name, target, enforcement, conditions, rules: [.rules[] | select(.type != "deletion" and .type != "non_fast_forward")], bypass_actors: [{actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always"}]}' |
     gh api -X PUT "repos/{owner}/{repo}/rulesets/$id" --input -
   ```

2. To check a change first, make it in a checkout of `main` and run `npx vitest run server/src/thanks.test.ts`, which names each line that breaks the rules ([development.md](development.md#acknowledgments)).
3. On GitHub, open the file on `main`, edit it, and **Commit changes...** with the message `docs: <summary>`, such as `docs: thank a sponsor`: in English, with no version or `(#N)`. Choose **Commit directly to the `main` branch** and tick the box that bypasses the rules. The local `pre-push` hook refuses every push to `main`, so these commits are made on GitHub.

A list that breaks the rules doesn't stop the server: a copy in `CONTENT_DIR` that breaks them leaves the one that the build bundled on the home page, and the log says why (`thanks_list_skipped`). The build takes the lists from `main` as they are, though: on `main`, the `Checks` job fails, and until another commit fixes the list, a build from `main` shows it without the entries that break the rules. Any other commit without ` (#N)`, of another file, of another type or with a version, fails `Landed commits and release`. The check reads only the title, so a commit that skipped its PR shows at once unless its title ends in ` (#N)` like a squash merge's. The bypass also puts a box on the merge form of every PR, for admins, that merges without the approval and the checks: never tick it; the bypass is for the lists alone.

## Sponsors

The Sponsors workflow (`.github/workflows/sponsors.yml`) needs the repository secret `SPONSOR_TOKEN`: a fine-grained personal access token of the sponsored maintainer.

1. **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**: owner the maintainer, an expiry date, **Only select repositories** with this one, and the repository permissions **Contents** and **Pull requests**, both **Read and write**. No account permissions.
2. In this repository, **Settings → Secrets and variables → Actions → New repository secret** `SPONSOR_TOKEN`.
3. **Actions → Sponsors → Run workflow** once to try it.

The token reads the sponsors of its owner without an account permission because the query asks only for their usernames, and leaves the filtering and sorting to `includePrivate: false` and `orderBy`; a sponsorship's privacy, start or status would need the profile permission (`read:user` on a classic token). Pushing the branch and opening the PR as the maintainer makes CI run on it, which GITHUB_TOKEN's wouldn't, and keeps everyone else out of the commit; auto-merge needs **Allow auto-merge**. When the token expires or loses a permission, the run fails with GitHub's reason: make a new one and replace the secret.

## Notes

- Rulesets are enforced on this private repository.
- GitHub doesn't let you approve your own PR, so while there is one maintainer: required approvals 0, Require review from Code Owners and Require approval of the most recent reviewable push off, Require a pull request kept, and a review left on each PR. Switch back with a second maintainer. Until then, GitHub doesn't enforce the approval: a collaborator with the Write role merges only a PR that someone else has approved.
- A maintainer's own PR that changes only [docs for people](rules/versioning.md#docs-for-people) needs no approval ([rules/review.md](rules/review.md)). Once `Commits and version` has passed on its final title, **Enable auto-merge**, and GitHub merges it when the other checks pass. Auto-merge stays on when someone with write access pushes to the PR, so turn it off before pushing a change to anything but the docs for people.
- Required approvals count for every PR, whatever it changes. To keep that exception after switching back with a second maintainer, leave required approvals at 0, give the docs for people no owner in `.github/CODEOWNERS`, and let Require review from Code Owners ask for an approval on everything else. Try it on a PR before relying on it.
- Local hooks can't check GitHub's merge commit: the merge form must show the PR title, with its version if it has one, followed by the ` (#N)` that GitHub adds, or the `Landed commits and release` job on `main` fails.

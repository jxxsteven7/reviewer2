# Code review

All code is reviewed. Code written by people or by AI, by members or by outside contributors, must be reviewed and approved by someone other than its author before it is merged. Docs, word lists and one-line changes are no exception.

## Rules

- Every PR needs approval from **at least one person other than its author** before it can be merged. For the interim arrangement while there is only one maintainer, see the [maintainer guide](../maintainers.md).
- If new commits are pushed after approval, the PR needs another review.
- Respond to every review comment: either make the change, or explain your reasoning and reach agreement with the reviewer. All conversations must be resolved before merging.
- PRs are always merged with **Squash and merge**, by a repository admin, once they are approved and all checks pass. GitHub enforces this: nobody else can merge into `main`, members included. See the [maintainer guide](../maintainers.md#only-admins-merge).
- When merging, check that the merge form uses the PR title, version included, as the commit title. See [versioning.md](versioning.md).
- Only maintainers decide on a minor or major version.

## When to approve

Approve a PR once it clearly makes the project better, even if it isn't perfect. There is no perfect code, only better code. Hold a PR back for problems that make the project worse, not for improvements that could come in a later PR. Mark those as `nit:` or suggest a follow-up.

## Settling disagreements

- Technical facts and data outweigh opinions and personal preferences.
- On style, the rules in `docs/rules/` decide. Where they say nothing, stay consistent with the existing code. Where there is no existing code to follow, the author decides.
- Design is almost never just a matter of style. Weigh it on its merits and explain your reasoning.
- If the author and the reviewer still disagree, ask a maintainer to decide in the PR. Don't let a PR stall.

These two sections are adapted from Google's [The Standard of Code Review](https://google.github.io/eng-practices/review/reviewer/standard.html), licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).

## AI-written code

You may use AI coding assistants, on these conditions:

- **You are fully responsible for every line the AI wrote.** Before opening a PR, read it line by line as if you were reviewing someone else's code, make sure you understand it, and run it yourself.
- Say which parts were AI-generated in the "AI assistance" section of the PR template. Commit messages carry no AI attribution; see [git.md](git.md#commit-messages).
- An AI review, such as Claude Code's `/code-review` or asking Codex to review against this file, is a useful extra, but it **does not replace human review**. AI-written code still needs approval from someone other than its author.
- AI assistants never merge PRs.

## What to check

First check that the change is right, then that it is good:

1. **Correctness.** Is the logic right? Are edge cases handled, such as dropped connections, repeated clicks and two players acting at once? Do the tests cover it?
2. **Hard constraints.** Go through [constraints.md](constraints.md) item by item.
3. **Changes to the rules and their checks.** CI runs the checks as the PR has them, so a PR that changes `.github/`, `.githooks/`, `scripts/`, `.claude/`, `AGENTS.md`, `CLAUDE.md` or `docs/rules/` can also loosen the checks it has to pass. The same goes for the files that define what those checks run, such as the scripts in `package.json` and the lint, type and test configurations. Read such changes line by line, and make sure the PR says why it needs them.
4. **Readability.** Names are clear, the code matches its surroundings, and there is no unnecessary complexity.
5. **Scope.** The PR does what it says and nothing unrelated.
6. **Language.** Code, comments, docs and the PR title are in clear, correct English. If one README changed, the other matches. See [language.md](language.md).
7. **PR title.** It reads `vX.Y.Z <type>: <summary>`, with the version CI filled in or a minor or major version a maintainer chose, and it has no AI or agent attribution.

Make the weight of each comment clear. State required changes directly, and prefix optional suggestions with `nit:` so the author knows they can skip them.

**Don't be Reviewer 2.** Keep comments specific and actionable, and about the code rather than the person.

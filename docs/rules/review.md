# Code review

All code is reviewed. Code written by people or by AI, by members or by outside contributors, must be reviewed and approved by someone other than its author before it is merged. Docs, word lists and one-line changes are no exception.

## Rules

- Every PR needs approval from **at least one person other than its author** before it can be merged. For the interim arrangement while there is only one maintainer, see the [maintainer guide](../maintainers.md).
- If new commits are pushed after approval, the PR needs another review.
- Respond to every review comment: either make the change, or explain your reasoning and reach agreement with the reviewer. All conversations must be resolved before merging.
- PRs are always merged with **Squash and merge**. Members may merge their own PR once it is approved and all checks pass. PRs from outside contributors are merged by a maintainer.
- When merging, check that the merge form uses the PR title, version included, as the commit title. See [versioning.md](versioning.md).
- Only maintainers decide on a minor or major version.

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
3. **Readability.** Names are clear, the code matches its surroundings, and there is no unnecessary complexity.
4. **Scope.** The PR does what it says and nothing unrelated.
5. **Language.** Code, comments, docs and the PR title are in clear, correct English. If one README changed, the other matches. See [language.md](language.md).
6. **PR title.** It reads `vX.Y.Z <type>: <summary>`, with the version CI filled in or a minor or major version a maintainer chose, and it has no AI or agent attribution.

Make the weight of each comment clear. State required changes directly, and prefix optional suggestions with `nit:` so the author knows they can skip them.

**Don't be Reviewer 2.** Keep comments specific and actionable, and about the code rather than the person.

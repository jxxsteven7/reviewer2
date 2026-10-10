# Code review

Someone other than the author approves every change before it is merged, whether by people or by AI, docs and word lists alike. The one exception is a maintainer's own PR that changes only [docs for people](versioning.md#docs-for-people), which merges once the checks pass.

## Rules

- At least one approval, renewed after new commits, except on a maintainer's own PR for the docs for people. For the interim with one maintainer, and for auto-merge, see the [maintainer guide](../maintainers.md).
- Answer every comment, by changing or by explaining until you agree, and resolve all conversations before merging.
- A collaborator with write access merges with **Squash and merge**, once the PR is approved and the checks pass, with the PR title, and its version if it has one, as the commit title ([versioning.md](versioning.md)).
- Only maintainers set a minor or major version.

## When to approve

Approve once the PR clearly makes the project better. Hold it back only for problems that make the project worse; improvements for a later PR are `nit:`.

## Settling disagreements

Facts and data outweigh opinions. On style, `docs/rules/` decides, then the existing code, then the author. Design is weighed on its merits, with reasons. Still disagreeing, ask a maintainer to decide in the PR.

These two sections are adapted from Google's [The Standard of Code Review](https://google.github.io/eng-practices/review/reviewer/standard.html), licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).

## AI-written code

- You are responsible for every line the AI wrote: read, understand and run it before opening the PR.
- Say which parts were AI-generated in the PR template's "AI assistance" section. Commits carry no AI attribution ([git.md](git.md#commit-messages)).
- An AI review, such as `/code-review`, is a useful extra and never replaces human review. AI assistants never merge.

## What to check

1. **Correctness:** logic, tests, and edge cases such as dropped connections, repeated clicks and two players acting at once.
2. **Hard constraints**, item by item ([constraints.md](constraints.md)).
3. **Changes to the checks.** CI runs the checks as the PR has them, so a PR that changes `.github/`, `.githooks/`, `scripts/`, `.claude/`, `AGENTS.md`, `CLAUDE.md`, `docs/rules/` or the lint, type, test and `package.json` configuration can loosen them. Read every line; the PR says why.
4. **Readability:** clear names, consistent with its surroundings, no needless complexity.
5. **Scope:** the PR does what it says and nothing else.
6. **Language:** clear, correct English everywhere; if one README changed, the other matches ([language.md](language.md)).
7. **PR title:** `vX.Y.Z <type>: <summary>`, with CI's version or a maintainer's (none for [docs for people](versioning.md#docs-for-people) alone), and no AI attribution.

State required changes directly; prefix optional ones `nit:`. **Don't be Reviewer 2:** be specific, actionable, and about the code, not the person.

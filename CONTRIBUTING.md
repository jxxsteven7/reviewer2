# Contributing to Reviewer 2

Thank you for helping out! This file is the entry point to the project's rules. They apply to everyone: project members, outside contributors and AI coding assistants.

## Core rules

1. **`main` is protected.** Nobody, maintainers included, commits directly to `main`, pushes to it, force-pushes it or deletes it. Every change reaches `main` through a pull request.
2. **Work in your own worktree and branch.** Project members create a new branch and a matching git worktree for each piece of work, and keep the main checkout on `main`. Outside contributors fork the repository and work on a branch in their fork.
3. **All code is reviewed.** Code written by people or by AI, by members or by outside contributors, must be reviewed and approved by someone other than its author before it is merged. Docs, word lists and one-line changes are no exception.
4. **No AI or agent attribution in commits.** No `Co-Authored-By` trailers for AI tools, no "Generated with" lines, no links to AI sessions. The committer is responsible for the content.
5. **The repository is written in English.** Code, comments, commit messages, pull requests, docs and rules use clear, standard English. The only translated document is `README.zh-CN.md`, and CI keeps it in sync with `README.md`.
6. **Every pull request is squash-merged and versioned.** It lands on `main` as one commit titled `vX.Y.Z <type>: <summary>`. CI raises the patch number by one for every PR; maintainers decide when the minor or major number goes up.

## Rule files

The detailed rules are split by topic and shared by people and AI assistants:

| File | Covers |
|---|---|
| [docs/rules/git.md](docs/rules/git.md) | Worktree workflow, fork workflow, branch names, commit messages, PR requirements, local hooks |
| [docs/rules/versioning.md](docs/rules/versioning.md) | Version numbers, how a PR gets its version, minor and major versions, tags and releases |
| [docs/rules/review.md](docs/rules/review.md) | Review rules, when to approve, settling disagreements, AI-written code, what reviewers check |
| [docs/rules/constraints.md](docs/rules/constraints.md) | Hard constraints: access from mainland China, intellectual property, game state, UI, secrets |
| [docs/rules/language.md](docs/rules/language.md) | English in the repository, keeping the two READMEs in sync |
| [words/README.md](words/README.md) | The word library shared by all games: format, what makes a good term, how to contribute |
| [docs/maintainers.md](docs/maintainers.md) | For maintainers: GitHub repository settings |

## Working with AI assistants

- **Codex** reads [AGENTS.md](AGENTS.md) automatically.
- **Claude Code** reads [CLAUDE.md](CLAUDE.md) automatically. That file only imports `@AGENTS.md`, so both tools follow the same rules.
- `AGENTS.md` lists what AI assistants must always do and points to the rule files above.

To bring a specific rule into a conversation, reference its file with `@` in Claude Code or Codex:

```
@docs/rules/review.md review the changes on this branch against this checklist
@docs/rules/constraints.md can we use this new dependency?
@words/README.md check words/ml.json
```

## Issues

- Use GitHub Issues for tasks, bugs and ideas.
- For larger changes, open an issue to discuss the approach before writing code.
- When reporting a bug, include the device and browser (and whether the page was opened inside WeChat), the steps to reproduce, what you expected and what happened.

## Security

If you find a security issue, such as a way to see card colors you shouldn't be able to see or to impersonate another player, please do **not** open a public issue. Report it privately with **Report a vulnerability** on the repository's Security tab.

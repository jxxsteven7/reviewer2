# Contributing to Reviewer 2

These rules apply to everyone: project members, outside contributors and AI coding assistants.

## Core rules

1. **`main` is protected.** Every change arrives through a pull request. The one exception is a maintainer's commit of the lists of thanks, `ACKNOWLEDGMENTS.md` and `SPONSORS.md`, which goes to `main` directly ([docs/rules/git.md](docs/rules/git.md)).
2. **Work on a branch of your own.** Members use a git worktree per piece of work; outside contributors fork the repository.
3. **All code is reviewed.** Someone other than the author approves every PR, docs included; a collaborator merges it once CI passes. A maintainer's own PR that changes only [docs for people](docs/rules/versioning.md#docs-for-people) needs no approval.
4. **No AI or agent attribution** in commits, PR titles or PR descriptions. The committer is responsible for the content.
5. **Everything in the repository is in English.** The only translated file is `README.zh-CN.md`, which CI keeps in sync with `README.md`.
6. **Every PR is squash-merged as one commit**, titled `vX.Y.Z <type>: <summary>`. CI adds the patch version; maintainers decide minor and major ones. A PR that changes only [docs for people](docs/rules/versioning.md#docs-for-people) has no version.

## Rule files

| File | Covers |
|---|---|
| [docs/rules/git.md](docs/rules/git.md) | Worktrees, stacks, forks, branch names, commit messages, pull requests, local hooks |
| [docs/rules/versioning.md](docs/rules/versioning.md) | How a PR gets its version; minor and major versions |
| [docs/rules/review.md](docs/rules/review.md) | How PRs are reviewed, AI-written code, what reviewers check |
| [docs/rules/constraints.md](docs/rules/constraints.md) | Hard constraints: mainland China, intellectual property, game state, UI, secrets, the live deployment |
| [docs/rules/language.md](docs/rules/language.md) | English in the repository; keeping the two READMEs in sync |
| [docs/development.md](docs/development.md) | Running and testing the app on your machine |
| [words/README.md](words/README.md) | The word library: format, good terms, how to contribute |
| [docs/maintainers.md](docs/maintainers.md) | For maintainers: the repository's GitHub settings |

## AI assistants

Codex reads [AGENTS.md](AGENTS.md); Claude Code reads it through `CLAUDE.md`. Point any other assistant at the file first. Bring a rule into a chat with `@`, for example `@docs/rules/review.md`. You are responsible for an assistant's work as for your own, and say which parts it generated in the PR template's "AI assistance" section.

## Issues

Use GitHub Issues for bugs, tasks and ideas, and open one before a large change. A bug report names the device and browser, whether the page was opened in WeChat, the steps, what you expected and what happened.

## Security

Don't open a public issue for a security problem, such as a way to see card colors you shouldn't or to impersonate a player. Use **Report a vulnerability** on the repository's Security tab.

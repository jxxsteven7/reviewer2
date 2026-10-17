# AGENTS.md

Rules for AI coding assistants. Codex reads this file itself; Claude Code loads it through `CLAUDE.md`. Read these rule files first (Claude Code expands the `@` references), and `words/README.md` for word lists.

@docs/rules/git.md
@docs/rules/versioning.md
@docs/rules/review.md
@docs/rules/constraints.md
@docs/rules/language.md

## Always

- **Never work on `main`.** Work in a worktree on a branch of your own (`docs/rules/git.md`); create them if needed. Never commit or push to `main`, not even the lists of thanks, which only an admin commits there; never force-push other people's branches or bypass hooks with `--no-verify`.
- **No AI or agent attribution**: no `Co-Authored-By` trailers for AI tools, "Generated with" lines or session links in commits, PR titles or descriptions. Remove any your tool adds.
- **Leave versions to CI and maintainers.** Commit subjects and PR titles are `<type>: <summary>`, with no version. Never choose a minor or major version or create tags or releases.
- **Run the checks** before you push: `npm run lint`, `npm run typecheck` and `npm test`; after changing the interface or a game's flow, also `npm run build && npm run test:e2e`.
- **Get reviewed, never merge.** Review your own changes, push the branch, open a PR, and stop for human review. Your own review is not the required one.
- **Write in English**, everything in the repository. If you change one README, update the other and run `node scripts/check-readme-sync.mjs --update`.
- **Show visual changes first.** Before changing how anything players see looks or moves, show a maintainer screenshots, and short videos for motion, at phone and computer width, in both languages, with invented data; build what they choose, and put the final screenshots, at phone width, in both languages, with invented data, in the PR (`docs/rules/git.md`).
- **Follow the hard constraints** in `docs/rules/constraints.md`. Above all, never write the name of the board game the first game is based on, or how the project's own servers are run.

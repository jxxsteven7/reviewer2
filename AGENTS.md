# AGENTS.md

Project rules for AI coding assistants such as Codex and Claude Code. Codex reads this file automatically. Claude Code loads it through `CLAUDE.md`.

## Rule files

The project rules live in `docs/rules/` and are shared by people and AI assistants. Read the five files below before you start. Claude Code expands the `@` references automatically; other assistants should open and read the files.

@docs/rules/git.md
@docs/rules/versioning.md
@docs/rules/review.md
@docs/rules/constraints.md
@docs/rules/language.md

When working on word lists, also read `words/README.md`.

## Always

- **Never work on `main`.** Before changing any file, make sure you are in a worktree on a branch of your own, as described in `docs/rules/git.md`; create them if the work has none yet. Make your changes there. Do not commit to `main`, push to `main`, force-push other people's branches, or bypass hooks with `--no-verify`.
- **Never add AI or agent attribution.** Commit messages, PR titles and PR descriptions must not contain `Co-Authored-By` trailers for AI tools, "Generated with" lines or session links. If your tool adds them by default, remove them.
- **Leave versions to CI and maintainers.** Write commit subjects and PR titles as `<type>: <summary>`, with no version; CI adds it to the PR title. Never choose a minor or major version, and never create tags or releases.
- **Run the checks.** Before you push, run `npm run lint`, `npm run typecheck` and `npm test`, as `docs/development.md` describes.
- **Get your work reviewed, and never merge it yourself.** Review your own changes first, then push the branch and open a PR (or give the link to open one), and stop to wait for human review. Do not merge PRs, and do not treat your own review as the required review.
- **Write in English.** Everything you put into the repository, including code, comments, commit messages, PRs and docs, is in clear, standard English. If you change `README.md` or `README.zh-CN.md`, update the other one to match and run `node scripts/check-readme-sync.mjs --update`.
- **Follow the hard constraints** in `docs/rules/constraints.md`. Above all, never write the name of the commercial board game that the first game is based on.

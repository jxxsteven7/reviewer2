# Language

Reviewer 2 is built by a Chinese-speaking team for players around the world. Everything in the repository is written in clear, standard English so that anyone can read it. There are a few deliberate exceptions.

## Use English for

- Code: identifiers, comments, log messages and error messages.
- Commit messages, branch names, PR titles and PR descriptions.
- Documentation and rules: `README.md`, `CONTRIBUTING.md`, `AGENTS.md` and everything under `docs/`.
- Configuration and scripts, including comments and messages in git hooks and CI workflows.

Write plain, correct English: complete sentences, consistent terms, and no leftovers from machine translation. Reviewers flag unclear or ungrammatical English the same way they flag unclear code.

## Exceptions

- `README.zh-CN.md` is the Chinese translation of `README.md`. The two must stay in sync, as described below. The language switcher at the top of `README.md` names the Chinese version in Chinese.
- UI text lives in the locale files, and the Chinese locale (`zh.json`) is in Chinese. UI text is never hard-coded in components; see [constraints.md](constraints.md).
- Word lists under `words/`, and examples of word-list data in the docs, contain Chinese terms in their `zh` fields.
- Issue threads and review comments may be in English or Chinese, whichever works for the people involved. Anything that lands in the repository is in English.

## Keeping the two READMEs in sync

`README.md` and `README.zh-CN.md` must say the same thing. When you change one, change the other in the same PR.

CI runs `node scripts/check-readme-sync.mjs`, which checks that:

- both files have the same headings at the same levels, in the same order;
- fenced code blocks are identical, so code blocks must not contain prose, and any comments in them are in English;
- both files link to the same targets;
- tables have the same number of rows and columns;
- the sync stamp at the bottom of `README.zh-CN.md` matches the current content of both files.

Any change to either file changes the stamp, so CI fails until the stamp is recorded again. After you have brought both files in line, run:

```bash
node scripts/check-readme-sync.mjs --update
```

This checks the structure and records a new stamp. Run it only once the two files really match. The script can't judge the translation itself, so reviewers check that.

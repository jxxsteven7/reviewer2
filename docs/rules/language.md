# Language

Reviewer 2 is built by a Chinese-speaking team for players around the world, so everything in the repository is in clear, standard English: code, identifiers, comments, log and error messages, commit messages, branch names, PRs, docs, rules, configuration, scripts, hooks and CI workflows. Write complete sentences, use consistent terms, and leave no traces of machine translation. Reviewers flag unclear English as they flag unclear code.

## Exceptions

- `README.zh-CN.md` is the Chinese translation of `README.md`; see below. The language switcher at the top of `README.md` names it in Chinese.
- UI text lives in the locale files, and `zh.json` is in Chinese. It is never hard-coded in components ([constraints.md](constraints.md)). The mailer's mails are in `mailer/src/locales/`, in both languages too.
- Word lists under `words/`, and examples of them in the docs, have Chinese terms in their `zh` fields.
- `ACKNOWLEDGMENTS.md` lists people by the names they chose, in any language; what they did is in English.
- Issues and review comments may be in English or Chinese. Anything that lands in the repository is in English.

## Keeping the two READMEs in sync

The two READMEs say the same thing. When you change one, change the other in the same PR. CI runs `node scripts/check-readme-sync.mjs`, which checks that both have the same headings at the same levels in the same order, identical fenced code blocks (so code blocks hold no prose, and their comments are in English), the same link targets, tables of the same shape, and that the sync stamp at the bottom of `README.zh-CN.md` matches both files. Any change moves the stamp, so once the two files match, run:

```bash
node scripts/check-readme-sync.mjs --update
```

The script can't judge the translation; reviewers do.

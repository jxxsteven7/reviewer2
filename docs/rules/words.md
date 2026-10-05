# Word lists

Word lists live in `words/`, one JSON file per field, for example `words/general.json` and `words/ml.json`. All games share the same word lists.

## Format

```json
{
  "id": "ml",
  "name": { "zh": "机器学习", "en": "Machine Learning" },
  "contributors": ["Your Name"],
  "terms": [
    {
      "id": "attention",
      "zh": "注意力",
      "en": "Attention",
      "difficulty": 1,
      "related": ["transformer", "self-attention"],
      "note": { "zh": "一句话解释", "en": "One-line explanation" }
    }
  ]
}
```

- A term's `id` must be unique within its file.
- Fill in at least one of `zh` and `en`, and ideally both.
- `difficulty`, `related` and `note` are reserved for future games and can be left out for now.
- Add your name to `contributors`.

## Choosing terms

- Pick terms that everyone in the field knows. If a term is too obscure, captains can't give clues for it.
- Prefer terms that have several meanings or invite associations across concepts, such as "attention", "convergence", "baseline" or "generalization".
- Use mostly nouns, and keep them short.
- Aim for at least 200 terms per field. With fewer, games start repeating after a few rounds.
- All terms are original. Don't use the official word list of any commercial board game.

## Submitting

- A word-list PR changes only files under `words/`, and only one field per PR. Name the branch `words/<field>`.
- Run the word list validation script before committing. It checks the format and looks for duplicate terms. The command will be added here once the script exists, and CI will run it too.
- Word lists are reviewed like everything else. Reviewers check that the terms are accurate and commonly used, and that the Chinese and English match.

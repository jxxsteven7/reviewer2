# Word library

Every game draws its terms from this directory: one JSON file per academic field, such as `general.json` or `ml.json`.

## Format

```json
{
  "id": "ml",
  "name": { "zh": "机器学习与人工智能", "en": "Machine Learning & AI" },
  "contributors": ["Your Name"],
  "terms": [
    { "id": "attention", "zh": "注意力", "en": "Attention", "forms": { "en": ["attend"] } }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | Yes | The file name without `.json` |
| `name` | Yes | The field's name, `zh` and `en` |
| `contributors` | Yes | Who contributed terms |
| `terms[].id` | Yes | Lowercase, `-`-joined, unique; never change one once merged |
| `terms[].zh`, `terms[].en` | One of them | The term in each language; fill in both when you can |
| `terms[].forms` | No | Other forms that give the term away, `zh` and `en` lists; see [Forms](#forms) |
| `terms[].difficulty`, `related`, `note` | No | Reserved for future games |

All games share one format; a new game adds optional fields here.

### Forms

List what a game can't work out itself: inflections and derived words beyond a plain plural ("modeling" for "Model"), other spellings, compounds written as one word ("dataset" for "Data"), and the standard abbreviation or full name ("CV" for "Computer vision"). Don't list the term itself or its plain plural, compounds with a space or hyphen, or synonyms and translations, which make good clues.

## What makes a good term

- **Well known** to everyone in the field, **accurate** in both languages, **short**, mostly nouns.
- **Names as people say them:** "Transformer", "CNN", "arXiv" stay as they are in both languages, with the Chinese full name in `forms`.
- **No ambiguous abbreviations:** "CV" is a résumé in `general.json`, so `ml.json` spells out "Computer vision".
- **One translation everywhere:** the same word in two fields gets the same translation.
- **Original:** never the official word list of a commercial board game.
- **Fit for a party game:** nothing offensive, no real people, not the game's own names ("PI", "Reviewer 2").
- **Enough:** at least 200 terms per field.

## How the games use the library

| Game | Fields | What works well |
|---|---|---|
| Team word guessing (`keywords`) | `zh`, `en`, `forms` | Terms with several meanings or associations ("attention", "baseline"). A board needs 25 different words in the room's language; up to 5 Chinese characters or 14 letters fit a card. The other language's term, and under the strict rule the `forms`, may not be given as a clue |

### Terms that give each other away

"Gene" and "Gene editing": a clue for one points at the other, so the game never deals them together. Two terms clash when one lies inside the other: one is the other or its plain plural; every part of one is a part of the other ("Model" and "Mixture models"); a run of Chinese characters in one lies inside the other's ("电" and "电场"); one is the other's term in the other language; or every part of one is a part of one of the other's `forms`. A part in common is not enough ("Data science" and "Data cleaning"), nor a shared Chinese character. A list must keep 25 terms per language of which no two clash.

## Contributing

- Name the branch `words/<topic>` and use the `words` commit type. A PR that changes the format changes `scripts/check-words.mjs` and its tests too.
- Run `node scripts/check-words.mjs` before committing; CI runs it too. It **fails** on a broken format, duplicate or unknown IDs, two terms that are the same word counting only letters and digits, stray spaces or invisible characters, a form that repeats the term or another form, fewer than 25 different terms in either language, a word two lists translate differently, and a list without 25 terms of a language of which no two clash. It **warns** about a language with fewer than 25 terms, terms over 5 Chinese characters or 14 letters, and terms that are the game's own names, and it lists the pairs that clash as information.
- Reviewers check accuracy and that the two languages match.

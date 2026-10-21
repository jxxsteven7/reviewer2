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
| `terms[].related` | No | Ids of terms in the same file that make a pair of close terms with this one; see [Related terms](#related-terms) |
| `terms[].difficulty`, `note` | No | Reserved for future games |

All games share one format; a new game adds optional fields here.

### Forms

List what a game can't work out itself: inflections and derived words beyond a plain plural ("modeling" for "Model"), other spellings, compounds written as one word ("dataset" for "Data"), and the standard abbreviation or full name ("CV" for "Computer vision"). Don't list the term itself or its plain plural, compounds with a space or hyphen, or synonyms and translations, which make good clues.

### Related terms

Each id in `related` pairs the term with a close term of the same file, for a game in which most players get one term of a pair and one or two get the other. Write a pair once, on the term that comes first in the file:

```json
[
  { "id": "precision", "zh": "精确率", "en": "Precision", "related": ["recall"] },
  { "id": "recall", "zh": "召回率", "en": "Recall" }
]
```

A good pair is:

- **Two of a kind, close in meaning:** a vague description fits both, and a precise one tells them apart, such as "Precision" and "Recall", "CNN" and "RNN", or "Conference" and "Workshop".
- **Well known:** people in the field know both terms, and both are accurate in both languages.
- **Two terms, neither inside the other:** they don't [give each other away](#terms-that-give-each-other-away), so not "Gene" and "Gene editing", "电" and "电场", or a term and its translation.
- **Neither synonyms nor a term and one of its kinds:** synonyms can't be told apart, and "Model" and "Linear model" are not two of a kind.
- **A pair in both languages:** both terms have `zh` and `en`, and they are close but different in each.

A term may be in 3 pairs at most, so that the pairs vary.

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
| `impostor` | `zh`, `en`, `related` | Pairs of close terms ("Precision" and "Recall"): most players get one term of a pair and one or two get the other, so a vague description should fit both and a precise one tell them apart; see [Related terms](#related-terms) |

### The English of the characters

`dictionary/han-glosses.json` gives the English meanings of every Chinese character that the lists use, from CC-CEDICT, for the clue check, which takes the English of a character on the board for the character. It is no word list, and is built rather than edited: after adding words with new characters, run `node scripts/build-han-glosses.mjs <cedict_ts.u8> <version>`, as the script says.

### Terms that give each other away

"Gene" and "Gene editing": a clue for one points at the other, so the game never deals them together. Two terms clash when one lies inside the other: one is the other or its plain plural; every part of one is a part of the other ("Model" and "Mixture models"); a run of Chinese characters in one lies inside the other's ("电" and "电场"); one is the other's term in the other language; or every part of one is a part of one of the other's `forms`. A part in common is not enough ("Data science" and "Data cleaning"), nor a shared Chinese character. In each language that a list has 25 terms of, 25 of them must be free of clashes with each other.

## Contributing

- Name the branch `words/<topic>` and use the `words` commit type. A PR that changes the format changes `scripts/check-words.mjs` and its tests too.
- Run `node scripts/check-words.mjs` before committing; CI runs it too. It **fails** on a broken format, duplicate or unknown IDs, two terms that are the same word counting only letters and digits, stray spaces or invisible characters, a form that repeats the term or another form, no language with 25 different terms, a word two lists translate differently, a language that has 25 terms but not 25 of which no two clash, a pair of related terms that is written twice or on the later of its terms, lacks a `zh` or an `en`, or has terms that give each other away, and a term in more than 3 pairs. It **warns** about a language with some terms but fewer than 25, terms over 5 Chinese characters or 14 letters, and terms that are the game's own names, and it lists the pairs that clash as information. For each list that passes, it says how many terms it has in each language and how many pairs of related terms.
- Reviewers check accuracy and that the two languages match.

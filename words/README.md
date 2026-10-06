# Word library

The word library is shared by every game in Reviewer 2. Each JSON file in this directory covers one academic field, for example `general.json` for terms everyone in academia knows, or `ml.json` for machine learning. When players set up a room, they pick fields, and the game draws its terms from those files.

This guide covers the format, what makes a good term and how to contribute. It applies to every game. What each game needs on top of that is listed under [How the games use the library](#how-the-games-use-the-library).

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

| Field | Required | Meaning |
|---|---|---|
| `id` | Yes | The field's ID, the same as the file name without `.json` |
| `name` | Yes | The field's name, in `zh` and `en` |
| `contributors` | Yes | The people who contributed terms to this file |
| `terms[].id` | Yes | The term's ID, in lowercase English with words joined by `-` and unique within the file. Games refer to terms by ID, so never change an ID once it is merged |
| `terms[].zh`, `terms[].en` | At least one | The term in Chinese and in English. Fill in both whenever you can |
| `terms[].difficulty` | No | How hard the term is, as a whole number from 1 (easy) to 5 (hard). Reserved for future games |
| `terms[].related` | No | IDs of other terms in the same file that are closely related. Reserved for future games |
| `terms[].note` | No | A one-line explanation, in `zh` and `en`. Reserved for future games |

When a new game needs more information about each term, add an optional field to this format in the same PR as the game, and describe it here. All games keep sharing one format; no game gets its own copy of the word lists.

## What makes a good term

These apply to every game:

- **Well known in its field.** Everyone who works in the field should recognize it.
- **Accurate.** The Chinese and English are the standard terms that people in the field actually use, and they mean the same thing.
- **Short.** Mostly nouns, as short as the field allows.
- **Original.** Write the lists yourselves. Don't copy the official word list of any commercial board game.
- **Fit for a party game.** Nothing offensive, and nothing that targets real people.
- **Enough of them.** Aim for at least 200 terms per field, so that games don't start repeating after a few rounds.

## How the games use the library

| Game | Fields it uses | What makes a term work well in it |
|---|---|---|
| Team word guessing (`keywords`) | `zh`, `en` | Terms with several meanings, or that invite associations across concepts, such as "attention", "convergence", "baseline" or "generalization". A captain has to link several of them with a single clue, so terms that are too obscure don't work. A board needs 25 different words in the room's language, and short terms fit the cards best: up to 5 Chinese characters or 14 letters. A card also carries the term in the other language, and a captain may not give it as a clue, so the two must really mean the same thing. |

Add a row when a new game starts using the library.

## Contributing

- A word-list PR changes only files under `words/`, and only one field per PR. Name the branch `words/<field>` and use the `words` commit type.
- Before committing, run `node scripts/check-words.mjs`. It needs only Node, not `npm install`, and CI runs it too.
  - It **fails** on:
    - anything that breaks the format above, and an `id` that doesn't match the file name;
    - a duplicate term ID, and a `related` ID that is not another term of the file;
    - a term that is the same word as another in the same language. Only letters and digits count, as on the board: not case, accents, spaces, hyphens or other punctuation, and not the difference between traditional and simplified Chinese characters. A list can't hold both "Co-author" and "coauthor", or both "C++" and "C#";
    - a term without a letter or a digit;
    - a list that doesn't have 25 different terms in either language, because a board needs 25.
  - It **warns** about a language that has some terms but fewer than 25, which players can't pick for this field until it has more. It also warns about terms longer than 5 Chinese characters or 14 letters, which may not fit on a card on a phone, and about terms that are also the game's own names for its roles and cards, such as "PI" or "Reviewer 2", because players may mix them up. Warnings don't fail the check.
- Word lists are reviewed like everything else. Reviewers check that the terms are accurate and well known, and that the Chinese and English match.

# Word library

The word library is shared by every game in Reviewer 2. Each JSON file in this directory covers one academic field, for example `general.json` for terms everyone in academia knows, or `ml.json` for machine learning. When players set up a room, they pick fields, and the game draws its terms from those files.

This guide covers the format, what makes a good term and how to contribute. It applies to every game. What each game needs on top of that is listed under [How the games use the library](#how-the-games-use-the-library).

## Format

```json
{
  "id": "ml",
  "name": { "zh": "机器学习与人工智能", "en": "Machine Learning & AI" },
  "contributors": ["Your Name"],
  "terms": [
    {
      "id": "attention",
      "zh": "注意力",
      "en": "Attention",
      "forms": { "en": ["attend"] },
      "difficulty": 1,
      "related": ["transformer", "cnn"],
      "note": { "zh": "一句话解释", "en": "One-line explanation" }
    },
    {
      "id": "cnn",
      "zh": "CNN",
      "en": "CNN",
      "forms": { "zh": ["卷积神经网络"], "en": ["convolutional neural network"] }
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
| `terms[].forms` | No | Other forms of the term that give it away as surely as the term itself, as a `zh` list, an `en` list or both. See [Forms](#forms) |
| `terms[].difficulty` | No | How hard the term is, as a whole number from 1 (easy) to 5 (hard). Reserved for future games |
| `terms[].related` | No | IDs of other terms in the same file that are closely related. Reserved for future games |
| `terms[].note` | No | A one-line explanation, in `zh` and `en`. Reserved for future games |

When a new game needs more information about each term, add an optional field to this format in the same PR as the game, and describe it here. All games keep sharing one format; no game gets its own copy of the word lists.

### Forms

Some forms of a term give it away as surely as the term itself, so a game that checks clues can refuse them too. The field lists the forms that a game can't work out on its own:

- inflections and derived words, other than a plain plural in -s or -es: "modeling" and "modelled" for "Model", "simulate" for "Simulation", "matrices" for "Matrix", "mitochondrion" for "Mitochondria";
- other spellings: "tumour" for "Tumor", "generalisation" for "Generalization";
- common compounds that contain the term and are written as one word: "dataset" and "database" for "Data", "subset" for "Set";
- the standard abbreviation or the full name: "CV" for "Computer vision", "graphics processing unit" for "GPU". In `zh`, that is the Chinese full name of a term that Chinese speakers say in English, such as "图形处理器" for "GPU", or the standard short form of a Chinese term, such as "通胀" for "通货膨胀".

Don't list:

- the term itself, its plain plural, or the singular of a term that is a plural, such as "acoustic" for "Acoustics": games take a word and its plain plural for each other, so they refuse these anyway. For the same reason, one of "genetic" and "genetics" is enough;
- compounds with a space or a hyphen, such as "self-attention" or "data science", which already repeat a part of the term;
- synonyms, other names and other translations, such as "ConvNet" for "CNN" or "散列" for "哈希". They make good clues.

One or two forms are usual, and many terms have none. Each form is a clue that a captain can't give, so list only forms that really give the term away. The game puts the forms of both languages together, so a form in either list counts in a room of either language.

## What makes a good term

These apply to every game:

- **Well known in its field.** Everyone who works in the field should recognize it.
- **Accurate.** The Chinese and English are the standard terms that people in the field actually use, and they mean the same thing.
- **Short.** Mostly nouns, as short as the field allows.
- **Names as people say them.** Keep names of models and architectures, such as "Transformer" and "ResNet", common abbreviations, such as "CNN" and "GPU", and names of platforms, such as "arXiv", "GitHub" and "LaTeX", in their original form in both languages. In general, write the Chinese term in English whenever Chinese speakers in the field say it in English, and give its Chinese full name in `forms`.
- **No ambiguous abbreviations.** An abbreviation goes on a card only when it means one thing in its field. In academia at large, "CV" is a résumé, so `general.json` may hold "简历 / CV", but `ml.json` spells out "计算机视觉 / Computer vision".
- **One translation everywhere.** When two fields hold the same word, it needs the same translation, spelled the same way, in both, because the game makes one card of it. A word that means different things in different fields, such as "Kernel", belongs to one of them.
- **Original.** Write the lists yourselves. Don't copy the official word list of any commercial board game.
- **Fit for a party game.** Nothing offensive, and nothing that targets real people. No names of living people, scholars included.
- **Not the game's own names.** Avoid terms that are also the names of the game's roles and cards, such as "PI" or "Reviewer 2".
- **Enough of them.** Aim for at least 200 terms per field, so that games don't start repeating after a few rounds.

## How the games use the library

| Game | Fields it uses | What makes a term work well in it |
|---|---|---|
| Team word guessing (`keywords`) | `zh`, `en`, `forms` | Terms with several meanings, or that invite associations across concepts, such as "attention", "convergence", "baseline" or "generalization". A captain has to link several of them with a single clue, so terms that are too obscure don't work. A board needs 25 different words in the room's language, and short terms fit the cards best: up to 5 Chinese characters or 14 letters. A card also carries the term in the other language, and a captain may not give it as a clue, so the two must really mean the same thing. Under the strict clue rule, a captain may not give one of a card's `forms` either. Two terms of which one gives the other away never share a board (see [Terms that give each other away](#terms-that-give-each-other-away)). |

Add a row when a new game starts using the library.

### Terms that give each other away

Some terms repeat others: "Gene" and "Gene editing", "DNA" and "Junk DNA", "化石" and "活化石". On one board, a clue for one would point at the other as well, and the guessers couldn't tell which was meant. So the team word guessing game never deals two such terms together.

Two terms clash when one of them, given as a clue while the other is on the board, would be refused under the strict clue rule for repeating it:

- one is the other, a part of it or a plain plural of either: "Model" and "Mixture models", and also "Data science" and "Data cleaning", which share a part;
- a run of Chinese characters in one contains a run in the other: "基因" and "基因编辑";
- one repeats the other's term in the other language;
- one repeats a part of one of the other's `forms`, in either language: "Unit" and "GPU" with the form "graphics processing unit".

A Chinese character in common is not enough: "数学" and "化学" can share a board. Neither is a near miss that only brings a warning when it is a clue, such as "Model" and "Modeling", or "Data" and "Datacenter". The comparison is in the room's language, so a pair may clash in one language and not in the other.

Clashing terms are fine in a list: the game only keeps them apart, and each list has far more terms than a board needs. But a list must keep 25 terms in each language that it is played in of which no two clash, and a term that clashes with many others, such as a one-character Chinese term that many others contain, makes the list play the same terms more often. `node scripts/check-words.mjs` lists the pairs, as described below.

## Contributing

- A word-list PR may change several fields at once. Name the branch `words/<topic>`, such as `words/ml`, and use the `words` commit type. When a PR changes the format, it changes `scripts/check-words.mjs` and its tests too, so that the check keeps up with the format.
- Before committing, run `node scripts/check-words.mjs`. It needs only Node, not `npm install`, and CI runs it too.
  - It **fails** on:
    - anything that breaks the format above, and an `id` that doesn't match the file name;
    - a duplicate term ID, and a `related` ID that is not another term of the file;
    - a term that is the same word as another in the same language. Only letters and digits count, as on the board: not case, accents, spaces, hyphens or other punctuation, and not the difference between traditional and simplified Chinese characters. A list can't hold both "Co-author" and "coauthor", or both "C++" and "C#";
    - a term without a letter or a digit;
    - a term or a form with spaces at its ends or two spaces in a row, with a tab, a line break or any other space than a plain one, or with a character that shows nothing, such as a zero-width space;
    - a form that is the term itself, in either language, its plain plural or its singular, and a form that repeats another form of the term or is its plain plural;
    - a list that doesn't have 25 different terms in either language, because a board needs 25;
    - a word that two lists translate differently, or spell their translations differently. This compares the lists that it checks, which are all of them unless you name some;
    - a list in which it can't find 25 terms of a language, among those that it has 25 of, of which no two clash, because the game could then only deal boards with terms that give each other away. See [Terms that give each other away](#terms-that-give-each-other-away). To fix it, take out some of the terms that clash with many others, or add terms that clash with none.
  - It **warns** about a language that has some terms but fewer than 25, which players can't pick for this field until it has more. It also warns about terms longer than 5 Chinese characters or 14 letters, which may not fit on a card on a phone. As on a card, a Chinese term without Chinese characters, such as "GitHub", is measured in letters. Finally, it warns about terms that are also the game's own names for its roles and cards, such as "PI" or "Reviewer 2", because players may mix them up. Another spelling or a plain plural of such a name counts too, such as "Reviewer-2" or "Students". Warnings don't fail the check.
  - Before all of that, it lists, as information, the terms that clash in each language, each pair once, under the term that comes first: `check-words: info: biology.json: terms[1] (gene): "en" "Gene" can't share a board with "Gene editing", "Gene pool"`. These need no fixing; they show which terms the game keeps apart.
  - On GitHub Actions, it attaches each problem and warning to the line of the term in the pull request. The information stays in the log only.
- Word lists are reviewed like everything else. Reviewers check that the terms are accurate and well known, and that the Chinese and English match.

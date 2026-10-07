# Design

How Reviewer 2 looks, and why. The tokens are in `client/src/styles/tokens.css`, and the shared styles are in `base.css` next to it.

## A typeset preprint

The interface is designed like a carefully typeset paper rather than an app: white paper, black ink, hairline rules and serif headings. Its structure comes from academic typography, not from cards and shadows:

- the home page reads like the contents page of a journal, with numbered entries and dotted leaders;
- room codes are manuscript numbers, such as R2-K7QX;
- the sections of a page are numbered: §1, §2 and so on;
- labels are set in small capitals, and notes like footnotes;
- unreleased games are marked "Forthcoming".

**Avoid** anything that looks like a generic AI-generated website or like Claude's own brand: cream or beige paper, terracotta or orange accents, soft shadows, large rounded cards, gradients, glass effects, emoji as icons, and landing pages with a big centered headline and badges.

**Keep it original.** Don't imitate the visual design of the board game that inspired the first game: no character illustrations, and none of its card designs, colors or icons. The two groups use the inks of academic printing, carmine and Prussian blue, and neutral cards are a cool grey.

## Color

| Token | Value | Use |
|---|---|---|
| `--paper`, `--paper-2` | `#FFFFFF`, `#F5F6F8` | The page; quiet areas and disabled controls |
| `--ink`, `--ink-2`, `--ink-3` | `#15171C`, `#4B505B`, `#656B78` | Text; secondary text; captions, notes and placeholders |
| `--rule` | `#D9DCE2` | Hairlines between sections |
| `--red`, `--red-tint` | `#B42318`, `#FBEAE8` | The red group; labels; problems |
| `--blue`, `--blue-tint` | `#1F4F8F`, `#E7EDF6` | The blue group; focus rings |
| `--neutral`, `--neutral-tint` | `#C8CCD3`, `#F0F1F3` | Irrelevant papers |
| `--r2`, `--stamp` | `#15171C`, `#D9442B` | Reviewer 2's card and its "reject" stamp |

Text meets a contrast of at least 4.5:1 against its background, and white on either group color passes 6:1. Color never carries meaning alone: every card that shows a color also carries a short text label, so that color-blind players can tell them apart.

There is only a light theme for now. A dark theme would redefine the tokens and nothing else.

## Type

- **Serif**: Source Serif 4, for headings, the wordmark and English words on cards. It is the only web font. It is bundled from npm, served by our own server rather than a CDN, and downloaded only in the subsets a page uses.
- **Sans**: the system's interface font, for everything else: `system-ui`, PingFang SC, Microsoft YaHei, Noto Sans CJK.
- **Mono**: the system's monospaced font, for room codes and numbers.
- **Chinese** uses the system's fonts, because a Chinese web font weighs megabytes. Headings prefer a system Song typeface (Songti SC, Noto Serif CJK) and fall back to sans. Words on cards are set in sans, which reads better at small sizes.
- **Sizes** go from 12 to 36 px. Text in inputs is at least 16 px, which keeps iOS from zooming in.

## Space and shape

- Spacing comes in steps of 4 px.
- Cards have 2 px corners and controls 4 px; nothing is more rounded than that.
- Tap targets are at least 44 px high.
- Pages are one column on phones, with 16 px margins, and never scroll sideways. Rooms grow to two columns from 48rem.
- The layout leaves room for the notch and the home indicator (`env(safe-area-inset-*)`), and uses `100dvh`, with a fallback, so that WeChat's toolbars don't cover anything.

## Components

| Component | What it is |
|---|---|
| `UiButton` | `primary` for the one main action of a screen, `secondary` for the others, `quiet` for link-like actions, `danger` for actions that can't be undone |
| `UiField` | A labelled input with a hint or an error below it, and an optional prefix such as `R2-` |
| `UiSheet` | A sheet that rises from the bottom on phones and a dialog on wider screens. It is built by hand rather than with `<dialog>`, which older in-app browsers lack |
| `UiToasts` | Short messages at the top, such as the reason the server refused something. At the bottom they would cover the game's action bar or a sheet's input, right where the player just tapped |
| `ConnectionBanner` | "Reconnecting..." at the top, whenever the connection is gone |
| `PageMasthead`, `SiteWordmark` | The top of every page: the wordmark on the left, the manuscript number or the language switch on the right |
| `ManuscriptId`, `QrCode`, `ShareTools` | The room's number, and ways to bring people in. Sharing falls back from the share sheet, to the clipboard, to a selected link that people copy by hand, which is what WeChat and plain http allow |
| `PlayerName` | A name with an online dot and marks for "you" and the chair. For the chair, other names open the chair's actions |

## Cards

- **Hidden** (what students and spectators see): white with a thin rule, the word centered. A student's own choice gets a double ink border, and the student confirms it with the "Reveal" button below the board. Revealing takes two steps so that a stray tap can't reveal anything.
- **Chosen by others**: the group sees each student's choice. The names of the others who chose a card run along its bottom, in small type above a dotted rule, for the group's students and its PI. The choice comes from the server, so every screen in the group shows the same one.
- **Known but hidden** (the PI's key, and every card after the game): a tint of the card's color, with a band along the top and a small label: Red, Blue, Irrelevant or R2.
- **Revealed**: the full color, with white type on red, blue and Reviewer 2, and ink on grey. Reviewer 2 gets a slanted "Reject" stamp in `--stamp`.
- **Type**: English words are set in Source Serif 4, Chinese words in the system sans. Long words get smaller type, and English words are hyphenated with Liang's en-us patterns (the `hyphen` package, the same patterns that TeX uses), because many browsers don't hyphenate at all. The build hyphenates the terms of the word library, so the page carries their break points and not the patterns. A card grows a little when a word needs the room, rather than cut it off.
- **The board** is a 5×5 grid that fills the width on a phone. On a big screen it is sized to fit the screen's height, with the type scaled up to match.

## The group chat

The students of a group talk it over in a chat that only their group sees. A "Group chat" button next to the line that says who you are opens it as a sheet, and shows in a small ink box how many messages are new. The sheet lists the messages under small-capital turn headings, each with its sender's name in bold, and ends with a one-line input. The input runs the same check as the server: the count of characters sits below it, and the send button stays disabled for an empty or too long message. The list follows new messages only while it is scrolled to its end, so that a student reading older messages isn't pulled away from them. A PI reads the chat but gets a note instead of the input, and spectators and screens have no button at all. After the game the button stays where it is, and the input is gone.

## Writing

- All interface text is in the locale files, `client/src/locales/en.json` and `zh.json`. The lint rule `@intlify/vue-i18n/no-raw-text` fails on text written straight into a template. A unit test checks that both files have the same keys and placeholders, and a message for every error code.
- The English is plain and complete: sentences end with a period, and buttons say what they do ("Create the room", "Join as a student").
- The academic theme stays light: the chair, the PI, the manuscript number. It never gets in the way of saying what something does.

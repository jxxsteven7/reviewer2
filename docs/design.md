# Design

The interface is a party game on a table: a yellow table, white stickers with a thick ink outline and a hard shadow, big round corners and bold type. Whatever can be pressed is pushed into its shadow when pressed; a revealed card stays pressed. Tokens: `client/src/styles/tokens.css`; shared styles: `base.css`; fonts: `fonts.ts`.

## Tokens

Every color, font, size, corner, outline, shadow and width is a variable in `tokens.css`; components use variables only, never a literal value. Media queries can't read variables; the breakpoints are 40, 48, 60 and 64 rem. A second look, such as a dark one, is another block redefining the same variables under an attribute on `<html>`, nothing else.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#FFD23F` | The page |
| `--paper`, `--paper-2` | `#FFFFFF`, `#F4EFE6` | Stickers; quiet and disabled areas |
| `--ink`, `--ink-2`, `--on-ink` | `#1A1A2E`, `#4B4B60`, `#FFD23F` | Text, outlines, shadows; hints; type on ink |
| `--red`, `--on-red`, `--red-tint`, `--red-deep` | `#F2543D`, ink, `#FFD6CF`, `#B02A1A` | The red group: surface, type on it, tint, red text |
| `--blue`, `--on-blue`, `--blue-tint`, `--blue-deep` | `#2D5BFF`, white, `#D5DFFF`, `#1F44D6` | The blue group, the same way |
| `--neutral`, `--on-neutral`, `--neutral-tint` | `#BDB6A8`, ink, `#F4EFE6` | Irrelevant papers |
| `--r2`, `--on-r2`, `--stamp`, `--focus`, `--scrim` | ink, yellow, yellow, `#2D5BFF`, ink at 45% | Reviewer 2's card, type, stamp; focus rings; behind sheets |
| `--line`, `--line-strong` | 2.5 px, 3 px | Outlines of small things; of stickers, controls |
| `--shadow-1/2/3`, `--shift-1/2/3` | 3, 5, 6 px | Hard shadows of controls, panels, hero stickers; the press |
| `--radius-control/card/panel/hero/pill` | 14, 12, 20, 22, 999 px | Controls, cards, panels, hero stickers, tags |
| `--font-display`, `--font-number`, `--font-sans` | see below | Headings, status sentences; numbers; text |
| `--weight-text/bold/black/display` | 500, 700, 900, 800 | Text; labels; buttons, cards; display fonts |
| `--text-*`, `--space-*` | 12–46 px, 4–48 px | Type sizes (inputs stay at 16 px); spacing |
| `--page-narrow`, `--page`, `--page-wide`, `--motion` | 40, 64, 80 rem, 160 ms | Forms, the home page, rooms; motion, off under `prefers-reduced-motion` |

## Fonts

Three web fonts from npm, served by our own server (`docs/rules/constraints.md`): ZCOOL KuaiLe for Chinese headings and status sentences, Baloo 2 for numbers and the Latin of headings, Noto Sans SC for text. `--font-display` names Baloo 2 before ZCOOL KuaiLe, so a heading takes Latin from the one and Chinese from the other, with `font-synthesis: none`, since ZCOOL KuaiLe has one weight. The Chinese fonts come sliced by character range (93 and 101 `@font-face` rules), so a browser downloads only the slices it needs; the build keeps every slice as a file (`assetsInlineLimit: 0`), because a `data:` URL breaks the Content Security Policy.

## Rules

- **Contrast.** Text reads at 4.5:1 or more: small text on red is ink (white would be 3.4:1), on blue white, on yellow and the tints ink; red and blue text on white or yellow use the deep shades; hints use `--ink-2`. Default avatars are bright colors with an ink initial (tested). A card that shows a color carries its label too.
- **Type.** Headings and the status sentence in the display fonts; numbers in `.num`; the rest in Noto Sans SC at 500, 700 for labels, 900 for buttons and cards. No small capitals, italics, section numbers, hairlines or dotted leaders.
- **Stickers.** Panels, cards, buttons, inputs and choices have an ink outline and a hard shadow; a chosen row turns yellow. Pressing moves a sticker by its shift and drops the shadow. Avatars are outlined circles; tap targets are at least 44 px.
- **Layout.** One column on phones with 16 px margins, never scrolling sideways. From 60 rem the home page has two columns; from 64 rem the game three (groups, board, clue log) and the waiting room two. On a phone the board comes first, the action bar stays at the bottom, kept low, and the groups and the clue log open as sheets from it. Cards grow with the board, on a big screen with its height.
- **Cards.** Hidden: white. The viewer's choice: yellow. Known but hidden: the tint, labelled in the corner. Revealed: the full color, pressed in; irrelevant papers struck through; Reviewer 2 ink with yellow type and a slanted stamp. The others' choices hang as avatars on a card's corner, named for assistive technology.
- **Sheets** rise from the bottom on phones and are dialogs on wider screens, closed by a button or Escape; one opened from another lies over it and alone takes the keys.
- **Writing.** All interface text lives in the locale files: `@intlify/vue-i18n/no-raw-text` fails on text in a template, and a test checks both languages have the same keys.

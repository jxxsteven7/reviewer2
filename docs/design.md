# Design

The interface is a party game on a table: a yellow table, white stickers with a thick ink outline and a hard shadow, big round corners and bold type. Whatever can be pressed is pushed into its shadow when pressed; a revealed card stays pressed. Tokens: `client/src/styles/tokens.css`; shared styles: `base.css`; fonts: `fonts.ts`.

## Tokens

Every color, font, outline, corner, shadow and page width is a variable in `tokens.css`, and components take them from there, never as a literal value; the numbers that only lay a component out, such as a card's type sizes and the offset of a badge, are its own. Media queries can't read variables; the breakpoints are 40, 48, 60 and 64 rem. A second look, such as a dark one, is another block redefining the same variables under an attribute on `<html>`, nothing else.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#FFD23F` | The page |
| `--paper`, `--paper-2` | `#FFFFFF`, `#F4EFE6` | Stickers; quiet and disabled areas |
| `--ink`, `--ink-2`, `--on-ink` | `#1A1A2E`, `#4B4B60`, `#FFD23F` | Text, outlines, shadows; hints; type on ink |
| `--bg-tint` | `#FBEFC4` | The table's yellow, faded: the titles of a friend who is offline |
| `--online` | `#2FBF71` | The dot of someone who is online, on a player's avatar and on the friends list; offline is `--neutral` |
| `--red`, `--on-red`, `--red-tint`, `--red-deep` | `#F2543D`, ink, `#FFD6CF`, `#B02A1A` | The red group: surface, type on it, tint, red text |
| `--blue`, `--on-blue`, `--blue-tint`, `--blue-deep` | `#2D5BFF`, white, `#D5DFFF`, `#1F44D6` | The blue group, the same way |
| `--neutral`, `--on-neutral`, `--neutral-tint` | `#BDB6A8`, ink, `#F4EFE6` | Irrelevant papers |
| `--r2`, `--on-r2`, `--stamp`, `--focus`, `--scrim` | ink, yellow, yellow, `#2D5BFF`, ink at 45% | Reviewer 2's card, type, stamp; focus rings; behind sheets |
| `--r2-tint` | `#D9D9E6` | A card that a group's students mark as maybe Reviewer 2 |
| `--avatar-1` to `--avatar-8` | bright colors | Default avatars, one per name, with an ink initial (tested at 4.5:1 or more) |
| `--line-thin`, `--line`, `--line-strong` | 2, 2.5, 3 px | Outlines of avatars, dots and swatches; of small things; of stickers, controls |
| `--shadow-1/2/3`, `--shift-1/2/3` | 3, 5, 6 px | Hard shadows of controls, panels, hero stickers; the press |
| `--radius-small/control/card/panel/hero/pill` | 4, 14, 12, 20, 22, 999 px | Swatches and stamps, controls, cards, panels, hero stickers, tags |
| `--font-display`, `--font-number`, `--font-sans`, `--font-hand` | see below | Headings, status sentences; numbers; text; the points that rise in a game |
| `--weight-text/bold/black/display` | 500, 700, 900, 800 | Text; labels; buttons, cards; display fonts |
| `--text-*`, `--space-*` | 12–46 px, 4–48 px | Type sizes (inputs stay at 16 px); spacing |
| `--page-narrow`, `--page`, `--page-wide`, `--motion` | 40, 64, 80 rem, 160 ms | Forms, the home page, rooms; motion, off under `prefers-reduced-motion` |
| `--banner-height` | 2.5 rem | The reconnecting banner, which a game's clock and the short messages keep below |

## Fonts

Four web fonts from npm, served by our own server (`docs/rules/constraints.md`): ZCOOL KuaiLe for Chinese headings and status sentences, Baloo 2 for numbers and the Latin of headings, Noto Sans SC for text, and Nanum Pen Script, a pencil's hand, for the points that rise in a game alone, which are digits and signs: only its Latin slice is declared, about 15 KB, which a browser downloads with the first of them, showing Baloo 2 until it is there (`font-display: swap`). All four are under the SIL Open Font License. `--font-display` names Baloo 2 before ZCOOL KuaiLe, so a heading takes Latin from the one and Chinese from the other, with `font-synthesis: none`, since ZCOOL KuaiLe has one weight. The Chinese fonts come sliced by character range (93 and 101 `@font-face` rules), so a browser downloads only the slices it needs; the build keeps every slice as a file (`assetsInlineLimit: 0`), because a `data:` URL breaks the Content Security Policy.

## Rules

- **Contrast.** Text reads at 4.5:1 or more: small text on red is ink (white would be 3.4:1), on blue white, on yellow and the tints ink; red and blue text on white or yellow use the deep shades; hints use `--ink-2`. Nothing dims small text: a card's color label at 80% would fall to 3.9:1 on red and on blue. Default avatars are bright colors with an ink initial (tested). A card that shows a color carries its label too.
- **Type.** Headings and the status sentence in the display fonts; numbers in `.num`; the rest in Noto Sans SC at 500, 700 for labels, 900 for buttons and cards. No small capitals, italics, section numbers, hairlines or dotted leaders.
- **Stickers.** Panels, cards, buttons, inputs and choices have an ink outline and a hard shadow; a chosen row turns yellow. Pressing moves a sticker by its shift and drops the shadow. Ink is flat: a primary button, a tag or a badge filled with ink has no shadow, which would merge with it. Avatars are outlined circles. On the friends list, whether a friend is online is a small outlined dot on the bottom right corner, green or grey; in a room, someone the room waits for, offline or invited and not yet there, has a faded avatar, under a white veil, with three grey dots in the middle that light up in turn, as a chat shows someone typing, or stay still where the device asks for less motion; nothing marks those who are there. One that a tap opens, a player's panel in a room or their page elsewhere, wears the hard shadow of a sticker that can be pressed; tap targets are at least 44 px.
- **Layout.** One column on phones with 16 px margins, never scrolling sideways. From 60 rem the home page has two columns; from 64 rem the game three (the group chat, open all the time, and the groups; the board, with a match's table folded under it; the clue log and the tools) and the waiting room two, each column stacked from the top. On a phone the board comes first, the action bar follows it, and the groups, the clue log and the chat open as sheets from the bar. A game's clock sticks to the top of the screen, with the chair's button to pause at its end (on its own in a game without a clock), and so does the start bar above the waiting room, both under the reconnecting banner while that shows: the chair's with the line on whether the room is ready and, under it, the shuffle, the invitation of friends and the start button sharing their row evenly; a member's with the line and the invitation on one row. Cards grow with the board, on a big screen with its height.
- **Points that rise** in a game ([games/keywords.md](games/keywords.md#points-as-they-come)): handwritten in `--font-hand`, in the group's deep shade, with no ground but a ring of paper drawn with shadows around each stroke, so that they read on a card of their own color; they rise a short way and fade, or only fade under `prefers-reduced-motion`, and let every tap through. On a card about a third of its height; big in the middle of the screen at the end.
- **Cards.** Hidden: white. The viewer's choice: yellow. Known but hidden: the tint, labelled in the corner. Revealed: the full color, pressed in; irrelevant papers struck through; Reviewer 2 ink with yellow type and a slanted stamp. The others' choices hang as avatars on a card's corner; the card's accessible name says who they are. A group's marks, for its students: the tint of the color the mark stands for, the group's own, the other group's or `--r2-tint`, unless the card is the viewer's choice, and a round sticker on the bottom left corner with a tick, a cross or an exclamation mark, which the card's accessible name says in words; for its PI, who only reads them, a small sticker inside the bottom right corner on the card's own tint. Taps set them, with no tools to pick (two, three, or a long press), and a line under the board says which does what; a card selects no text and opens no menu on a long press.
- **Original.** The look is ours, as [rules/constraints.md](rules/constraints.md) asks: the yellow table, the stickers with their outline and hard shadow, the display fonts and the stamped rejection are what sets it apart from the board game that inspired the first game. Keep it that way when adding to it, and don't borrow that game's art, icons or card designs.
- **Sheets** rise from the bottom on phones and are dialogs on wider screens, closed by a button or Escape; one opened from another lies over it and alone takes the keys.
- **Writing.** All interface text lives in the locale files: `@intlify/vue-i18n/no-raw-text` fails on text in a template, and a test checks both languages have the same keys.

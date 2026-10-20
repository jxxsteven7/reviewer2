# Design

The interface is a party game on a table: a yellow table, white stickers with a thick ink outline and a hard shadow, big round corners and bold type. This page lists what it is made of: the tokens, the fonts and the icons. How to use them, on every page and in every game, is in one place, the rules of [rules/display.md](rules/display.md). Tokens: `client/src/styles/tokens.css`; shared styles: `base.css`; fonts: `fonts.ts`.

## Tokens

Every color, font, outline, corner, shadow, motion and page width is a variable in `tokens.css`, which components take, never a literal value ([rules/display.md](rules/display.md#one-look)).

| Token | Value | Use |
|---|---|---|
| `--bg` | `#FFD23F` | The page |
| `--paper`, `--paper-2` | `#FFFFFF`, `#F4EFE6` | Stickers; quiet and disabled areas |
| `--ink`, `--ink-2`, `--on-ink` | `#1A1A2E`, `#4B4B60`, `#FFD23F` | Text, outlines, shadows; hints; type on ink |
| `--bg-tint` | `#FBEFC4` | The table's yellow, faded: the titles of a friend who is offline |
| `--online` | `#2FBF71` | The dot of a friend who is online; a friend who is offline has none |
| `--red`, `--on-red`, `--red-tint`, `--red-deep` | `#F2543D`, ink, `#FFD6CF`, `#B02A1A` | The red group: surface, type on it, tint, red text |
| `--blue`, `--on-blue`, `--blue-tint`, `--blue-deep` | `#2D5BFF`, white, `#D5DFFF`, `#1F44D6` | The blue group, the same way |
| `--neutral`, `--on-neutral`, `--neutral-tint` | `#BDB6A8`, ink, `#F4EFE6` | Irrelevant papers |
| `--red-deeper`, `--blue-deeper` | `#7B1D12`, `#163096` | A title in a deep shade, hovered or pressed |
| `--link`, `--link-deep` | `#0077D4`, `#005FA8` | A link in text on white (4.6:1), and hovered or pressed; on a tinted ground, yellow or beige, a link takes `--blue-deep` |
| `--go` | `#5FD3A0` | A main action, a green sticker with ink type (9:1) |
| `--r2`, `--on-r2`, `--stamp`, `--focus`, `--scrim` | ink, yellow, yellow, `#2D5BFF`, ink at 45% | Reviewer 2's card, type, stamp; focus rings; behind sheets |
| `--r2-tint` | `#D9D9E6` | A card that a group's students mark as maybe Reviewer 2 |
| `--avatar-1` to `--avatar-8` | bright colors | Default avatars, one per name, with an ink initial (tested at 4.5:1 or more) |
| `--veil`, `--ink-veiled` | white at 50%, `#8D8D97` | The veil over the avatar of someone a room waits for, and its outline under the veil |
| `--line-thin`, `--line`, `--line-strong` | 2, 2.5, 3 px | Outlines of avatars, dots and swatches; of small things; of stickers, controls |
| `--shadow-0/1/2/3`, `--shift-0/1/2/3` | 2, 3, 5, 6 px | Hard shadows of small stickers, controls, panels, hero stickers; the press |
| `--radius-small/control/card/panel/hero/pill` | 4, 14, 12, 20, 22, 999 px | Swatches and stamps, controls, cards, panels, hero stickers, tags |
| `--font-display`, `--font-number`, `--font-sans`, `--font-hand` | see below | Headings, status sentences; numbers; text; the points that rise in a game |
| `--weight-text/bold/black/display` | 500, 700, 900, 800 | Text; labels; buttons, cards; display fonts |
| `--text-*`, `--space-*` | 12–46 px, 4–48 px | Type sizes (inputs stay at 16 px); spacing |
| `--page-narrow`, `--page`, `--page-wide` | 40, 64, 80 rem | Short pages, as the page not found and a room's notice; the home page; rooms |
| `--motion`, `--motion-quick`, `--ease-out/in/spring` | 160 ms, 140 ms, three curves | Motion, off under `prefers-reduced-motion`; a sheet closing and a page coming in; how what comes, what leaves and what pops eases |
| `--motion-sheet-in`, `--motion-sheet-out` | 260 ms, 220 ms | A sheet with a way back sliding in, and out as the viewer goes back |
| `--shade` | ink at 18% | The one soft shadow, under a bar that stays at the top once the page has scrolled under it |
| `--masthead-height` | 64 px | A page's masthead, and the bar of a page's title that takes its place |
| `--banner-height` | 2.5 rem | The reconnecting banner, which a game's clock and the short messages keep below |

## Fonts

Four web fonts from npm, served by our own server (`docs/rules/constraints.md`): ZCOOL KuaiLe for Chinese headings and status sentences, Baloo 2 for numbers and the Latin of headings, Noto Sans SC for text, and Nanum Pen Script, a pencil's hand, for the points that rise in a game alone, which are digits and signs: only its Latin slice is declared, about 15 KB, which a browser downloads with the first of them, showing Baloo 2 until it is there (`font-display: swap`). All four are under the SIL Open Font License. `--font-display` names Baloo 2 before ZCOOL KuaiLe, so a heading takes Latin from the one and Chinese from the other, with `font-synthesis: none`, since ZCOOL KuaiLe has one weight. The Chinese fonts come sliced by character range (93 and 101 `@font-face` rules), so a browser downloads only the slices it needs; the build keeps every slice as a file (`assetsInlineLimit: 0`), because a `data:` URL breaks the Content Security Policy.

## Icons and the preview picture

The site's icon is the wordmark's tile: ink, with "R2" in yellow. The picture that previews of links show, 1200 by 630, has the wordmark, the tagline in both languages and Reviewer 2's card with the rejection stamped on it; the home page in English has one in English alone, with the hook under the tagline. `client/images/render.mjs` draws them all into `client/public`: the icons from the outlines of the letters, so that they need no font, and the pictures from `client/images/share.html` and `share-en.html`, with the texts of the locale files (`site.picture`, and the tagline and hook). Run it after changing either, and commit what it draws.


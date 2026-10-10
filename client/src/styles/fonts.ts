// The three web fonts (docs/design.md). They come from npm and are served by our own server,
// never from a CDN (docs/rules/constraints.md). Each stylesheet declares the font in slices, one
// @font-face per range of characters, so a browser downloads only the slices that a page uses:
// a Chinese page takes a few hundred kilobytes of the Chinese fonts, not the several megabytes
// of the whole of them, and shows its text in the system font until they arrive.
import '@fontsource-variable/baloo-2/wght.css';
import '@fontsource-variable/noto-sans-sc/wght.css';
import '@fontsource/zcool-kuaile/400.css';

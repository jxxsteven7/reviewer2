// Draws the site's pictures into client/public: the icons, an ink tile with "R2" on it as the
// wordmark has, and the picture that previews of the site's links show (share.html). Run it after
// changing either, or the texts that the picture takes from the locale files, and commit what it
// draws:
//
//   node client/images/render.mjs
//
// It draws with Playwright's Chromium, which the end-to-end tests install; CHANNEL=chrome draws
// with the Chrome that is installed instead.

import { chromium } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const PUBLIC = join(ROOT, 'client', 'public');
const ORIGIN = 'http://render.invalid';
const TYPES = { '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };

// The colours of the tile, --ink and --on-ink in client/src/styles/tokens.css.
const INK = '#1a1a2e';
const ON_INK = '#ffd23f';

// "R2" in Baloo 2 at weight 800, the wordmark's font, with the letters 0.03em closer, as the tile
// sets them: outlines in the font's units, 1000 to the em, y down from the baseline, so that the
// icons need no font. Their ink is centred on CENTRE.
const R2 =
  'M238 -329H288Q330 -329 357 -348.5Q384 -368 384 -406Q384 -444 359.5 -463.5Q335 -483 282 -483Q269 -483 259 -482Q249 -481 238 -479ZM306 -196H65V-549Q65 -570 77 -581.5Q89 -593 108 -600Q142 -612 187 -617.5Q232 -623 283 -623Q421 -623 491 -564.5Q561 -506 561 -408Q561 -347 526.5 -299Q492 -251 434.5 -223.5Q377 -196 306 -196ZM269 -235 428 -267Q450 -237 473 -208Q496 -179 516.5 -152Q537 -125 554 -102Q571 -79 581 -62Q571 -28 544.5 -9Q518 10 485 10Q442 10 419.5 -9Q397 -28 378 -59ZM65 -264H240V-1Q229 2 206 5Q183 8 159 8Q107 8 86 -10.5Q65 -29 65 -75ZM639 -520Q639 -555 661.5 -577.5Q684 -600 724.5 -611.5Q765 -623 820 -623Q899 -623 952 -598.5Q1005 -574 1032 -532Q1059 -490 1059 -437Q1059 -384 1029.5 -334.5Q1000 -285 940 -237L809 -132H1049Q1055 -122 1060.5 -104.5Q1066 -87 1066 -67Q1066 -31 1050 -15.5Q1034 0 1008 0H661Q639 -15 626.5 -39Q614 -63 614 -94Q614 -128 628.5 -151.5Q643 -175 659 -189L797 -307Q849 -351 868 -378Q887 -405 887 -427Q887 -455 864.5 -471Q842 -487 802 -487Q762 -487 730.5 -474.5Q699 -462 678 -448Q662 -460 650.5 -478Q639 -496 639 -520Z';
const CENTRE = [565.5, -306.5];

// The tile as an SVG, 64 units square: with round corners, as tabs and pages show it, or square to
// its edges for the home screens that cut their own shape out of it (Apple's, and Android's
// maskable icons), with the letters a little smaller, inside the circle that every shape keeps.
// The scale is rounded, so that no floating-point noise goes into the file.
function tile({ rounded }) {
  const scale = Number((((rounded ? 0.56 : 0.5) * 64) / 1000).toFixed(6));
  const corner = rounded ? ' rx="15.36"' : '';
  const letters = `translate(32 32) scale(${scale}) translate(${-CENTRE[0]} ${-CENTRE[1]})`;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
    `  <rect width="64" height="64"${corner} fill="${INK}"/>`,
    `  <path transform="${letters}" fill="${ON_INK}" d="${R2}"/>`,
    '</svg>',
    '',
  ].join('\n');
}

// An .ico of PNGs, one for each size, as every browser since Internet Explorer 9 reads them.
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...pngs.map(({ data }) => data)]);
}

const locale = (language) =>
  JSON.parse(readFileSync(join(ROOT, 'client', 'src', 'locales', `${language}.json`), 'utf8'));
const text = { en: locale('en'), zh: locale('zh') };

const browser = await chromium.launch({ channel: process.env.CHANNEL });

// A picture of an SVG, `size` pixels square, on a clear background.
async function png(svg, size) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  await page.setContent(`<style>body{margin:0}</style><img src="${source}" width="${size}" height="${size}">`);
  const data = await page.screenshot({ omitBackground: true });
  await page.close();
  return data;
}

const rounded = tile({ rounded: true });
const square = tile({ rounded: false });
writeFileSync(join(PUBLIC, 'favicon.svg'), rounded);
writeFileSync(
  join(PUBLIC, 'favicon.ico'),
  ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(rounded, size) })))),
);
writeFileSync(join(PUBLIC, 'apple-touch-icon.png'), await png(square, 180));
writeFileSync(join(PUBLIC, 'icon-192.png'), await png(rounded, 192));
writeFileSync(join(PUBLIC, 'icon-512.png'), await png(rounded, 512));
writeFileSync(join(PUBLIC, 'icon-maskable-512.png'), await png(square, 512));

// The picture of a link's preview, from share.html with the repository's files behind it.
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.route(`${ORIGIN}/**`, (route) => {
  const path = join(ROOT, decodeURIComponent(new URL(route.request().url()).pathname));
  if (!existsSync(path)) return route.fulfill({ status: 404 });
  return route.fulfill({ body: readFileSync(path), contentType: TYPES[extname(path)] });
});
await page.goto(`${ORIGIN}/client/images/share.html`);
// Each font comes as the text needs it, once the text is laid out.
await page.evaluate(async (text) => {
  for (const element of document.querySelectorAll('[data-text]')) {
    const [language, path] = element.dataset.text.split(':');
    element.textContent = path.split('.').reduce((messages, key) => messages[key], text[language]);
  }
  document.body.getBoundingClientRect();
  await document.fonts.ready;
}, text);
writeFileSync(join(PUBLIC, 'share.png'), await page.screenshot());

await browser.close();

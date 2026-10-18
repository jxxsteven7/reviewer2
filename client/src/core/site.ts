import type { Language } from '@reviewer2/shared';

// What the server's page says before the app runs, for search engines and for the previews of links
// in chat apps, which run no script, or don't wait for it, and can't tell which language the reader
// reads (docs/architecture.md#search-engines-and-link-previews). The page's head gives its title
// and descriptions in both languages, English first, and the empty page an introduction to the
// game in both; robots.txt and sitemap.xml go beside it. vite.config.ts writes them at build time,
// from the locale files, and the app puts each page's own title and description in their place as
// it runs (head.ts). Nothing here may import a module at run time: vite.config.ts loads it.

// The locale files as JSON, and both of them.
type Messages = { readonly [key: string]: string | Messages };
export type SiteText = Readonly<Record<Language, Messages>>;

// What each language is called in a lang attribute and in hreflang, and in Open Graph.
export const HTML_LANG: Readonly<Record<Language, string>> = { zh: 'zh-CN', en: 'en' };
const OG_LOCALE: Readonly<Record<Language, string>> = { en: 'en_US', zh: 'zh_CN' };

// The address of the home page in a language, which opens it in that language, as if the visitor
// had chosen it on the language gate (HomeView.vue): what the sitemap lists, one for each language.
export const LANGUAGE_QUERY = 'lang';
export const homeIn = (language: Language) => `/?${LANGUAGE_QUERY}=${language}`;

// The picture of a link's preview (client/images/), and its size.
export const SHARE_IMAGE = { path: '/share.png', width: 1200, height: 630 };

// The paths that are for players and not for search engines: rooms and their big screens, the
// account pages, the API, the avatars and Socket.IO. Players' public pages stay open to crawlers,
// which the page asks not to list them (ProfilePage.vue): a crawler that robots.txt kept out
// would never read that.
const PRIVATE_PATHS = ['/room/', '/account', '/api/', '/avatars/', '/socket.io/'];

// The site's address, from SITE_URL, such as https://example.com: an origin over HTTP or HTTPS,
// with nothing after it but a slash, which goes. Null when it is unset or blank, and then the
// head names no address but its own paths and there is no sitemap. Anything else stops the build
// rather than put a wrong address in every page.
export function siteUrl(value: string | undefined): string | null {
  const text = (value ?? '').trim();
  if (text === '') return null;
  let url: URL | null = null;
  try {
    url = new URL(text);
  } catch {
    // Not an address at all; the error below says so.
  }
  const bare = url !== null && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
  if (url === null || !['http:', 'https:'].includes(url.protocol) || !bare || !/^[^?#]+$/.test(text)) {
    throw new Error(`SITE_URL must be the site's address alone, such as https://example.com, not "${value}"`);
  }
  return url.origin;
}

// A message of a locale file, with its placeholders filled in.
export function message(messages: Messages, path: string, values: Record<string, string> = {}): string {
  let found: string | Messages | undefined = messages;
  for (const key of path.split('.')) found = typeof found === 'object' ? found[key] : undefined;
  if (typeof found !== 'string') throw new Error(`the locale files have no message ${path}`);
  return found.replace(/\{(\w+)\}/g, (placeholder, name: string) => values[name] ?? placeholder);
}

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escape = (text: string) => text.replace(/[&<>"]/g, (character) => ESCAPES[character] ?? character);

// The title of the home page in both languages, which the page has before the app runs and on the
// language gate: "Reviewer 2 · Academic party games · " and the Chinese tagline.
export function bilingualTitle({ en, zh }: SiteText): string {
  const title = message(en, 'site.homeTitle', { site: message(en, 'app.name'), tagline: message(en, 'app.tagline') });
  return `${title} · ${message(zh, 'app.tagline')}`;
}

// The same message in both languages, English first.
const both = ({ en, zh }: SiteText, path: string) => `${message(en, path)} ${message(zh, path)}`;

// The tags of the page's head: its title, its description, which search engines show, and what the
// previews of links show, a shorter description and the picture. Open Graph wants the picture's
// full address, which only `url` gives; without it, the picture's path is the best there is. The
// page names no address of its own, og:url or a canonical link: every page of the site is this one
// file, and a room's link, say, would claim to be the home page's.
export function headTags(text: SiteText, url: string | null): string {
  const title = escape(bilingualTitle(text));
  const tags = [
    `<title>${title}</title>`,
    `<meta name="description" content="${escape(both(text, 'site.description'))}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escape(message(text.en, 'app.name'))}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${escape(both(text, 'site.hook'))}" />`,
    `<meta property="og:image" content="${escape(`${url ?? ''}${SHARE_IMAGE.path}`)}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="${SHARE_IMAGE.width}" />`,
    `<meta property="og:image:height" content="${SHARE_IMAGE.height}" />`,
    `<meta property="og:image:alt" content="${title}" />`,
    `<meta property="og:locale" content="${OG_LOCALE.en}" />`,
    `<meta property="og:locale:alternate" content="${OG_LOCALE.zh}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ];
  return tags.join('\n    ');
}

// What the empty page shows until the app takes its place, and all that a crawler that runs no
// script reads: the site's name, its tagline and an introduction to the game, in both languages.
// The tile beside the name is drawn by CSS, as the wordmark's is (styles/intro.css).
export function introHtml(text: SiteText): string {
  const { en, zh } = text;
  return [
    `<main class="intro">`,
    `<p class="intro-name"><span class="intro-tile" aria-hidden="true"></span>${escape(message(en, 'app.name'))}</p>`,
    `<h1 class="intro-tagline"><span lang="${HTML_LANG.zh}">${escape(message(zh, 'app.tagline'))}</span>`,
    `<span lang="${HTML_LANG.en}">${escape(message(en, 'app.tagline'))}</span></h1>`,
    `<p lang="${HTML_LANG.en}">${escape(message(en, 'site.intro'))}</p>`,
    `<p lang="${HTML_LANG.zh}">${escape(message(zh, 'site.intro'))}</p>`,
    `</main>`,
  ].join('');
}

// robots.txt: crawlers may read everything but the paths for players, and find the sitemap, which
// needs the site's address.
export function robotsTxt(url: string | null): string {
  const lines = ['User-agent: *', ...PRIVATE_PATHS.map((path) => `Disallow: ${path}`)];
  if (url) lines.push('', `Sitemap: ${url}/sitemap.xml`);
  return `${lines.join('\n')}\n`;
}

// sitemap.xml: the home page in each language, and as the language gate, for a reader whose
// language is neither; each of them names the others, so that a search engine shows the one in the
// searcher's language.
export function sitemapXml(url: string): string {
  const pages: { hreflang: string; path: string }[] = [
    ...(['en', 'zh'] as const).map((language) => ({ hreflang: HTML_LANG[language], path: homeIn(language) })),
    { hreflang: 'x-default', path: '/' },
  ];
  const links = pages
    .map(({ hreflang, path }) => `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${url}${path}" />`)
    .join('\n');
  const entries = pages.map(({ path }) => `  <url>\n    <loc>${url}${path}</loc>\n${links}\n  </url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');
}

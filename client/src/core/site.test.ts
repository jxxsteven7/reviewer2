import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  bilingualTitle,
  headTags,
  introHtml,
  message,
  pageHtml,
  pageIn,
  robotsTxt,
  siteUrl,
  sitemapXml,
  type SiteText,
} from './site';

// Invented messages, with every character that HTML escapes in them.
const TEXT: SiteText = {
  en: {
    app: { name: 'Reviewer 2', tagline: 'Games & <fun>' },
    site: {
      homeTitle: '{site} \u00b7 {tagline}',
      description: 'Say "yes" & play.',
      hook: 'Reveal the card.',
      intro: 'Play <b>now</b>.',
    },
  },
  zh: {
    app: { name: 'Reviewer 2', tagline: '\u6e38\u620f' },
    site: {
      homeTitle: '{site} \u00b7 {tagline}',
      description: '\u4e2d\u6587\u63cf\u8ff0',
      hook: '\u7ffb\u724c',
      intro: '\u4ecb\u7ecd',
    },
  },
};

describe('siteUrl', () => {
  test('is none when SITE_URL is unset or blank', () => {
    expect(siteUrl(undefined)).toBeNull();
    expect(siteUrl('')).toBeNull();
    expect(siteUrl('  ')).toBeNull();
  });

  test("is the site's origin, without the slash after it", () => {
    expect(siteUrl('https://example.com')).toBe('https://example.com');
    expect(siteUrl(' https://example.com/ ')).toBe('https://example.com');
    expect(siteUrl('http://localhost:3000')).toBe('http://localhost:3000');
    expect(siteUrl('https://EXAMPLE.com')).toBe('https://example.com');
  });

  test('stops the build for anything but an address alone', () => {
    for (const value of [
      'example.com',
      'ftp://example.com',
      'https://example.com/games',
      'https://example.com/?lang=en',
      'https://example.com?',
      'https://example.com/#top',
      'https://example.com#',
      'https://ann:secret@example.com',
      'not an address',
    ]) {
      expect(() => siteUrl(value), value).toThrow(/SITE_URL/);
    }
  });
});

describe('message', () => {
  test('is the message at a path, with its placeholders filled in', () => {
    expect(message(TEXT.en, 'site.homeTitle', { site: 'R2', tagline: 'Fun' })).toBe('R2 \u00b7 Fun');
    // A placeholder without a value stays as it is.
    expect(message(TEXT.en, 'site.homeTitle', { site: 'R2' })).toBe('R2 \u00b7 {tagline}');
  });

  test('stops the build for a message the locale files lack', () => {
    expect(() => message(TEXT.en, 'site.missing')).toThrow('the locale files have no message site.missing');
    expect(() => message(TEXT.en, 'site')).toThrow('the locale files have no message site');
  });
});

describe('headTags', () => {
  test('give the title and the descriptions in both languages, English first, escaped', () => {
    const tags = headTags(TEXT, null);
    expect(bilingualTitle(TEXT)).toBe('Reviewer 2 \u00b7 Games & <fun> \u00b7 \u6e38\u620f');
    expect(tags).toContain('<title>Reviewer 2 \u00b7 Games &amp; &lt;fun&gt; \u00b7 \u6e38\u620f</title>');
    expect(tags).toContain(
      '<meta property="og:title" content="Reviewer 2 \u00b7 Games &amp; &lt;fun&gt; \u00b7 \u6e38\u620f" />',
    );
    expect(tags).toContain(
      '<meta name="description" content="Say &quot;yes&quot; &amp; play. \u4e2d\u6587\u63cf\u8ff0" />',
    );
    expect(tags).toContain('<meta property="og:description" content="Reveal the card. \u7ffb\u724c" />');
    expect(tags).toContain('<meta property="og:locale" content="en_US" />');
    expect(tags).toContain('<meta property="og:locale:alternate" content="zh_CN" />');
    expect(tags).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(tags).toContain(
      '<meta name="twitter:image:alt" content="Reviewer 2 \u00b7 Games &amp; &lt;fun&gt; \u00b7 \u6e38\u620f" />',
    );
  });

  test("name the picture by its full address when the site's is known, and by its path otherwise", () => {
    const full = headTags(TEXT, 'https://example.com');
    expect(full).toContain('<meta property="og:image" content="https://example.com/share.png" />');
    expect(full).toContain('<meta name="twitter:image" content="https://example.com/share.png" />');
    const path = headTags(TEXT, null);
    expect(path).toContain('<meta property="og:image" content="/share.png" />');
    expect(path).toContain('<meta name="twitter:image" content="/share.png" />');
  });

  test('name no address of the page, which every page of the site shares', () => {
    const tags = headTags(TEXT, 'https://example.com');
    expect(tags).not.toContain('og:url');
    expect(tags).not.toContain('canonical');
  });

  test('are in one language alone for the home page opened in it, with its picture', () => {
    const english = headTags(TEXT, 'https://example.com', 'en');
    expect(english).toContain('<title>Reviewer 2 \u00b7 Games &amp; &lt;fun&gt;</title>');
    expect(english).toContain('<meta name="description" content="Say &quot;yes&quot; &amp; play." />');
    expect(english).toContain('<meta property="og:description" content="Reveal the card." />');
    expect(english).toContain('<meta property="og:image" content="https://example.com/share-en.png" />');
    expect(english).toContain('<meta name="twitter:image" content="https://example.com/share-en.png" />');
    expect(english).toContain('<meta property="og:locale" content="en_US" />');
    expect(english).not.toContain('\u6e38\u620f');

    // The Chinese page keeps the picture in both languages, which the maintainer chose.
    const chinese = headTags(TEXT, 'https://example.com', 'zh');
    expect(chinese).toContain('<title>Reviewer 2 \u00b7 \u6e38\u620f</title>');
    expect(chinese).toContain('<meta name="description" content="\u4e2d\u6587\u63cf\u8ff0" />');
    expect(chinese).toContain('<meta property="og:description" content="\u7ffb\u724c" />');
    expect(chinese).toContain('<meta property="og:image" content="https://example.com/share.png" />');
    expect(chinese).toContain('<meta property="og:locale" content="zh_CN" />');
    expect(chinese).toContain('<meta property="og:locale:alternate" content="en_US" />');
    expect(chinese).not.toContain('Games');
  });

  test('read every message they need from the real locale files', () => {
    const read = (language: string) =>
      JSON.parse(
        readFileSync(join(import.meta.dirname, '..', 'locales', `${language}.json`), 'utf8'),
      ) as SiteText['en'];
    const text: SiteText = { en: read('en'), zh: read('zh') };
    for (const language of [undefined, 'en', 'zh'] as const) {
      expect(() => headTags(text, 'https://example.com', language), language).not.toThrow();
    }
    expect(() => introHtml(text)).not.toThrow();
  });
});

describe('pageHtml', () => {
  const page = (head: string) =>
    `<!doctype html>\n<html lang="en">\n  <head>\n    ${head}\n  </head>\n  <body><script src="/assets/index-abc.js"></script></body>\n</html>\n`;

  test("puts the home page's head in one language and its lang attribute in place of index.html's", () => {
    const html = page(headTags(TEXT, 'https://example.com'));
    for (const language of ['en', 'zh'] as const) {
      const copy = pageHtml(html, TEXT, 'https://example.com', language);
      expect(copy, language).toBe(
        page(headTags(TEXT, 'https://example.com', language)).replace(
          '<html lang="en">',
          `<html lang="${language === 'zh' ? 'zh-CN' : 'en'}">`,
        ),
      );
      expect(copy, language).toContain('<script src="/assets/index-abc.js"></script>');
    }
    expect(pageIn('en')).toBe('index.en.html');
    expect(pageIn('zh')).toBe('index.zh.html');
  });

  test('stops the build when index.html has no head in both languages, or no lang attribute', () => {
    const head = headTags(TEXT, 'https://example.com');
    for (const html of [
      page(headTags(TEXT, null)),
      page(`${head}${head}`),
      page(head).replace('<html lang="en">', '<html>'),
    ]) {
      expect(() => pageHtml(html, TEXT, 'https://example.com', 'en')).toThrow(/^index.html must have /);
    }
  });
});

describe('introHtml', () => {
  test('introduces the game in both languages, each marked as its language, escaped', () => {
    const html = introHtml(TEXT);
    expect(html).toContain('<span lang="zh-CN">\u6e38\u620f</span>');
    expect(html).toContain('<span lang="en">Games &amp; &lt;fun&gt;</span>');
    expect(html).toContain('<p lang="en">Play &lt;b&gt;now&lt;/b&gt;.</p>');
    expect(html).toContain('<p lang="zh-CN">\u4ecb\u7ecd</p>');
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  test('keeps to classes of its own, as its stylesheet does, which loads with the app and stays', () => {
    const classes = [...introHtml(TEXT).matchAll(/class="([^"]+)"/g)].map((found) => found[1]);
    expect(classes.length).toBeGreaterThan(0);
    for (const name of classes) expect(name).toMatch(/^site-intro(-|$)/);
    // The pages have introductions of their own, `.intro`, which a bare selector here would restyle.
    const intro = readFileSync(join(import.meta.dirname, '..', 'styles', 'intro.css'), 'utf8');
    const selectors = intro.replace(/\/\*[\s\S]*?\*\//g, '').match(/^[^\s{}][^{\n]*(?=\{)/gm) ?? [];
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) expect(selector.trim()).toMatch(/^\.site-intro(-|\b)/);
  });
});

describe('robotsTxt', () => {
  test("keeps crawlers out of the players' paths, and names the sitemap when the site's address is known", () => {
    const robots = robotsTxt('https://example.com');
    expect(robots.split('\n')).toEqual([
      'User-agent: *',
      'Disallow: /room/',
      'Disallow: /account',
      'Disallow: /api/',
      'Disallow: /avatars/',
      'Disallow: /socket.io/',
      '',
      'Sitemap: https://example.com/sitemap.xml',
      '',
    ]);
    expect(robotsTxt(null)).not.toContain('Sitemap');
    // Players' public pages stay open to crawlers, which the page itself asks not to list them.
    expect(robots).not.toContain('/p/');
  });
});

describe('sitemapXml', () => {
  test('lists the home page in each language and as the language gate, each naming the others', () => {
    const xml = sitemapXml('https://example.com');
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((found) => found[1]);
    expect(locs).toEqual(['https://example.com/?lang=en', 'https://example.com/?lang=zh', 'https://example.com/']);
    const alternates = [
      '<xhtml:link rel="alternate" hreflang="en" href="https://example.com/?lang=en" />',
      '<xhtml:link rel="alternate" hreflang="zh-CN" href="https://example.com/?lang=zh" />',
      '<xhtml:link rel="alternate" hreflang="x-default" href="https://example.com/" />',
    ];
    for (const alternate of alternates) expect(xml.split(alternate)).toHaveLength(locs.length + 1);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
  });
});

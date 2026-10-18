import { effectScope, onBeforeUnmount, shallowRef, watchEffect } from 'vue';
import { i18n } from './i18n';

// The page's head as the app runs: the tab's title, the description that search engines show, the
// page's canonical address and whether search engines may list it. index.html comes with the title
// and the description of the home page in both languages (site.ts); each page puts its own in their
// place while it is shown, in the interface's language, and what a page doesn't say stays as
// index.html has it. A game's turn may put an urgent title over the page's for a while.

export interface Head {
  title?: string;
  description?: string;
  // The page's address, from the site's own (SITE_URL) and a path, or null while the site's is
  // unknown: the page then names none.
  canonical?: string | null;
  // Asks search engines not to list the page. Google reads it from the rendered page.
  noindex?: boolean;
}

const page = shallowRef<(() => Head) | null>(null);
const urgent = shallowRef<(() => string | null) | null>(null);
let started = false;

// A page's title, as the tab shows it: the page's own, then the site's name, "Your account ·
// Reviewer 2".
export const pageTitle = (page: string): string =>
  i18n.global.t('site.title', { page, site: i18n.global.t('app.name') });

// The site's address and a path, for a canonical link, or null without SITE_URL: where the page
// is may be one of several addresses of the site, and only the build says which is its own.
export const siteAddress = (path: string): string | null => (__SITE_URL__ === null ? null : `${__SITE_URL__}${path}`);

// The element of the head that `selector` finds, made with `attributes` when there is none.
function headElement(selector: string, tag: 'meta' | 'link', attributes: Record<string, string>): Element {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    document.head.append(element);
  }
  return element;
}

// Puts the current page's head in place from now on, whenever it or the language changes: the
// effect reads the page's function, which reads the messages it uses. What index.html had stands
// in for what a page leaves out.
function start(): void {
  if (started) return;
  started = true;
  const fallback = {
    title: document.title,
    description: document.head.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
  };
  effectScope(true).run(() => {
    watchEffect(() => {
      const head = page.value?.() ?? {};
      document.title = urgent.value?.() ?? head.title ?? fallback.title;
      headElement('meta[name="description"]', 'meta', { name: 'description' }).setAttribute(
        'content',
        head.description ?? fallback.description,
      );
      document.head.querySelector('link[rel="canonical"]')?.remove();
      if (head.canonical)
        headElement('link[rel="canonical"]', 'link', { rel: 'canonical' }).setAttribute('href', head.canonical);
      document.head.querySelector('meta[name="robots"]')?.remove();
      if (head.noindex)
        headElement('meta[name="robots"]', 'meta', { name: 'robots' }).setAttribute('content', 'noindex');
    });
  });
}

// A page's head while the page is shown. As it goes, it clears only its own, so that the head of a
// page that opened first stays.
export function usePageHead(head: () => Head): void {
  page.value = head;
  start();
  onBeforeUnmount(() => {
    if (page.value === head) page.value = null;
  });
}

// A title over the page's own, such as "Your turn!", while `title` gives one.
export function useUrgentTitle(title: () => string | null): void {
  urgent.value = title;
  start();
  onBeforeUnmount(() => {
    if (urgent.value === title) urgent.value = null;
  });
}

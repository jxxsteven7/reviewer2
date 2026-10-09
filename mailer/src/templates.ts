import { MAIL_PAGES, type MailRequest } from '@reviewer2/shared';
import en from './locales/en.json';
import zh from './locales/zh.json';

// The mails, from the templates in locales/, which are all that the mailer can write: a plain text
// and a plain HTML version of the same lines, without images or anything that tracks. Nothing in
// a mail comes from a player: the link is built here, from the site's address, the page for the
// kind of mail and the secret, which the request may only give in its fixed form.

interface Template {
  subject: string;
  lines: string[];
}

const TEMPLATES: Record<MailRequest['language'], Record<MailRequest['kind'], Template> & { footer: string }> = {
  en,
  zh,
};

export interface Mail {
  subject: string;
  text: string;
  html: string;
  link: string;
}

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// `baseUrl` is the site's own address, such as https://playreviewer2.com, without a slash at the end.
export function render({ kind, token, language }: MailRequest, baseUrl: string): Mail {
  const templates = TEMPLATES[language];
  const { subject, lines } = templates[kind];
  const link = `${baseUrl}${MAIL_PAGES[kind]}#${token}`;
  const text = [...lines.map((line) => line.replace('{link}', link)), '', templates.footer].join('\n\n');
  const paragraphs = lines.map((line) =>
    line === '{link}' ? `<p><a href="${escape(link)}">${escape(link)}</a></p>` : `<p>${escape(line)}</p>`,
  );
  const html = `<!doctype html><html lang="${language === 'zh' ? 'zh-CN' : 'en'}"><body>${paragraphs.join('')}<p style="color:#666">${escape(templates.footer)}</p></body></html>`;
  return { subject, text: text.replace(/\n{3,}/g, '\n\n'), html, link };
}

import { describe, expect, test } from 'vitest';
import type { Sample, Stats } from './stats';
import { duration, renderFeedbackPage, renderStatusPage, type FeedbackListing } from './statusPage';
import type { Feedback } from './store/feedback';

const MB = 2 ** 20;
const NOW = Date.UTC(2026, 9, 8, 12);

function stats(changes: Partial<Stats> = {}): Stats {
  return {
    version: 'v0.0.14',
    uptime: 3 * 3600 + 12 * 60,
    memory: { rss: 128 * MB, heapUsed: 21 * MB, limit: 512 * MB },
    rooms: { lobby: 2, playing: 3, ended: 1 },
    players: { online: 17, offline: 4 },
    connections: { websocket: 15, polling: 3 },
    countries: [
      { country: 'SG', connections: 9, latency: 38 },
      { country: 'CN', connections: 6, latency: 212 },
      { country: 'XX', connections: 3, latency: null },
    ],
    ...changes,
  };
}

// The text of the page without its tags, its style and extra whitespace.
const text = (html: string) =>
  html
    .replace(/<style>[\s\S]*<\/style>/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

describe('the status page', () => {
  test('shows the counts, the countries and the memory against its limit', () => {
    const page = text(renderStatusPage(stats(), [], NOW, 0, { total: 42, recent: 3 }));
    expect(page).toContain('Version v0.0.14 &middot; up 3h 12m');
    expect(page).toContain('Online 17');
    expect(page).toContain('Offline 4');
    expect(page).toContain('Accounts 42 registered New accounts 3 in the last 7 days');
    expect(page).toContain('Waiting 2 Playing 3 Game over 1');
    expect(page).toContain('WebSocket 15 Long-polling 3');
    expect(page).toContain('Singapore 9 38 ms');
    expect(page).toContain('China 6 212 ms');
    expect(page).toContain('Unknown 3 &ndash;');
    expect(page).toContain('Process 128 MB 25% of the 512 MB limit');
    expect(page).toContain('JavaScript heap 21 MB');
  });

  test('leaves out the share of memory when the system sets no limit', () => {
    const page = text(renderStatusPage(stats({ memory: { rss: 128 * MB, heapUsed: 21 * MB, limit: null } }), [], NOW));
    expect(page).toContain('Process 128 MB JavaScript heap');
    expect(page).not.toContain('% of');
  });

  test('says so when there are no connections', () => {
    expect(text(renderStatusPage(stats({ countries: [] }), [], NOW))).toContain('No connections.');
  });

  test('shows a code that no country has as it is, and escapes what it shows', () => {
    const page = renderStatusPage(
      stats({ version: '<b>dev</b>', countries: [{ country: 'QQ', connections: 1, latency: 5 }] }),
      [],
      NOW,
    );
    expect(page).toContain('&#60;b&#62;dev&#60;/b&#62;');
    expect(page).not.toContain('<b>');
    expect(text(page)).toContain('QQ 1 5 ms');
  });

  test('reloads itself and has no script', () => {
    const page = renderStatusPage(stats(), [], NOW);
    expect(page).toContain('<meta http-equiv="refresh" content="5">');
    expect(page).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(page).not.toMatch(/<script|\son[a-z]+=|javascript:|https?:\/\//i);
  });
});

describe('the chart', () => {
  const sample = (minutesAgo: number, players: number, rooms: number): Sample => ({
    at: NOW - minutesAgo * 60_000,
    players,
    rooms,
  });

  test('says when there are no samples yet', () => {
    expect(text(renderStatusPage(stats(), [], NOW))).toContain('No samples yet.');
  });

  test('draws the players online and the rooms from the first sample to the last, scaled from 0', () => {
    const page = renderStatusPage(stats(), [sample(120, 0, 0), sample(60, 8, 2), sample(0, 4, 1)], NOW);
    expect(page).toContain(
      '<polyline class="players" vector-effect="non-scaling-stroke" points="0,160 300,0 600,80"/>',
    );
    expect(page).toContain(
      '<polyline class="rooms" vector-effect="non-scaling-stroke" points="0,160 300,120 600,140"/>',
    );
    const labels = text(page);
    expect(labels).toContain(' 8 0 ');
    expect(labels).toContain('2h 0m ago now');
    expect(labels).toContain('Players online Rooms');
  });

  test('runs to now, and holds the last value until then', () => {
    // The last sample is up to 30 seconds old, and the clock may have been read later still.
    const page = renderStatusPage(stats(), [sample(120, 4, 1), sample(30, 8, 2)], NOW);
    expect(page).toContain('class="players" vector-effect="non-scaling-stroke" points="0,80 450,0 600,0"');
    expect(page).toContain('class="rooms" vector-effect="non-scaling-stroke" points="0,140 450,120 600,120"');
    expect(text(page)).toContain('2h 0m ago now');
  });

  test('draws a single sample as a level line', () => {
    const page = renderStatusPage(stats(), [sample(0, 2, 1)], NOW);
    expect(page).toContain('class="players" vector-effect="non-scaling-stroke" points="0,0 600,0"');
    expect(page).toContain('class="rooms" vector-effect="non-scaling-stroke" points="0,80 600,80"');
    expect(text(page)).toContain('0s ago now');
  });

  test('keeps a scale of at least 1, so that a quiet day is a line along the bottom', () => {
    const page = renderStatusPage(stats(), [sample(1, 0, 0), sample(0, 0, 0)], NOW);
    expect(page).toContain('points="0,160 600,160"');
    expect(text(page)).toContain(' 1 0 ');
  });
});

describe('the feedback', () => {
  const feedback = (id: number, changes: Partial<Feedback> = {}): Feedback => ({
    id,
    createdAt: '2026-10-09T13:05:42.123Z',
    kind: 'idea',
    text: 'More fields, please.',
    contact: null,
    credit: null,
    link: null,
    accountId: null,
    publicIssue: false,
    issue: null,
    username: null,
    acknowledgmentId: null,
    nameTakenBy: null,
    version: 'v0.0.15',
    language: 'en',
    page: 'home',
    userAgent: null,
    ...changes,
  });
  const page = (changes: Partial<FeedbackListing> = {}) =>
    renderFeedbackPage({ total: 0, entries: [], paged: false, older: false, ...changes });

  test('has a page of its own, which the status page counts and links to', () => {
    const status = renderStatusPage(stats(), [], NOW);
    expect(text(status)).toContain('Feedback None yet.');
    expect(status).toContain('<meta http-equiv="refresh" content="5">');
    const some = renderStatusPage(stats(), [], NOW, 12);
    expect(some).toContain('<p>12 in all &middot; <a href="/feedback">Read it</a></p>');
    expect(some).not.toContain('<article>');

    // The feedback page is for reading, so it doesn't reload.
    const html = page();
    expect(html).toContain('<title>Reviewer 2 feedback</title>');
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).toContain('<a href="/">Status</a>');
    expect(text(html)).toContain('Feedback 0 in all, newest first &middot; Status None yet.');
  });

  test('shows each one with what came along, the newest first', () => {
    const entries = [
      feedback(2, {
        kind: 'bug',
        text: 'Line one\nLine two',
        contact: 'wechat: r2',
        language: 'zh',
        page: 'room',
        userAgent: 'Mozilla/5.0',
      }),
      feedback(1),
    ];
    const html = page({ total: 2, entries });
    const shown = text(html);
    expect(shown).toContain('2 in all, newest first');
    expect(shown).toContain(
      '#2 &middot; Bug &middot; 2026-10-09 13:05 UTC &middot; version v0.0.15 &middot; Chinese &middot; from the room ' +
        '&middot; not to be published Line one Line two Contact: wechat: r2 No name for the acknowledgments ' +
        'Browser: Mozilla/5.0',
    );
    expect(shown).toContain(
      '#1 &middot; Idea &middot; 2026-10-09 13:05 UTC &middot; version v0.0.15 &middot; English &middot; ' +
        'from the home page &middot; not to be published More fields, please. No contact No name for the acknowledgments',
    );
    expect(shown.indexOf('#2')).toBeLessThan(shown.indexOf('#1'));
    // The text keeps its line breaks, which the page shows as they are.
    expect(html).toContain('<p class="text">Line one\nLine two</p>');
  });

  test('shows the name for the acknowledgments, with its account and whether it was adopted', () => {
    const shown = text(
      page({
        total: 3,
        entries: [
          feedback(3, { credit: 'Ann L', username: 'Ann', acknowledgmentId: 1 }),
          feedback(2, { credit: 'Bob', username: null }),
          feedback(1),
        ],
      }),
    );
    expect(shown).toContain('#3 &middot; Idea &middot; 2026-10-09 13:05 UTC');
    expect(shown).toContain(
      'from the home page &middot; adopted as acknowledgment #1 &middot; not to be published More fields, please.',
    );
    expect(shown).toContain('No contact Name for the acknowledgments: Ann L &middot; account Ann');
    expect(shown).toContain('#2 &middot; Idea');
    expect(shown).toContain('No contact Name for the acknowledgments: Bob #1');
    expect(shown).not.toContain('Bob &middot; account');
    expect(shown.match(/adopted as acknowledgment/g)).toHaveLength(1);
    expect(shown).not.toContain('also the username');
  });

  test('shows the link that came with the name, and whether it may be or was published as an issue', () => {
    const html = page({
      total: 3,
      entries: [
        feedback(3, { credit: 'Ann L', link: 'https://ann.example/', publicIssue: true, issue: 42 }),
        feedback(2, { publicIssue: true }),
        feedback(1, { publicIssue: null }),
      ],
    });
    const shown = text(html);
    expect(shown).toContain('from the home page &middot; published as issue #42 More fields');
    expect(shown).toContain('Name for the acknowledgments: Ann L &middot; link https://ann.example/');
    expect(html).toContain('from the home page &middot; <strong>may be published as an issue</strong>');
    // Feedback from before players were asked may not be.
    expect(shown).toContain('#1 &middot; Idea &middot; 2026-10-09 13:05 UTC &middot; version v0.0.15');
    expect(shown.match(/not to be published/g)).toHaveLength(1);
    // The link is shown, not linked.
    expect(html).not.toContain('href="https://ann.example/"');
  });

  test("points out a name that is another account's username, in bold", () => {
    const html = page({
      total: 2,
      entries: [
        feedback(2, { credit: 'cat', username: 'Bob', nameTakenBy: 'Cat' }),
        feedback(1, { credit: 'Cat', nameTakenBy: 'Cat' }),
      ],
    });
    expect(text(html)).toContain(
      "Name for the acknowledgments: cat &middot; account Bob &middot; also the username of the account Cat, which didn't send it",
    );
    expect(html).toContain(
      "Name for the acknowledgments: Cat &middot; <strong>also the username of the account Cat, which didn't send it</strong>",
    );
  });

  test('escapes everything that came from outside', () => {
    const html = page({
      total: 1,
      entries: [
        feedback(1, {
          kind: 'bug',
          text: '<script>alert("text")</script><img src=x onerror=alert(1)>',
          contact: "<a href='javascript:alert(1)'>me</a>",
          credit: '<i>Ann</i>',
          link: 'https://x.co/"><script>alert(1)</script>',
          username: '<u>ann</u>',
          nameTakenBy: '<s>Ann</s>',
          version: '<b>v1</b>',
          userAgent: '</p><script>alert("agent")</script>',
        }),
      ],
    });
    // The one link on the page is the page's own.
    expect(html.replace('<a href="/">Status</a>', '')).not.toMatch(
      /<script|<img|<a |<b>|<i>|<u>|<s>|onerror=alert\(1\)>/,
    );
    expect(html).toContain(
      'Name for the acknowledgments: &#60;i&#62;Ann&#60;/i&#62; &middot; link https://x.co/&#34;&#62;&#60;script&#62;' +
        'alert(1)&#60;/script&#62; &middot; account &#60;u&#62;ann&#60;/u&#62;',
    );
    expect(html).toContain('also the username of the account &#60;s&#62;Ann&#60;/s&#62;,');
    expect(html).toContain(
      '&#60;script&#62;alert(&#34;text&#34;)&#60;/script&#62;&#60;img src=x onerror=alert(1)&#62;',
    );
    expect(html).toContain('&#60;a href=&#39;javascript:alert(1)&#39;&#62;me&#60;/a&#62;');
    expect(html).toContain('version &#60;b&#62;v1&#60;/b&#62;');
    expect(html).toContain('Browser: &#60;/p&#62;&#60;script&#62;');
  });

  test('links to older feedback, and back to the latest', () => {
    const entries = [feedback(60), feedback(59)];
    expect(page({ total: 99, entries, older: true })).toContain(
      '<p class="more"><a href="/feedback?before=59">Older</a></p>',
    );
    expect(page({ total: 99, entries, paged: true, older: true })).toContain(
      '<p class="more"><a href="/feedback">Latest</a> &middot; <a href="/feedback?before=59">Older</a></p>',
    );
    expect(page({ total: 2, entries })).not.toContain('class="more"');
  });
});

test('duration', () => {
  expect(duration(0)).toBe('0s');
  expect(duration(59.9)).toBe('59s');
  expect(duration(60)).toBe('1m');
  expect(duration(3599)).toBe('59m');
  expect(duration(3600)).toBe('1h 0m');
  expect(duration(3 * 86_400 + 4 * 3600 + 59)).toBe('3d 4h');
});

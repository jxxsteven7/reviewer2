import { describe, expect, test } from 'vitest';
import type { Sample, Stats } from './stats';
import {
  duration,
  NO_FEEDBACK,
  renderFeedbackPage,
  renderReportsPage,
  renderStatusPage,
  type FeedbackListing,
} from './statusPage';
import type { Feedback, Report } from './store/feedback';

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

// Nothing on the pages comes from elsewhere, runs or sends anything.
const INERT = /<script|<form|<input|<button|<link|<iframe|\son[a-z]+=|javascript:|https?:\/\//i;

describe('the status page', () => {
  test('shows the counts, the countries and the memory against its limit', () => {
    const page = text(renderStatusPage(stats(), [], NOW, NO_FEEDBACK, { total: 42, recent: 3 }));
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
    expect(page).not.toContain('<b>dev');
    expect(text(page)).toContain('QQ 1 5 ms');
  });

  test('reloads itself, has no script and nothing from elsewhere, and leads to the other pages', () => {
    const page = renderStatusPage(stats(), [], NOW);
    expect(page).toContain('<meta http-equiv="refresh" content="5">');
    expect(page).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(page).not.toMatch(INERT);
    expect(page).toContain('<h1>Reviewer 2 status</h1>');
    expect(page).toContain(
      '<nav aria-label="Pages"><a href="/" aria-current="page">Status</a><a href="/feedback">Feedback</a>' +
        '<a href="/reports">Reports</a></nav>',
    );
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

describe('the reports', () => {
  const report = (id: number, changes: Partial<Report> = {}): Report => ({
    id,
    createdAt: '2026-10-09T13:05:00.000Z',
    reporter: 'Ann',
    reported: 'Bob',
    reportedId: 2,
    reportedBarred: false,
    reportedName: 'Bob',
    roomCode: 'K7QX',
    text: null,
    ...changes,
  });

  test('have a page of their own, which the status page counts and links to', () => {
    expect(text(renderStatusPage(stats(), [], NOW))).toContain('Reports None yet.');
    expect(renderStatusPage(stats(), [], NOW, NO_FEEDBACK, { total: 0, recent: 0 }, 3)).toContain(
      '<p class="note">3 in all &middot; <a href="/reports">Read them</a></p>',
    );
    const html = renderReportsPage({ total: 1, entries: [report(1)], paged: false, older: false });
    expect(html).toContain('<title>Reviewer 2 reports</title>');
    expect(html).toContain('<h1>Reports</h1>');
    expect(html).toContain('<a href="/reports" aria-current="page">Reports</a>');
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).not.toMatch(INERT);
    expect(text(html)).toContain(
      'bar a reported account from public rooms with admin.cjs accounts bar &lt;username&gt;',
    );
    expect(text(html)).toContain(
      '#1 &middot; 2026-10-09 13:05 UTC &middot; room R2-K7QX Bob (account Bob) Reported by Ann No note',
    );
  });

  test('escape what players wrote, and say what became of the accounts', () => {
    const html = renderReportsPage({
      total: 2,
      entries: [
        report(2, {
          reporter: null,
          reported: null,
          reportedId: null,
          reportedName: '<i>Guest</i>',
          text: '<script>x</script>',
        }),
        report(1, { reported: '<b>Bob</b>', reporter: '<u>Ann</u>', reportedBarred: true }),
      ],
      paged: false,
      older: false,
    });
    expect(html).not.toMatch(/<script>|<i>|<b>Bob|<u>/);
    expect(html).toContain('<p class="text">&#60;i&#62;Guest&#60;/i&#62; (no account)</p>');
    expect(html).toContain('<p class="meta">Reported by a deleted account</p>');
    expect(html).toContain('<p class="text">&#60;script&#62;x&#60;/script&#62;</p>');
    expect(html).toContain('account &#60;b&#62;Bob&#60;/b&#62; &middot; <strong>barred from public rooms</strong>');
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
    resolvedPr: null,
    resolvedAt: null,
    closedAt: null,
    deletedAt: null,
    status: 'new',
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
    renderFeedbackPage({
      total: 0,
      statuses: NO_FEEDBACK.statuses,
      kinds: {},
      view: 'open',
      kind: null,
      entries: [],
      paged: false,
      older: false,
      now: NOW,
      ...changes,
    });
  // What the page shows between the heading and the entries.
  const head = (html: string) => text(html.slice(0, html.indexOf('<article>')));

  test('has a page of its own, which the status page counts by status and links to', () => {
    const status = renderStatusPage(stats(), [], NOW);
    expect(text(status)).toContain('Feedback None yet.');
    expect(status).toContain('<meta http-equiv="refresh" content="5">');
    const some = renderStatusPage(stats(), [], NOW, {
      total: 12,
      statuses: { new: 3, issue: 2, resolved: 1, thanked: 2, closed: 3, trash: 1 },
    });
    expect(some).toContain(
      '<p class="pills"><a class="badge" href="/feedback">Open <b>8</b></a>' +
        '<a class="badge new" href="/feedback?status=new">New <b>3</b></a>' +
        '<a class="badge issue" href="/feedback?status=issue">Issue <b>2</b></a>' +
        '<a class="badge resolved" href="/feedback?status=resolved">Resolved <b>1</b></a>' +
        '<a class="badge thanked" href="/feedback?status=thanked">Thanked <b>2</b></a>' +
        '<a class="badge closed" href="/feedback?status=closed">Closed <b>3</b></a>' +
        '<a class="badge trash" href="/feedback?status=trash">Trash <b>1</b></a></p>' +
        '<p class="note">12 in all &middot; <a href="/feedback">Read it</a></p>',
    );
    expect(some).not.toContain('<article>');

    // The feedback page is for reading, so it doesn't reload, and nothing on it changes anything.
    const html = page();
    expect(html).toContain('<title>Reviewer 2 feedback</title>');
    expect(html).toContain('<h1>Feedback</h1>');
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).not.toMatch(INERT);
    expect(html).toContain('<a href="/">Status</a><a href="/feedback" aria-current="page">Feedback</a>');
    expect(text(html)).toContain(
      '0 in all, newest first &middot; what became of it is changed with admin.cjs feedback None yet.',
    );
  });

  test('shows each one with what came along and its status, the newest first', () => {
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
    const html = page({ total: 2, statuses: { ...NO_FEEDBACK.statuses, new: 2 }, kinds: { bug: 1, idea: 1 }, entries });
    const shown = text(html);
    expect(shown).toContain('2 in all, newest first');
    expect(shown).toContain(
      '#2 &middot; Bug &middot; 2026-10-09 13:05 UTC New Line one Line two version v0.0.15 &middot; Chinese ' +
        '&middot; from the room &middot; not to be published Contact: wechat: r2 No name for the acknowledgments ' +
        'Browser: Mozilla/5.0',
    );
    expect(shown).toContain(
      '#1 &middot; Idea &middot; 2026-10-09 13:05 UTC New More fields, please. version v0.0.15 &middot; English ' +
        '&middot; from the home page &middot; not to be published No contact No name for the acknowledgments',
    );
    expect(shown.indexOf('#2')).toBeLessThan(shown.indexOf('#1'));
    // The text keeps its line breaks, which the page shows as they are, and the status is a badge.
    expect(html).toContain('<p class="text">Line one\nLine two</p>');
    expect(html).toContain('<span class="badge new">New</span>');
    expect(html).not.toContain('class="trail"');
  });

  test('shows the name for the acknowledgments, with its account and whether it was adopted', () => {
    const html = page({
      total: 3,
      entries: [
        feedback(3, { credit: 'Ann L', username: 'Ann', acknowledgmentId: 1, status: 'thanked' }),
        feedback(2, { credit: 'Bob', username: null }),
        feedback(1),
      ],
    });
    const shown = text(html);
    expect(shown).toContain(
      '#3 &middot; Idea &middot; 2026-10-09 13:05 UTC Thanked More fields, please. thanked as acknowledgment #1 ' +
        'version v0.0.15',
    );
    expect(html).toContain('<span class="badge thanked">Thanked</span>');
    expect(shown).toContain('No contact Name for the acknowledgments: Ann L &middot; account Ann');
    expect(shown).toContain('#2 &middot; Idea');
    expect(shown).toContain('No contact Name for the acknowledgments: Bob #1');
    expect(shown).not.toContain('Bob &middot; account');
    expect(shown.match(/thanked as acknowledgment/g)).toHaveLength(1);
    expect(shown).not.toContain('also the username');
  });

  test('shows the link that came with the name, and whether it may be or was published as an issue', () => {
    const html = page({
      total: 3,
      entries: [
        feedback(3, { credit: 'Ann L', link: 'https://ann.example/', publicIssue: true, issue: 42, status: 'issue' }),
        feedback(2, { publicIssue: true }),
        feedback(1, { publicIssue: null }),
      ],
    });
    const shown = text(html);
    expect(html).toContain('<span class="badge issue">Issue #42</span>');
    expect(html).toContain('<p class="trail">published as issue #42</p>');
    expect(shown).toContain(
      'More fields, please. published as issue #42 version v0.0.15 &middot; English &middot; from the home page No contact',
    );
    expect(shown).toContain('Name for the acknowledgments: Ann L &middot; link https://ann.example/');
    expect(html).toContain('from the home page &middot; <strong>may be published as an issue</strong>');
    // Feedback from before players were asked may not be.
    expect(shown).toContain('#1 &middot; Idea &middot; 2026-10-09 13:05 UTC New More fields');
    expect(shown.match(/not to be published/g)).toHaveLength(1);
    // The link is shown, not linked.
    expect(html).not.toContain('href="https://ann.example/"');
  });

  test('shows the whole trail of what became of it, and how long the trash has left', () => {
    const html = page({
      total: 4,
      entries: [
        feedback(4, { resolvedPr: 50, resolvedAt: '2026-10-05T10:00:00.000Z', status: 'resolved' }),
        feedback(3, {
          issue: 42,
          resolvedPr: 50,
          resolvedAt: '2026-10-05T10:00:00.000Z',
          acknowledgmentId: 7,
          closedAt: '2026-10-06T10:00:00.000Z',
          status: 'closed',
        }),
        feedback(2, { closedAt: '2026-10-06T10:00:00.000Z', deletedAt: '2026-10-07T09:00:00.000Z', status: 'trash' }),
        feedback(1, { deletedAt: '2026-09-08T11:59:59.000Z', status: 'trash' }),
      ],
    });
    expect(html).toContain('<span class="badge resolved">PR #50</span>');
    expect(html).toContain('<p class="trail">resolved by PR #50</p>');
    expect(html).toContain('<span class="badge closed">Closed</span>');
    expect(html).toContain(
      '<p class="trail">published as issue #42 &middot; resolved by PR #50 &middot; thanked as acknowledgment #7 ' +
        '&middot; closed 2026-10-06</p>',
    );
    expect(html).toContain('<span class="badge trash">Trash</span>');
    // Put in the trash a day and three hours ago, it has 29 days left; past its 30 days, none.
    expect(html).toContain(
      '<p class="trail">closed 2026-10-06 &middot; in the trash since 2026-10-07, 29 days left</p>',
    );
    expect(html).toContain('<p class="trail">in the trash since 2026-09-08, 0 days left</p>');
    expect(
      page({ total: 1, entries: [feedback(1, { deletedAt: '2026-09-09T12:00:00.000Z', status: 'trash' })] }),
    ).toContain('in the trash since 2026-09-09, 1 day left');
    // Adopted on its way to the trash, it is kept there, however long ago it went in.
    expect(
      page({
        total: 1,
        entries: [feedback(1, { deletedAt: '2026-08-01T12:00:00.000Z', acknowledgmentId: 3, status: 'trash' })],
      }),
    ).toContain(
      '<p class="trail">thanked as acknowledgment #3 &middot; in the trash since 2026-08-01, kept: thanked</p>',
    );
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
          kind: '<i>later</i>' as Feedback['kind'],
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
    // The only links on the page are the page's own.
    expect(html.replace(/<nav[\s\S]*?<\/nav>/, '').replace(/<div class="filters">[\s\S]*?<\/div>/, '')).not.toMatch(
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
    expect(html).toContain('#1 &middot; &#60;i&#62;later&#60;/i&#62; &middot;');
    expect(html).toContain('version &#60;b&#62;v1&#60;/b&#62;');
    expect(html).toContain('Browser: &#60;/p&#62;&#60;script&#62;');
  });

  test('shows each view with how much there is of it, of the kind shown, and the open feedback by default', () => {
    const statuses = { new: 2, issue: 1, resolved: 1, thanked: 1, closed: 2, trash: 1 };
    const open = page({ total: 8, statuses, kinds: { idea: 3, game: 2 }, entries: [feedback(8)] });
    expect(open).toContain(
      '<p class="pills"><strong>Open <b>5</b></strong><a href="/feedback?status=new">New <b>2</b></a>' +
        '<a href="/feedback?status=issue">Issue <b>1</b></a><a href="/feedback?status=resolved">Resolved <b>1</b></a>' +
        '<a href="/feedback?status=thanked">Thanked <b>1</b></a><a href="/feedback?status=closed">Closed <b>2</b></a>' +
        '<a href="/feedback?status=trash">Trash <b>1</b></a></p>',
    );
    const trash = page({ total: 8, statuses, kinds: { idea: 1 }, view: 'trash', entries: [feedback(3)], kind: 'idea' });
    expect(trash).toContain('<a href="/feedback?kind=idea">Open <b>5</b></a>');
    expect(trash).toContain('<strong>Trash <b>1</b></strong>');
    expect(trash).toContain('<a href="/feedback?status=closed&amp;kind=idea">Closed <b>2</b></a>');
    expect(page({ total: 8, statuses, view: 'closed' })).toContain('<p class="note">None here.</p>');
    // Nothing to choose from while there is no feedback at all.
    expect(page()).not.toContain('class="pills"');
  });

  test('shows each kind with how much there is of it in the view, and the feedback of one kind', () => {
    const kinds = { idea: 1, game: 2, later: 1 };
    const statuses = { ...NO_FEEDBACK.statuses, new: 4 };
    const all = page({
      total: 4,
      statuses,
      kinds,
      entries: [feedback(4, { kind: 'game' }), feedback(3, { kind: 'later' as Feedback['kind'] }), feedback(2)],
    });
    expect(all).toContain(
      '<p class="pills"><strong>All <b>4</b></strong><a href="/feedback?kind=idea">Idea <b>1</b></a>' +
        '<a href="/feedback?kind=game">New game <b>2</b></a><a href="/feedback?kind=bug">Bug <b>0</b></a>' +
        '<a href="/feedback?kind=words">Word lists <b>0</b></a></p>',
    );
    expect(head(all)).toContain('Open 4 New 4 Issue 0');
    expect(text(all)).toContain('#4 &middot; New game &middot; 2026-10-09');
    // A kind from a later server, which this one was rolled back from, shows as it is.
    expect(text(all)).toContain('#3 &middot; later &middot; 2026-10-09');

    const games = page({ total: 4, statuses, kinds, kind: 'game', entries: [feedback(4, { kind: 'game' })] });
    expect(games).toContain(
      '<p class="pills"><a href="/feedback">All <b>4</b></a><a href="/feedback?kind=idea">Idea <b>1</b></a>' +
        '<strong>New game <b>2</b></strong>',
    );
    expect(games).toContain('<a href="/feedback?status=trash&amp;kind=game">Trash <b>0</b></a>');
    expect(games).not.toContain('None here.');
    expect(page({ total: 4, statuses, kinds, kind: 'bug' })).toContain('<strong>Bug <b>0</b></strong>');
    expect(page({ total: 4, statuses, kinds, kind: 'bug' })).toContain('<p class="note">None here.</p>');
  });

  test('links to older feedback, and back to the latest, keeping the view and the kind', () => {
    const entries = [feedback(60), feedback(59)];
    expect(page({ total: 99, entries, older: true })).toContain(
      '<p class="more"><a href="/feedback?before=59">Older</a></p>',
    );
    expect(page({ total: 99, entries, paged: true, older: true })).toContain(
      '<p class="more"><a href="/feedback">Latest</a> &middot; <a href="/feedback?before=59">Older</a></p>',
    );
    expect(page({ total: 2, entries })).not.toContain('class="more"');
    expect(page({ total: 99, kind: 'game', entries, paged: true, older: true })).toContain(
      '<p class="more"><a href="/feedback?kind=game">Latest</a> &middot; ' +
        '<a href="/feedback?kind=game&amp;before=59">Older</a></p>',
    );
    expect(page({ total: 99, view: 'closed', kind: 'game', entries, paged: true, older: true })).toContain(
      '<p class="more"><a href="/feedback?status=closed&amp;kind=game">Latest</a> &middot; ' +
        '<a href="/feedback?status=closed&amp;kind=game&amp;before=59">Older</a></p>',
    );
    // Paged back to where there is nothing, the way back is still there.
    expect(page({ total: 99, view: 'trash', paged: true })).toContain('<a href="/feedback?status=trash">Latest</a>');
    expect(page({ total: 99, view: 'trash', paged: true })).not.toContain('None here.');
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

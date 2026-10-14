import { describe, expect, test } from 'vitest';
import type { Sample, Stats } from './stats';
import {
  DEFAULT_ADMIN_COMMAND,
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
    agents: null,
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

  test('shows the AI players on a server with an agent, and nothing of them without one', () => {
    expect(text(renderStatusPage(stats(), [], NOW))).not.toContain('AI players');
    const up = text(renderStatusPage(stats({ agents: { players: 3, up: true, steps: 40, failures: 1 } }), [], NOW));
    expect(up).toContain('AI players Agent Up In rooms 3 Steps 40 in the last hour Failed 1 in the last hour');
    const down = text(renderStatusPage(stats({ agents: { players: 0, up: false, steps: 0, failures: 0 } }), [], NOW));
    expect(down).toContain('Agent Down');
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
    accountId: null,
    linkProfile: false,
    issue: null,
    resolvedPr: null,
    resolvedAt: null,
    adoptedAt: null,
    summaryZh: null,
    summaryEn: null,
    closedAt: null,
    deletedAt: null,
    status: 'new',
    username: null,
    nameTakenBy: null,
    version: 'v0.0.15',
    language: 'en',
    page: 'home',
    userAgent: null,
    ...changes,
  });
  const page = (changes: Partial<FeedbackListing> = {}) =>
    renderFeedbackPage(
      {
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
      },
      { admin: DEFAULT_ADMIN_COMMAND },
    );
  // What the page shows between the heading and the entries.
  const head = (html: string) => text(html.slice(0, html.indexOf('<article>')));

  test('has a page of its own, which the status page counts by status and links to', () => {
    const status = renderStatusPage(stats(), [], NOW);
    expect(text(status)).toContain('Feedback None yet.');
    expect(status).toContain('<meta http-equiv="refresh" content="5">');
    // Open is new and issue alone; one piece of feedback was resolved and thanked, and counts in both.
    const some = renderStatusPage(stats(), [], NOW, {
      total: 11,
      statuses: { new: 3, issue: 2, resolved: 1, thanked: 2, closed: 3, trash: 1 },
    });
    expect(some).toContain(
      '<p class="pills"><a class="badge" href="/feedback">Open <b>5</b></a>' +
        '<a class="badge new" href="/feedback?status=new">New <b>3</b></a>' +
        '<a class="badge issue" href="/feedback?status=issue">Issue <b>2</b></a>' +
        '<a class="badge resolved" href="/feedback?status=resolved">Resolved <b>1</b></a>' +
        '<a class="badge thanked" href="/feedback?status=thanked">Thanked <b>2</b></a>' +
        '<a class="badge closed" href="/feedback?status=closed">Closed <b>3</b></a>' +
        '<a class="badge trash" href="/feedback?status=trash">Trash <b>1</b></a></p>' +
        '<p class="note">11 in all &middot; <a href="/feedback">Read it</a></p>',
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
        '&middot; from the room Contact: wechat: r2 No name: listed as anonymous Browser: Mozilla/5.0',
    );
    expect(shown).toContain(
      '#1 &middot; Idea &middot; 2026-10-09 13:05 UTC New More fields, please. version v0.0.15 &middot; English ' +
        '&middot; from the home page No contact No name: listed as anonymous',
    );
    expect(shown.indexOf('#2')).toBeLessThan(shown.indexOf('#1'));
    // The text keeps its line breaks, which the page shows as they are, and the status is a badge.
    expect(html).toContain('<p class="text">Line one\nLine two</p>');
    expect(html).toContain('<span class="badge new">New</span>');
    expect(html).not.toContain('class="trail"');
  });

  test('shows the name for the contributions, the account it came from, and what was adopted', () => {
    const html = page({
      total: 4,
      entries: [
        feedback(4, { username: 'Ann' }),
        feedback(3, {
          credit: 'Ann L',
          username: 'Ann',
          issue: 42,
          adoptedAt: '2026-10-08T10:00:00.000Z',
          summaryZh: '提出了更多领域',
          summaryEn: 'Suggested more fields',
          status: 'thanked',
        }),
        feedback(2, {
          credit: 'Bob',
          username: null,
          issue: 41,
          adoptedAt: '2026-10-08T10:00:00.000Z',
          status: 'thanked',
        }),
        feedback(1),
      ],
    });
    const shown = text(html);
    expect(shown).toContain(
      '#3 &middot; Idea &middot; 2026-10-09 13:05 UTC Thanked More fields, please. published as issue #42 ' +
        '&middot; adopted 2026-10-08 Contributed: 提出了更多领域 &middot; Suggested more fields version v0.0.15',
    );
    expect(html).toContain('<span class="badge thanked">Thanked</span>');
    expect(shown).toContain('No contact Name for the contributions: Ann L &middot; account Ann');
    // Adopted before what the player contributed was written, as the migration leaves it.
    expect(shown).toContain('adopted 2026-10-08 Contributed: not written yet version');
    expect(shown).toContain('No contact Name for the contributions: Bob Commands');
    expect(shown).not.toContain('Bob &middot; account');
    // An account without a name: listed as anonymous, and counted for the account.
    expect(shown).toContain('No contact No name: listed as anonymous &middot; account Ann Commands');
    expect(shown.match(/Contributed:/g)).toHaveLength(2);
    expect(shown).not.toContain('also the username');
  });

  test('shows the issue it was published as', () => {
    const html = page({
      total: 2,
      entries: [feedback(2, { credit: 'Ann L', issue: 42, status: 'issue' }), feedback(1)],
    });
    const shown = text(html);
    expect(html).toContain('<span class="badge issue">Issue #42</span>');
    expect(html).toContain('<p class="trail">published as issue #42</p>');
    expect(shown).toContain(
      'More fields, please. published as issue #42 version v0.0.15 &middot; English &middot; from the home page No contact',
    );
    expect(shown).not.toMatch(/published\b(?! as issue)/);
  });

  test('shows the whole trail of what became of it, and how long the trash has left', () => {
    const html = page({
      total: 6,
      entries: [
        feedback(6, { issue: 41, adoptedAt: '2026-10-06T10:00:00.000Z', status: 'thanked' }),
        feedback(5, {
          resolvedPr: 72,
          resolvedAt: '2026-10-05T10:00:00.000Z',
          issue: 40,
          adoptedAt: '2026-10-05T11:00:00.000Z',
          status: 'thanked',
        }),
        feedback(4, { resolvedPr: 50, resolvedAt: '2026-10-05T10:00:00.000Z', status: 'resolved' }),
        feedback(3, {
          issue: 42,
          resolvedPr: 50,
          resolvedAt: '2026-10-05T10:00:00.000Z',
          adoptedAt: '2026-10-05T12:00:00.000Z',
          closedAt: '2026-10-06T10:00:00.000Z',
          status: 'closed',
        }),
        feedback(2, { closedAt: '2026-10-06T10:00:00.000Z', deletedAt: '2026-10-07T09:00:00.000Z', status: 'trash' }),
        feedback(1, { deletedAt: '2026-09-08T11:59:59.000Z', status: 'trash' }),
      ],
    });
    // The badge writes out all that the feedback came to: resolved, thanked, or both.
    expect(html).toContain('<span class="badge resolved">Resolved #50</span>');
    expect(html).toContain('<span class="badge thanked">Resolved #72 &middot; Thanked</span>');
    expect(html).toContain('<span class="badge thanked">Thanked</span>');
    expect(html).toContain('<p class="trail">resolved by PR #50</p>');
    expect(html).toContain('<span class="badge closed">Closed</span>');
    expect(html).toContain(
      '<p class="trail">published as issue #42 &middot; resolved by PR #50 &middot; adopted 2026-10-05 ' +
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
        entries: [
          feedback(1, {
            deletedAt: '2026-08-01T12:00:00.000Z',
            adoptedAt: '2026-07-31T12:00:00.000Z',
            status: 'trash',
          }),
        ],
      }),
    ).toContain('<p class="trail">adopted 2026-07-31 &middot; in the trash since 2026-08-01, kept: thanked</p>');
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
      "Name for the contributions: cat &middot; account Bob &middot; also the username of the account Cat, which didn't send it",
    );
    expect(html).toContain(
      "Name for the contributions: Cat &middot; <strong>also the username of the account Cat, which didn't send it</strong>",
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
          username: '<u>ann</u>',
          adoptedAt: '2026-10-08T10:00:00.000Z',
          summaryZh: '<b>提出</b>',
          summaryEn: '<script>alert("summary")</script>',
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
      'Name for the contributions: &#60;i&#62;Ann&#60;/i&#62; &middot; account &#60;u&#62;ann&#60;/u&#62;',
    );
    expect(html).toContain(
      'Contributed: &#60;b&#62;提出&#60;/b&#62; &middot; &#60;script&#62;alert(&#34;summary&#34;)&#60;/script&#62;',
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

  // The commands under one piece of feedback, each with its note, as the page shows them.
  const commands = (html: string) =>
    [...html.matchAll(/<p class="command"><code>(.*?)<\/code>(.*?)<\/p>/g)].map(([, code, note]) => `${code}${note}`);
  const RUN = 'node server/dist/admin.cjs feedback';

  test('lists the commands that may come next, by what became of it, folded under each one', () => {
    const of = (changes: Partial<Feedback>) => commands(page({ total: 1, entries: [feedback(7, changes)] }));
    const SENTENCES = '--zh &#34;&#60;sentence&#62;&#34; --en &#34;&#60;sentence&#62;&#34;';
    // New: the issue's draft first, and nothing to adopt until it is an issue.
    expect(of({})).toEqual([
      `${RUN} draft 7`,
      `${RUN} issue 7 &#60;number&#62;`,
      `${RUN} resolve 7 &#60;pr&#62;`,
      `${RUN} close 7`,
      `${RUN} delete 7`,
    ]);
    // A kind this build doesn't know, from a later server, has no draft, which the command would
    // refuse, but the issue can still be recorded.
    expect(of({ kind: 'later' as Feedback['kind'] })).toEqual([
      `${RUN} issue 7 &#60;number&#62;`,
      `${RUN} resolve 7 &#60;pr&#62;`,
      `${RUN} close 7`,
      `${RUN} delete 7`,
    ]);
    // Published: never deleted, since the issue is public.
    expect(of({ issue: 42, status: 'issue' })).toEqual([
      `${RUN} issue 7 --clear`,
      `${RUN} resolve 7 &#60;pr&#62;`,
      `${RUN} adopt 7 ${SENTENCES} can't be undone`,
      `${RUN} close 7`,
    ]);
    // Published and resolved: either can be taken back, there is nothing to draft, and it may be
    // adopted, but not deleted: the issue is public, so it is closed instead.
    expect(of({ issue: 42, resolvedPr: 50, status: 'resolved' })).toEqual([
      `${RUN} issue 7 --clear`,
      `${RUN} resolve 7 --clear`,
      `${RUN} adopt 7 ${SENTENCES} can't be undone`,
      `${RUN} close 7`,
    ]);
    // Thanked: neither adopted again, its issue taken back nor deleted, but what the player
    // contributed may be said again.
    expect(of({ issue: 42, adoptedAt: '2026-10-08T10:00:00.000Z', status: 'thanked' })).toEqual([
      `${RUN} resolve 7 &#60;pr&#62;`,
      `${RUN} describe 7 ${SENTENCES}`,
      `${RUN} close 7`,
    ]);
    // Closed: reopened rather than closed, and not adopted; as an issue, still not deleted.
    expect(of({ issue: 42, closedAt: '2026-10-06T10:00:00.000Z', status: 'closed' })).toEqual([
      `${RUN} issue 7 --clear`,
      `${RUN} resolve 7 &#60;pr&#62;`,
      `${RUN} reopen 7`,
    ]);
    expect(
      of({ issue: 42, closedAt: '2026-10-06T10:00:00.000Z', adoptedAt: '2026-10-05T10:00:00.000Z', status: 'closed' }),
    ).toEqual([`${RUN} resolve 7 &#60;pr&#62;`, `${RUN} describe 7 ${SENTENCES}`, `${RUN} reopen 7`]);
    // Closed with no issue yet: the draft is still offered, as the issue is.
    expect(of({ closedAt: '2026-10-06T10:00:00.000Z', status: 'closed' })).toEqual([
      `${RUN} draft 7`,
      `${RUN} issue 7 &#60;number&#62;`,
      `${RUN} resolve 7 &#60;pr&#62;`,
      `${RUN} reopen 7`,
      `${RUN} delete 7`,
    ]);
    // In the trash, only the way out, whatever else became of it.
    expect(of({ deletedAt: '2026-10-07T09:00:00.000Z', status: 'trash' })).toEqual([`${RUN} restore 7`]);
    expect(
      of({
        issue: 42,
        resolvedPr: 50,
        adoptedAt: '2026-10-05T10:00:00.000Z',
        closedAt: '2026-10-06T10:00:00.000Z',
        deletedAt: '2026-10-07T09:00:00.000Z',
        status: 'trash',
      }),
    ).toEqual([`${RUN} restore 7`]);

    // Folded by default, at the end of the entry, as text alone: nothing on the page runs them.
    const html = page({ total: 1, entries: [feedback(7, { userAgent: 'Mozilla/5.0' })] });
    expect(html).toContain(
      '<p class="meta">Browser: Mozilla/5.0</p><details><summary>Commands</summary>' +
        `<p class="command"><code>${RUN} draft 7</code></p>` +
        `<p class="command"><code>${RUN} issue 7 &#60;number&#62;</code></p>`,
    );
    const adoptable = page({ total: 1, entries: [feedback(7, { issue: 42, status: 'issue' })] });
    expect(adoptable).toContain(
      `<p class="command"><code>${RUN} adopt 7 --zh &#34;&#60;sentence&#62;&#34; --en &#34;&#60;sentence&#62;&#34;</code> ` +
        "can't be undone</p>",
    );
    expect(html).toContain(`<p class="command"><code>${RUN} delete 7</code></p></details></article>`);
    expect(html).not.toContain('<details open');
    expect(html).not.toMatch(INERT);
    expect(html).toContain('user-select: all');
  });

  test('puts how admin.cjs is run in front of the commands, the default unless told, escaped', () => {
    const listing: FeedbackListing = {
      total: 1,
      statuses: { ...NO_FEEDBACK.statuses, new: 1 },
      kinds: { idea: 1 },
      view: 'open',
      kind: null,
      entries: [feedback(1)],
      paged: false,
      older: false,
      now: NOW,
    };
    expect(commands(renderFeedbackPage(listing, { admin: DEFAULT_ADMIN_COMMAND }))).toContain(`${RUN} close 1`);
    expect(commands(renderFeedbackPage(listing, { admin: 'npm run admin --' }))).toEqual([
      'npm run admin -- feedback draft 1',
      'npm run admin -- feedback issue 1 &#60;number&#62;',
      'npm run admin -- feedback resolve 1 &#60;pr&#62;',
      'npm run admin -- feedback close 1',
      'npm run admin -- feedback delete 1',
    ]);
    // The operator set it, and it is escaped all the same.
    const odd = renderFeedbackPage(listing, { admin: '<script>x</script> "a" & \'b\'' });
    expect(odd).toContain(
      '<code>&#60;script&#62;x&#60;/script&#62; &#34;a&#34; &#38; &#39;b&#39; feedback close 1</code>',
    );
    expect(odd).not.toMatch(INERT);
  });

  test("puts the operator's feedback command in front of every command, with publish first where it may", () => {
    const listing = (changes: Partial<Feedback>): FeedbackListing => ({
      total: 1,
      statuses: { ...NO_FEEDBACK.statuses, new: 1 },
      kinds: { idea: 1 },
      view: 'open',
      kind: null,
      entries: [feedback(7, changes)],
      paged: false,
      older: false,
      now: NOW,
    });
    const run = { admin: DEFAULT_ADMIN_COMMAND, feedback: 'triage-feedback' };
    expect(commands(renderFeedbackPage(listing({}), run))).toEqual([
      'triage-feedback publish 7 publishes the issue in one go',
      'triage-feedback draft 7',
      'triage-feedback issue 7 &#60;number&#62;',
      'triage-feedback resolve 7 &#60;pr&#62;',
      'triage-feedback close 7',
      'triage-feedback delete 7',
    ]);
    // Once it is an issue, the operator's command adopts it as it records the pull request, and
    // asks for the sentences itself; there is no adopt, and no delete.
    expect(commands(renderFeedbackPage(listing({ issue: 42, status: 'issue' }), run))).toEqual([
      'triage-feedback issue 7 --clear',
      "triage-feedback resolve 7 &#60;pr&#62; records the pull request and adopts it, which can't be undone",
      'triage-feedback close 7',
    ]);
    expect(
      commands(
        renderFeedbackPage(listing({ issue: 42, adoptedAt: '2026-10-02T00:00:00.000Z', status: 'thanked' }), run),
      ),
    ).toEqual(['triage-feedback resolve 7 &#60;pr&#62;', 'triage-feedback describe 7', 'triage-feedback close 7']);
    expect(commands(renderFeedbackPage(listing({ deletedAt: '2026-10-01T00:00:00.000Z' }), run))).toEqual([
      'triage-feedback restore 7',
    ]);
    // No publish once the issue is recorded, nor for a kind this build doesn't know, which it
    // couldn't draft.
    for (const changes of [{ issue: 42, status: 'issue' as const }, { kind: 'later' as Feedback['kind'] }]) {
      const shown = commands(renderFeedbackPage(listing(changes), run));
      expect(
        shown.filter((command) => command.includes(' publish ')),
        JSON.stringify(changes),
      ).toEqual([]);
      expect(
        shown.every((command) => command.startsWith('triage-feedback ')),
        JSON.stringify(changes),
      ).toBe(true);
    }
    // Without it, the page is as it was: no publish.
    expect(commands(renderFeedbackPage(listing({}), { admin: DEFAULT_ADMIN_COMMAND }))[0]).toBe(`${RUN} draft 7`);
    // The operator set it, and it is escaped all the same.
    const odd = renderFeedbackPage(listing({}), { ...run, feedback: '<b>go</b>' });
    expect(odd).toContain('<code>&#60;b&#62;go&#60;/b&#62; publish 7</code>');
    expect(odd).not.toMatch(INERT);
  });

  test('shows each view with how much there is of it, of the kind shown, and the open feedback by default', () => {
    const statuses = { new: 2, issue: 1, resolved: 1, thanked: 1, closed: 2, trash: 1 };
    const open = page({ total: 8, statuses, kinds: { idea: 3, game: 2 }, entries: [feedback(8)] });
    expect(open).toContain(
      '<p class="pills"><strong>Open <b>3</b></strong><a href="/feedback?status=new">New <b>2</b></a>' +
        '<a href="/feedback?status=issue">Issue <b>1</b></a><a href="/feedback?status=resolved">Resolved <b>1</b></a>' +
        '<a href="/feedback?status=thanked">Thanked <b>1</b></a><a href="/feedback?status=closed">Closed <b>2</b></a>' +
        '<a href="/feedback?status=trash">Trash <b>1</b></a></p>',
    );
    const trash = page({ total: 8, statuses, kinds: { idea: 1 }, view: 'trash', entries: [feedback(3)], kind: 'idea' });
    expect(trash).toContain('<a href="/feedback?kind=idea">Open <b>3</b></a>');
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

import { FEEDBACK_KINDS, formatCode, type FeedbackKind } from '@reviewer2/shared';
import { UNKNOWN_COUNTRY } from './core/clientIp';
import { megabytes, type Sample, type Stats } from './stats';
import type { Feedback, Report } from './store/feedback';

// The status page (status.ts) as one HTML document, built on the server from the numbers, the
// page of the feedback that players sent, and the page of the reports they sent of each other.
// None has a script: the status page reloads itself every 5 seconds, and its chart is inline SVG;
// the other two don't reload, so that the operator can read a long bug report or copy a contact
// in peace. All are for the operator alone, so their text is in English only and not in the
// locale files.

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #f7f6f2; --fg: #1f1e1b; --muted: #67655e; --line: #dedcd5; --tile: #ffffff;
  --players: #2a64c2; --rooms: #b4541f;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #171716; --fg: #ebe9e3; --muted: #a09e97; --line: #34332f; --tile: #21201e;
    --players: #78a8f2; --rooms: #ec9360;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.4 system-ui, sans-serif; }
main { max-width: 720px; margin: 0 auto; padding: 16px; }
h1 { font-size: 1.3rem; margin: 0 0 4px; }
h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 24px 0 8px; }
p { margin: 0; color: var(--muted); }
dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; margin: 0; }
dl div { background: var(--tile); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
dt { color: var(--muted); font-size: 0.85rem; }
dd { margin: 2px 0 0; font-size: 1.5rem; font-variant-numeric: tabular-nums; }
dd small { display: block; font-size: 0.8rem; color: var(--muted); }
table { width: 100%; border-collapse: collapse; margin-top: 8px; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--line); }
th { font-weight: normal; color: var(--muted); font-size: 0.85rem; }
.number { text-align: right; }
.chart { display: grid; grid-template-columns: auto 1fr; column-gap: 6px; font-size: 0.8rem; color: var(--muted); }
.chart svg { width: 100%; height: 160px; background: var(--tile); border: 1px solid var(--line); border-radius: 4px; }
.y { display: flex; flex-direction: column; justify-content: space-between; text-align: right; }
.x { grid-column: 2; display: flex; justify-content: space-between; }
polyline { fill: none; stroke-width: 2; stroke-linejoin: round; }
.players { stroke: var(--players); background: var(--players); }
.rooms { stroke: var(--rooms); background: var(--rooms); }
.key { display: inline-block; width: 12px; height: 3px; margin: 0 6px 3px 0; vertical-align: middle; }
.legend { margin-top: 8px; }
.legend span + span { margin-left: 16px; }
article { background: var(--tile); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin-top: 8px; }
article p { font-size: 0.85rem; overflow-wrap: anywhere; }
article .text { margin: 6px 0; color: var(--fg); font-size: 1rem; white-space: pre-wrap; }
.more { margin-top: 12px; }
.kinds { margin-top: 8px; }
.kinds a, .kinds strong { white-space: nowrap; }
.kinds strong { color: var(--fg); }
a { color: var(--players); }
`;

const regions = new Intl.DisplayNames(['en'], { type: 'region' });

function countryName(code: string): string {
  if (code === UNKNOWN_COUNTRY) return 'Unknown';
  try {
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
}

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// A length of time as a person would say it, to the largest two units: "3d 4h", "2h 5m", "40s".
export function duration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.floor(seconds)}s`;
}

const mb = (bytes: number) => `${megabytes(bytes)} MB`;

function tile(label: string, value: string | number, note = ''): string {
  return `<div><dt>${label}</dt><dd>${value}${note ? `<small>${note}</small>` : ''}</dd></div>`;
}

function countries(stats: Stats): string {
  if (stats.countries.length === 0) return '<p>No connections.</p>';
  const rows = stats.countries.map(
    ({ country, connections, latency }) =>
      `<tr><td>${escape(countryName(country))}</td><td class="number">${connections}</td>` +
      `<td class="number">${latency === null ? '&ndash;' : `${latency} ms`}</td></tr>`,
  );
  return (
    '<table><thead><tr><th>Country or region</th><th class="number">Connections</th>' +
    `<th class="number">Latency, median</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
  );
}

// The chart runs from the first sample there is, up to 24 hours back, to now, and its scale
// starts at 0. `now` is read off the clock that the samples were taken on.
const WIDTH = 600;
const HEIGHT = 160;

function chart(samples: readonly Sample[], now: number): string {
  const first = samples[0];
  if (!first) return '<p>No samples yet. The first is taken 30 seconds after the server starts.</p>';
  const span = Math.max(now - first.at, 1);
  const top = Math.max(1, ...samples.map(({ players, rooms }) => Math.max(players, rooms)));
  const x = (sample: Sample) => Math.round(((sample.at - first.at) / span) * WIDTH);
  const y = (value: number) => Math.round(HEIGHT - (value / top) * HEIGHT);
  const last = samples.at(-1) as Sample;
  const line = (key: 'players' | 'rooms') => {
    const points = samples.map((sample) => `${x(sample)},${y(sample[key])}`);
    // The last value holds until now, so a single sample is a level line across the chart rather
    // than a point nobody can see.
    if (x(last) < WIDTH) points.push(`${WIDTH},${y(last[key])}`);
    return `<polyline class="${key}" vector-effect="non-scaling-stroke" points="${points.join(' ')}"/>`;
  };
  return (
    '<div class="chart">' +
    `<div class="y"><span>${top}</span><span>0</span></div>` +
    `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none" aria-hidden="true">${line('rooms')}${line('players')}</svg>` +
    `<div class="x"><span>${duration(Math.max(0, now - first.at) / 1000)} ago</span><span>now</span></div>` +
    '</div>' +
    '<p class="legend"><span><i class="key players"></i>Players online</span><span><i class="key rooms"></i>Rooms</span></p>'
  );
}

// One page of the feedback that players sent (store/feedback.ts), newest first: the latest, or
// those before an id that the operator paged back to, of every kind or of one.
export interface FeedbackListing {
  total: number;
  // How much there is of each kind, and the kind that the page shows, or null for every kind.
  kinds: Record<string, number>;
  kind: FeedbackKind | null;
  entries: readonly Feedback[];
  // Whether the page was paged back from the latest.
  paged: boolean;
  // Whether there is older feedback than the last entry on the page.
  older: boolean;
}

// One page of the reports that players sent of each other (store/feedback.ts), paged as the
// feedback is.
export interface ReportListing {
  total: number;
  entries: readonly Report[];
  paged: boolean;
  older: boolean;
}

const KINDS: Record<FeedbackKind, string> = { idea: 'Idea', game: 'New game', bug: 'Bug', words: 'Word lists' };
const LANGUAGES: Record<Feedback['language'], string> = { zh: 'Chinese', en: 'English' };
const PAGES: Record<Feedback['page'], string> = { home: 'home page', room: 'room' };

// "2026-10-09 13:05 UTC" from the ISO time that the database keeps.
const when = (iso: string) => iso.replace('T', ' ').replace(/:\d{2}(\.\d+)?Z$/, ' UTC');

// Players wrote the text, the contact, the name and the link, and the page sent the version, so all
// of it is escaped like anything else that comes from outside, and the link is shown, not linked.
// The text keeps its line breaks. The name for the acknowledgments comes with its link, the account
// it was given from, the acknowledgment once the feedback has been adopted (admin.ts), and, in
// bold, with another account whose username it is, which may be someone passing for that
// account's owner. Whether the player agreed to a public issue says whether the operator may
// publish the feedback as one; older feedback, from before players were asked, may not be. A kind
// that this server doesn't know, from a later one that it was rolled back from, shows as it is.
function entry(feedback: Feedback): string {
  const facts = [
    `#${feedback.id}`,
    (KINDS as Partial<Record<string, string>>)[feedback.kind] ?? escape(feedback.kind),
    escape(when(feedback.createdAt)),
    `version ${escape(feedback.version)}`,
    LANGUAGES[feedback.language],
    `from the ${PAGES[feedback.page]}`,
    ...(feedback.acknowledgmentId === null ? [] : [`adopted as acknowledgment #${feedback.acknowledgmentId}`]),
    feedback.issue === null
      ? feedback.publicIssue
        ? '<strong>may be published as an issue</strong>'
        : 'not to be published'
      : `published as issue #${feedback.issue}`,
  ];
  const credit =
    feedback.credit === null
      ? 'No name for the acknowledgments'
      : `Name for the acknowledgments: ${escape(feedback.credit)}` +
        (feedback.link === null ? '' : ` &middot; link ${escape(feedback.link)}`) +
        (feedback.username === null ? '' : ` &middot; account ${escape(feedback.username)}`) +
        (feedback.nameTakenBy === null
          ? ''
          : ` &middot; <strong>also the username of the account ${escape(feedback.nameTakenBy)}, ` +
            "which didn't send it</strong>");
  return (
    `<article><p>${facts.join(' &middot; ')}</p>` +
    `<p class="text">${escape(feedback.text)}</p>` +
    `<p>${feedback.contact === null ? 'No contact' : `Contact: ${escape(feedback.contact)}`}</p>` +
    `<p>${credit}</p>` +
    (feedback.userAgent === null ? '' : `<p>Browser: ${escape(feedback.userAgent)}</p>`) +
    '</article>'
  );
}

export const FEEDBACK_PATH = '/feedback';

// The address of the feedback of a kind, or of every kind, from before an id when one is given.
function feedbackHref(kind: FeedbackKind | null, before?: number): string {
  const query = [...(kind === null ? [] : [`kind=${kind}`]), ...(before === undefined ? [] : [`before=${before}`])];
  return query.length === 0 ? FEEDBACK_PATH : `${FEEDBACK_PATH}?${query.join('&amp;')}`;
}

// The kinds to choose from, each with how much there is of it, the one shown in bold.
function kindChoices({ total, kinds, kind: shown }: FeedbackListing): string {
  const choice = (kind: FeedbackKind | null, label: string, count: number) =>
    kind === shown ? `<strong>${label} (${count})</strong>` : `<a href="${feedbackHref(kind)}">${label} (${count})</a>`;
  const choices = [
    choice(null, 'All', total),
    ...FEEDBACK_KINDS.map((kind) => choice(kind, KINDS[kind], kinds[kind] ?? 0)),
  ];
  return `<p class="kinds">${choices.join(' &middot; ')}</p>`;
}

// The feedback page: the kinds, the entries of one page, and the way to the latest and to the
// older ones.
function feedbackList(listing: FeedbackListing): string {
  const { total, kind, entries, paged, older } = listing;
  if (total === 0) return '<p>None yet.</p>';
  const links = [
    ...(paged ? [`<a href="${feedbackHref(kind)}">Latest</a>`] : []),
    ...(older ? [`<a href="${feedbackHref(kind, (entries.at(-1) as Feedback).id)}">Older</a>`] : []),
  ];
  return (
    kindChoices(listing) +
    (kind !== null && entries.length === 0 && !paged ? '<p>None of this kind yet.</p>' : '') +
    entries.map(entry).join('') +
    (links.length > 0 ? `<p class="more">${links.join(' &middot; ')}</p>` : '')
  );
}

export const REPORTS_PATH = '/reports';

// A report of a player (docs/architecture.md#public-rooms): who reported whom, by username, the
// name the player reported had in the room, with their account if they had one, the room, by its
// number as players see it, and the note. An account that is gone is said to be; one the operator
// has barred is marked.
function report({ id, createdAt, reporter, reported, reportedBarred, reportedName, roomCode, text }: Report): string {
  const account =
    reported === null
      ? 'no account'
      : `account ${escape(reported)}${reportedBarred ? ' &middot; <strong>barred from public rooms</strong>' : ''}`;
  return (
    `<article><p>#${id} &middot; ${escape(when(createdAt))} &middot; room ${escape(formatCode(roomCode))}</p>` +
    `<p class="text">${escape(reportedName)} (${account})</p>` +
    `<p>Reported by ${reporter === null ? 'a deleted account' : escape(reporter)}</p>` +
    (text === null ? '<p>No note</p>' : `<p class="text">${escape(text)}</p>`) +
    '</article>'
  );
}

// The reports page: the entries of one page, and the way to the latest and to the older ones.
function reportList({ total, entries, paged, older }: ReportListing): string {
  if (total === 0) return '<p>None yet.</p>';
  const links = [
    ...(paged ? [`<a href="${REPORTS_PATH}">Latest</a>`] : []),
    ...(older ? [`<a href="${REPORTS_PATH}?before=${(entries.at(-1) as Report).id}">Older</a>`] : []),
  ];
  return entries.map(report).join('') + (links.length > 0 ? `<p class="more">${links.join(' &middot; ')}</p>` : '');
}

// One document, as both pages are built. The status page reloads itself; the feedback page
// doesn't.
function document(title: string, body: string, reloads: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${reloads ? '<meta http-equiv="refresh" content="5">\n' : ''}<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}</main>
</body>
</html>
`;
}

// What the page says of the accounts: how many there are, and how many were created in the last
// 7 days. Nothing else about them goes on the page.
export interface AccountCounts {
  total: number;
  recent: number;
}

// `now` is the time on the clock that the samples were taken on (History in stats.ts), and
// `feedback` and `reports` are how many there are in all, which their pages show.
export function renderStatusPage(
  stats: Stats,
  samples: readonly Sample[],
  now: number,
  feedback = 0,
  accounts: AccountCounts = { total: 0, recent: 0 },
  reports = 0,
): string {
  const { memory } = stats;
  // The limit is the service's as a whole, with its file cache (stats.ts); this is the process's
  // share of it.
  const share =
    memory.limit === null ? '' : `${Math.round((memory.rss / memory.limit) * 100)}% of the ${mb(memory.limit)} limit`;
  return document(
    'Reviewer 2 status',
    `<h1>Reviewer 2 status</h1>
<p>Version ${escape(stats.version)} &middot; up ${duration(stats.uptime)} &middot; reloads every 5 seconds</p>
<h2>Players</h2>
<dl>${tile('Online', stats.players.online)}${tile('Offline', stats.players.offline, 'with a seat to come back to')}${tile('Accounts', accounts.total, 'registered')}${tile('New accounts', accounts.recent, 'in the last 7 days')}</dl>
<h2>Rooms</h2>
<dl>${tile('Waiting', stats.rooms.lobby)}${tile('Playing', stats.rooms.playing)}${tile('Game over', stats.rooms.ended)}</dl>
<h2>Connections</h2>
<dl>${tile('WebSocket', stats.connections.websocket)}${tile('Long-polling', stats.connections.polling)}</dl>
${countries(stats)}
<h2>Memory</h2>
<dl>${tile('Process', mb(memory.rss), share)}${tile('JavaScript heap', mb(memory.heapUsed))}</dl>
<h2>Last 24 hours</h2>
${chart(samples, now)}
<h2>Feedback</h2>
<p>${feedback === 0 ? 'None yet.' : `${feedback} in all &middot; <a href="${FEEDBACK_PATH}">Read it</a>`}</p>
<h2>Reports</h2>
<p>${reports === 0 ? 'None yet.' : `${reports} in all &middot; <a href="${REPORTS_PATH}">Read them</a>`}</p>
`,
    true,
  );
}

// The feedback that players sent, newest first, a page at a time.
export function renderFeedbackPage(feedback: FeedbackListing): string {
  return document(
    'Reviewer 2 feedback',
    `<h1>Feedback</h1>
<p>${feedback.total} in all, newest first &middot; <a href="/">Status</a> &middot; <a href="${REPORTS_PATH}">Reports</a></p>
${feedbackList(feedback)}
`,
    false,
  );
}

// The reports that players sent of each other, newest first, a page at a time.
export function renderReportsPage(reports: ReportListing): string {
  return document(
    'Reviewer 2 reports',
    `<h1>Reports</h1>
<p>${reports.total} in all, newest first &middot; <a href="/">Status</a> &middot; <a href="${FEEDBACK_PATH}">Feedback</a></p>
<p>Bar a reported account from public rooms with <code>admin.cjs accounts bar &lt;username&gt;</code>.</p>
${reportList(reports)}
`,
    false,
  );
}

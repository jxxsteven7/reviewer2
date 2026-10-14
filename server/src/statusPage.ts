import { formatCode, type FeedbackKind } from '@reviewer2/shared';
import { UNKNOWN_COUNTRY } from './core/clientIp';
import { megabytes, type Sample, type Stats } from './stats';
import { daysLeft, type Feedback, type FeedbackStatus, type FeedbackView, type Report } from './store/feedback';

// The status page (status.ts) as one HTML document, built on the server from the numbers, the
// page of the feedback that players sent, and the page of the reports they sent of each other.
// None has a script, a form or anything loaded from elsewhere: the style is inline, the chart is
// inline SVG and the type is the system's. The status page reloads itself every 5 seconds; the
// other two don't, so that the operator can read a long bug report or copy a contact in peace.
// All are for the operator alone, so their text is in English only and not in the locale files.
//
// The look is the game's, quieter (docs/design.md): its ink, paper and colors, panels with an ink
// outline and a hard shadow, and round corners, on the quiet paper rather than the yellow table.
// Text reads at 4.5:1 or more on whatever it is on, and what can be focused shows it.

const STYLE = `
:root {
  --bg: #f4efe6; --paper: #ffffff; --ink: #1a1a2e; --ink-2: #4b4b60; --line: #bdb6a8;
  --yellow: #ffd23f; --blue: #2d5bff; --blue-tint: #d5dfff; --blue-deep: #1f44d6;
  --red: #f2543d; --red-tint: #ffd6cf; --neutral: #bdb6a8; --focus: #2d5bff;
  --outline: 2px; --radius: 12px; --shadow: 3px 3px 0 var(--ink);
}
* { box-sizing: border-box; }
html { color-scheme: light; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 500 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
}
main { max-width: 64rem; margin: 0 auto; padding: 16px 16px 48px; }
header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 20px; margin: 8px 0 4px; }
h1 { font-size: 1.5rem; font-weight: 800; margin: 0; }
nav a { font-weight: 700; margin-right: 14px; }
nav [aria-current] { text-decoration-thickness: 3px; text-underline-offset: 3px; }
.sub { color: var(--ink-2); margin: 0 0 20px; }
section, article {
  background: var(--paper); border: var(--outline) solid var(--ink); border-radius: var(--radius);
  box-shadow: var(--shadow); padding: 14px 16px 16px; margin: 0 0 20px;
}
h2 { font-size: 0.8rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-2); margin: 0 0 10px; }
p { margin: 0; }
a { color: var(--blue-deep); }
a:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin: 0; }
dl div { background: var(--bg); border-radius: 8px; padding: 10px 12px; }
dt { color: var(--ink-2); font-size: 0.85rem; font-weight: 700; }
dd { margin: 2px 0 0; font-size: 1.6rem; font-weight: 800; line-height: 1.2; font-variant-numeric: tabular-nums; }
dd small { display: block; font-size: 0.8rem; font-weight: 500; color: var(--ink-2); }
table { width: 100%; border-collapse: collapse; margin-top: 12px; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--line); }
th { font-weight: 700; color: var(--ink-2); font-size: 0.85rem; }
.number { text-align: right; }
.note { color: var(--ink-2); margin-top: 8px; }
.chart { display: grid; grid-template-columns: auto 1fr; column-gap: 8px; font-size: 0.8rem; color: var(--ink-2); }
.chart svg { width: 100%; height: 160px; background: var(--bg); border-radius: 8px; }
.y { display: flex; flex-direction: column; justify-content: space-between; text-align: right; font-weight: 700; }
.x { grid-column: 2; display: flex; justify-content: space-between; }
polyline { fill: none; stroke-width: 2.5; stroke-linejoin: round; }
.players { stroke: var(--blue); background: var(--blue); }
.rooms { stroke: var(--red); background: var(--red); }
.key { display: inline-block; width: 14px; height: 4px; margin: 0 6px 3px 0; border-radius: 2px; vertical-align: middle; }
.legend { margin-top: 8px; font-weight: 700; }
.legend span + span { margin-left: 16px; }
.pills { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; }
.pills + .pills { margin-top: 10px; }
.pills a, .pills strong, .badge {
  display: inline-block; padding: 1px 10px; border: var(--outline) solid var(--ink); border-radius: 999px;
  background: var(--paper); color: var(--ink); font-size: 0.85rem; font-weight: 700; text-decoration: none;
  white-space: nowrap; line-height: 1.5;
}
.pills a:hover { background: var(--bg); }
.pills strong { background: var(--ink); color: var(--yellow); }
.badge.new { background: var(--yellow); }
.badge.issue { background: var(--blue-tint); }
.badge.resolved { background: var(--ink); color: var(--yellow); }
.badge.closed { background: var(--neutral); }
.badge.trash { background: var(--red-tint); }
.pills a b, .badge b { font-weight: 800; }
.filters { margin: 0 0 16px; }
article { padding: 12px 16px 14px; margin: 0 0 14px; }
.head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 6px 12px; }
.head span:not(.badge) { color: var(--ink-2); font-size: 0.85rem; font-weight: 700; }
.text { margin: 8px 0; font-size: 1.05rem; white-space: pre-wrap; overflow-wrap: anywhere; }
.trail { margin: 0 0 6px; font-weight: 700; }
.meta { color: var(--ink-2); font-size: 0.85rem; overflow-wrap: anywhere; }
.more { margin: 4px 0 0; font-weight: 700; }
/* The summary's padding makes it 44px to tap, as the game's targets are (docs/design.md), and its
   negative margins keep the layout as it was: folded, the card ends as it did without it, and the
   sides give the focus ring, drawn inside the padding, room beside the marker. Open, a margin below
   keeps the ring off the first command. */
details { margin: 0 0 -12px; }
details[open] { margin-bottom: 0; }
summary {
  cursor: pointer; padding: 12px 6px; margin: 0 -6px; border-radius: 4px; color: var(--ink-2); font-size: 0.85rem;
  font-weight: 700;
}
details[open] > summary { margin-bottom: 4px; }
summary:focus-visible { outline: 3px solid var(--focus); outline-offset: -3px; }
.command { color: var(--ink-2); font-size: 0.85rem; }
.command + .command { margin-top: 6px; }
.command code {
  display: inline-block; max-width: 100%; padding: 1px 8px; border-radius: 6px; background: var(--bg); color: var(--ink);
  font: 500 0.8rem/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  overflow-wrap: anywhere; user-select: all;
}
@media (max-width: 30rem) {
  main { padding: 12px 12px 40px; }
  section, article { padding: 12px 12px 14px; }
}
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
  if (stats.countries.length === 0) return '<p class="note">No connections.</p>';
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
  if (!first) return '<p class="note">No samples yet. The first is taken 30 seconds after the server starts.</p>';
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

// What the feedback page shows, one row of choices: all of it, in the trash too until it is
// purged; the open feedback, which nobody has dealt with yet, that is, the new; or the feedback of
// one of the other statuses (store/feedback.ts). None overlaps another but all.
export const FEEDBACK_VIEWS = ['all', 'open', 'issue', 'resolved', 'closed', 'trash'] as const;
export type PageView = (typeof FEEDBACK_VIEWS)[number];

// The feedback that a view of the page reads.
export const storeView = (view: PageView): FeedbackView => (view === 'open' ? 'new' : view);

// One page of the feedback that players sent (store/feedback.ts), newest first: the latest, or
// those before an id that the operator paged back to, of one view.
export interface FeedbackListing {
  // How much feedback there is in all, the trash included.
  total: number;
  // How much there is of each status.
  statuses: Record<FeedbackStatus, number>;
  view: PageView;
  entries: readonly Feedback[];
  // Whether the page was paged back from the latest.
  paged: boolean;
  // Whether there is older feedback than the last entry on the page.
  older: boolean;
  // The time, in milliseconds since 1970, for how long what is in the trash has left.
  now: number;
}

// One page of the reports that players sent of each other (store/feedback.ts), paged as the
// feedback is.
export interface ReportListing {
  total: number;
  entries: readonly Report[];
  paged: boolean;
  older: boolean;
}

// What the page calls the kinds, and the title of an issue does (admin.ts).
export const KINDS: Record<FeedbackKind, string> = { idea: 'Idea', game: 'New game', bug: 'Bug', words: 'Word lists' };
const LANGUAGES: Record<Feedback['language'], string> = { zh: 'Chinese', en: 'English' };
const PAGES: Record<Feedback['page'], string> = { home: 'home page', room: 'room' };
const VIEWS: Record<PageView, string> = {
  all: 'All',
  open: 'Open',
  issue: 'Issued',
  resolved: 'Resolved',
  closed: 'Closed',
  trash: 'Trash',
};
// What the badges of the statuses say that need nothing more.
const BADGES: Record<'new' | 'closed' | 'trash', string> = { new: 'New', closed: 'Closed', trash: 'Trash' };

// What the feedback page puts in front of the arguments of the commands it shows, unless
// ADMIN_COMMAND (config.ts) says how admin.cjs is run where the server is.
export const DEFAULT_ADMIN_COMMAND = 'node server/dist/admin.cjs';

// What the commands that the feedback page shows are made of: how admin.cjs is run (`admin`), or,
// where the operator has one, a command of theirs that takes the subcommands of `admin.cjs
// feedback`, and `publish <id>`, which publishes the feedback as an issue in one go (`feedback`,
// FEEDBACK_COMMAND in config.ts).
export interface FeedbackCommands {
  admin: string;
  feedback?: string | null;
}

// "2026-10-09 13:05 UTC" from the ISO time that the database keeps, and "2026-10-09" alone.
const when = (iso: string) => iso.replace('T', ' ').replace(/:\d{2}(\.\d+)?Z$/, ' UTC');
const day = (iso: string) => iso.slice(0, 10);

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

// The badge of a status, in its colors, with what it stands for written out: for feedback that
// waits as an issue, the issue's number and the pull request's, when one was recorded without the
// adoption, such as "Issue #77 &middot; PR #76", which tells the operator that the adoption is
// still to come; for resolved feedback, that is, adopted, the pull request's number and the
// issue's, such as "Resolved &middot; PR #76 &middot; issue #77".
function badge(feedback: Feedback): string {
  const { status, issue, resolvedPr } = feedback;
  const pr = resolvedPr === null ? [] : [`PR #${resolvedPr}`];
  const label =
    status === 'issue'
      ? [...(issue === null ? [] : [`Issue #${issue}`]), ...pr].join(' &middot; ')
      : status === 'resolved'
        ? ['Resolved', ...pr, ...(issue === null ? [] : [`issue #${issue}`])].join(' &middot; ')
        : BADGES[status];
  return `<span class="badge ${status}">${label}</span>`;
}

// Everything that became of the feedback, in the order it happens, or '' for feedback that is
// new. The days left in the trash count from `now`; feedback that was adopted or is an issue,
// which only feedback adopted or recorded on its way to the trash is, or feedback in the trash as
// an issue from before issues kept feedback out of it, is kept there instead (store/feedback.ts).
function trail(feedback: Feedback, now: number): string {
  const steps = [
    ...(feedback.issue === null ? [] : [`published as issue #${feedback.issue}`]),
    ...(feedback.resolvedPr === null ? [] : [`resolved by PR #${feedback.resolvedPr}`]),
    ...(feedback.adoptedAt === null ? [] : [`adopted ${escape(day(feedback.adoptedAt))}`]),
    ...(feedback.closedAt === null ? [] : [`closed ${escape(day(feedback.closedAt))}`]),
    ...(feedback.deletedAt === null
      ? []
      : [
          `in the trash since ${escape(day(feedback.deletedAt))}, ` +
            (feedback.adoptedAt !== null
              ? 'kept: adopted'
              : feedback.issue !== null
                ? 'kept: issue'
                : `${plural(daysLeft(feedback.deletedAt, now), 'day')} left`),
        ]),
  ];
  return steps.length === 0 ? '' : `<p class="trail">${steps.join(' &middot; ')}</p>`;
}

// The `admin.cjs feedback` commands that may come next for the feedback (admin.ts), as text for
// the operator to copy to a terminal, each on a line of its own with `run.feedback` in front where
// the operator has that command, and `run.admin` and `feedback` otherwise, under a heading that is
// folded until it is opened. Which they are follows the feedback's status. In the trash, only the
// way out. Otherwise: the issue: first, with the operator's command, to publish it in one go, when
// this build knows the kind; then, to do it by hand, to draft it, when this build knows the kind,
// and to record it; or, once there is one, to take it back unless it was adopted, which keeps its
// issue. Then the pull request, to record or to take back. Adopting it, once it is an issue, while
// it is neither adopted nor closed, which can't be undone: the operator's command adopts it as it
// records the pull request, and asks for what the player contributed itself, so `adopt` and the
// sentences show only without it; once it is adopted, saying again what the player contributed.
// Last, closing it, unless it was adopted, or reopening it, and the trash, unless it was adopted
// or is an issue. The page shows the commands and runs none of them.
function commands(feedback: Feedback, run: FeedbackCommands): string {
  const { id, kind, issue, resolvedPr, adoptedAt, closedAt, deletedAt } = feedback;
  const prefix = run.feedback ? run.feedback : `${run.admin} feedback`;
  const sentences = run.feedback ? '' : ' --zh "<sentence>" --en "<sentence>"';
  const adoptable = issue !== null && adoptedAt === null && closedAt === null;
  const line = (command: string, note = '') =>
    `<p class="command"><code>${escape(`${prefix} ${command}`)}</code>${note === '' ? '' : ` ${note}`}</p>`;
  const known = Object.hasOwn(KINDS, kind);
  const lines =
    deletedAt !== null
      ? [line(`restore ${id}`)]
      : [
          ...(issue === null
            ? [
                ...(run.feedback && known ? [line(`publish ${id}`, 'publishes the issue in one go')] : []),
                ...(known ? [line(`draft ${id}`)] : []),
                line(`issue ${id} <number>`),
              ]
            : adoptedAt === null
              ? [line(`issue ${id} --clear`)]
              : []),
          ...(run.feedback && adoptable
            ? [line(`resolve ${id} <pr>`, "records the pull request and adopts it, which can't be undone")]
            : [line(resolvedPr === null ? `resolve ${id} <pr>` : `resolve ${id} --clear`)]),
          ...(adoptedAt !== null
            ? [line(`describe ${id}${sentences}`)]
            : !run.feedback && adoptable
              ? [line(`adopt ${id}${sentences}`, "can't be undone")]
              : []),
          ...(closedAt !== null ? [line(`reopen ${id}`)] : adoptedAt === null ? [line(`close ${id}`)] : []),
          ...(adoptedAt === null && issue === null ? [line(`delete ${id}`)] : []),
        ];
  return `<details><summary>Commands</summary>${lines.join('')}</details>`;
}

// Players wrote the text, the contact and the name, the operator what the player contributed, and
// the page sent the version, so all of it is escaped like anything else that comes from outside.
// The text keeps its line breaks. The top line is the id, the kind and the time, with the status
// at its end; the trail, when there is one, comes after the text, and, for adopted feedback, what
// the player contributed, as the home page shows it; the rest below: the version, the language,
// the page it came from, the contact, the name for the feedback contributions, the account it was
// sent from, whether the player signed it with that account, and, in bold,
// another account whose username the name is, which may be someone passing for that account's
// owner, for a bug the browser, and last the commands that may come next (`run`), folded. A kind
// that this server doesn't know, from a later one that it was rolled back from, shows as it is.
function entry(feedback: Feedback, now: number, run: FeedbackCommands): string {
  const head = [
    `#${feedback.id}`,
    (KINDS as Partial<Record<string, string>>)[feedback.kind] ?? escape(feedback.kind),
    escape(when(feedback.createdAt)),
  ];
  const facts = [
    `version ${escape(feedback.version)}`,
    LANGUAGES[feedback.language],
    `from the ${PAGES[feedback.page]}`,
  ];
  const credit =
    (feedback.credit === null
      ? 'No name: listed as anonymous'
      : `Name for the contributions: ${escape(feedback.credit)}`) +
    (feedback.username === null ? '' : ` &middot; account ${escape(feedback.username)}`) +
    (feedback.credit === null || feedback.username === null || !feedback.linkProfile
      ? ''
      : ' &middot; signed with the account') +
    (feedback.credit === null || feedback.nameTakenBy === null
      ? ''
      : ` &middot; <strong>also the username of the account ${escape(feedback.nameTakenBy)}, ` +
        "which didn't send it</strong>");
  const contributed =
    feedback.adoptedAt === null
      ? ''
      : feedback.summaryZh === null || feedback.summaryEn === null
        ? '<p class="meta">Contributed: <strong>not written yet</strong></p>'
        : `<p class="meta">Contributed: ${escape(feedback.summaryZh)} &middot; ${escape(feedback.summaryEn)}</p>`;
  return (
    `<article><p class="head"><span>${head.join(' &middot; ')}</span>${badge(feedback)}</p>` +
    `<p class="text">${escape(feedback.text)}</p>` +
    trail(feedback, now) +
    contributed +
    `<p class="meta">${facts.join(' &middot; ')}</p>` +
    `<p class="meta">${feedback.contact === null ? 'No contact' : `Contact: ${escape(feedback.contact)}`}</p>` +
    `<p class="meta">${credit}</p>` +
    (feedback.userAgent === null ? '' : `<p class="meta">Browser: ${escape(feedback.userAgent)}</p>`) +
    commands(feedback, run) +
    '</article>'
  );
}

export const FEEDBACK_PATH = '/feedback';

// The address of the feedback of a view, from before an id when one is given. The open feedback
// is the page's default, and goes unnamed.
function feedbackHref(view: PageView, before?: number): string {
  const query = [...(view === 'open' ? [] : [`status=${view}`]), ...(before === undefined ? [] : [`before=${before}`])];
  return query.length === 0 ? FEEDBACK_PATH : `${FEEDBACK_PATH}?${query.join('&amp;')}`;
}

// A row of choices, each with how much there is of it, the one shown filled in.
const pill = (href: string, label: string, count: number, shown: boolean) =>
  shown ? `<strong>${label} <b>${count}</b></strong>` : `<a href="${href}">${label} <b>${count}</b></a>`;

// The views to choose from, in one row.
function choices({ total, statuses, view }: FeedbackListing): string {
  const counts: Record<PageView, number> = { ...statuses, all: total, open: statuses.new };
  const views = FEEDBACK_VIEWS.map((choice) =>
    pill(feedbackHref(choice), VIEWS[choice], counts[choice], choice === view),
  );
  return `<div class="filters"><p class="pills">${views.join('')}</p></div>`;
}

// The feedback page: the choices, the entries of one page, each with its commands (`run`), and the
// way to the latest and to the older ones.
function feedbackList(listing: FeedbackListing, run: FeedbackCommands): string {
  const { total, view, entries, paged, older, now } = listing;
  if (total === 0) return '<p class="note">None yet.</p>';
  const links = [
    ...(paged ? [`<a href="${feedbackHref(view)}">Latest</a>`] : []),
    ...(older ? [`<a href="${feedbackHref(view, (entries.at(-1) as Feedback).id)}">Older</a>`] : []),
  ];
  return (
    choices(listing) +
    (entries.length === 0 && !paged ? '<p class="note">None here.</p>' : '') +
    entries.map((feedback) => entry(feedback, now, run)).join('') +
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
    `<article><p class="head"><span>#${id} &middot; ${escape(when(createdAt))} &middot; room ${escape(formatCode(roomCode))}</span></p>` +
    `<p class="text">${escape(reportedName)} (${account})</p>` +
    `<p class="meta">Reported by ${reporter === null ? 'a deleted account' : escape(reporter)}</p>` +
    (text === null ? '<p class="meta">No note</p>' : `<p class="text">${escape(text)}</p>`) +
    '</article>'
  );
}

// The reports page: the entries of one page, and the way to the latest and to the older ones.
function reportList({ total, entries, paged, older }: ReportListing): string {
  if (total === 0) return '<p class="note">None yet.</p>';
  const links = [
    ...(paged ? [`<a href="${REPORTS_PATH}">Latest</a>`] : []),
    ...(older ? [`<a href="${REPORTS_PATH}?before=${(entries.at(-1) as Report).id}">Older</a>`] : []),
  ];
  return entries.map(report).join('') + (links.length > 0 ? `<p class="more">${links.join(' &middot; ')}</p>` : '');
}

type Page = 'status' | 'feedback' | 'reports';

const NAV: [Page, string, string][] = [
  ['status', '/', 'Status'],
  ['feedback', FEEDBACK_PATH, 'Feedback'],
  ['reports', REPORTS_PATH, 'Reports'],
];

// One document, as every page is built: the heading, the way to the other pages, with the page
// itself marked, a line under it, and the body. The status page reloads itself; the others don't.
function document(page: Page, heading: string, sub: string, body: string, reloads: boolean): string {
  const links = NAV.map(([name, href, label]) =>
    name === page ? `<a href="${href}" aria-current="page">${label}</a>` : `<a href="${href}">${label}</a>`,
  );
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${reloads ? '<meta http-equiv="refresh" content="5">\n' : ''}<title>Reviewer 2 ${page}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header><h1>${heading}</h1><nav aria-label="Pages">${links.join('')}</nav></header>
<p class="sub">${sub}</p>
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

// What the page says of the feedback: how much there is in all, and of each status.
export interface FeedbackCounts {
  total: number;
  statuses: Record<FeedbackStatus, number>;
}

export const NO_FEEDBACK: FeedbackCounts = {
  total: 0,
  statuses: { new: 0, issue: 0, resolved: 0, closed: 0, trash: 0 },
};

// The feedback on the status page: how much there is of each status, each the way to that view,
// the open feedback, which nobody has dealt with yet, first, with the way to the page itself.
function feedbackCounts({ total, statuses }: FeedbackCounts): string {
  if (total === 0) return '<p class="note">None yet.</p>';
  const pills = [
    `<a class="badge" href="${FEEDBACK_PATH}">Open <b>${statuses.new}</b></a>`,
    ...(['issue', 'resolved', 'closed', 'trash'] as const).map(
      (status) =>
        `<a class="badge ${status}" href="${feedbackHref(status)}">${VIEWS[status]} <b>${statuses[status]}</b></a>`,
    ),
  ];
  return `<p class="pills">${pills.join('')}</p><p class="note">${total} in all &middot; <a href="${FEEDBACK_PATH}">Read it</a></p>`;
}

// `now` is the time on the clock that the samples were taken on (History in stats.ts), and
// `feedback` and `reports` are how much there is, which their pages show.
export function renderStatusPage(
  stats: Stats,
  samples: readonly Sample[],
  now: number,
  feedback: FeedbackCounts = NO_FEEDBACK,
  accounts: AccountCounts = { total: 0, recent: 0 },
  reports = 0,
): string {
  const { memory } = stats;
  // The limit is the service's as a whole, with its file cache (stats.ts); this is the process's
  // share of it.
  const share =
    memory.limit === null ? '' : `${Math.round((memory.rss / memory.limit) * 100)}% of the ${mb(memory.limit)} limit`;
  return document(
    'status',
    'Reviewer 2 status',
    `Version ${escape(stats.version)} &middot; up ${duration(stats.uptime)} &middot; reloads every 5 seconds`,
    `<section><h2>Players</h2>
<dl>${tile('Online', stats.players.online)}${tile('Offline', stats.players.offline, 'with a seat to come back to')}${tile('Accounts', accounts.total, 'registered')}${tile('New accounts', accounts.recent, 'in the last 7 days')}</dl></section>
<section><h2>Rooms</h2>
<dl>${tile('Waiting', stats.rooms.lobby)}${tile('Playing', stats.rooms.playing)}${tile('Game over', stats.rooms.ended)}</dl></section>
${agents(stats)}
<section><h2>Connections</h2>
<dl>${tile('WebSocket', stats.connections.websocket)}${tile('Long-polling', stats.connections.polling)}</dl>
${countries(stats)}</section>
<section><h2>Memory</h2>
<dl>${tile('Process', mb(memory.rss), share)}${tile('JavaScript heap', mb(memory.heapUsed))}</dl></section>
<section><h2>Last 24 hours</h2>
${chart(samples, now)}</section>
<section><h2>Feedback</h2>
${feedbackCounts(feedback)}</section>
<section><h2>Reports</h2>
<p class="note">${reports === 0 ? 'None yet.' : `${reports} in all &middot; <a href="${REPORTS_PATH}">Read them</a>`}</p></section>
`,
    true,
  );
}

// The AI players (docs/architecture.md#ai-players), on a server with an agent: how many are in the
// rooms, whether the agent answers, and how their last hour went.
function agents({ agents: ai }: Stats): string {
  if (!ai) return '';
  return `<section><h2>AI players</h2>
<dl>${tile('Agent', ai.up ? 'Up' : '<strong>Down</strong>')}${tile('In rooms', ai.players)}${tile('Steps', ai.steps, 'in the last hour')}${tile('Failed', ai.failures, 'in the last hour')}</dl></section>`;
}

// The feedback that players sent, newest first, a page at a time, of one view, each with the
// commands that may come next (`run`): FEEDBACK_COMMAND, where it is set, or ADMIN_COMMAND, or
// DEFAULT_ADMIN_COMMAND, in front of those of admin.cjs (config.ts).
export function renderFeedbackPage(feedback: FeedbackListing, run: FeedbackCommands): string {
  return document(
    'feedback',
    'Feedback',
    `${feedback.total} in all, newest first &middot; what became of it is changed with <code>admin.cjs feedback</code>`,
    feedbackList(feedback, run),
    false,
  );
}

// The reports that players sent of each other, newest first, a page at a time.
export function renderReportsPage(reports: ReportListing): string {
  return document(
    'reports',
    'Reports',
    `${reports.total} in all, newest first &middot; bar a reported account from public rooms with ` +
      '<code>admin.cjs accounts bar &lt;username&gt;</code>',
    reportList(reports),
    false,
  );
}

import { UNKNOWN_COUNTRY } from './core/clientIp';
import { megabytes, type Sample, type Stats } from './stats';
import type { Feedback } from './store/feedback';

// The status page (status.ts) as one HTML document, built on the server from the numbers. It has
// no script: it reloads itself every 5 seconds, and its chart is inline SVG. It is for the
// operator alone, so its text is in English only and not in the locale files.

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
// those before an id that the operator paged back to.
export interface FeedbackPage {
  total: number;
  entries: readonly Feedback[];
  // Whether the page was paged back from the latest.
  paged: boolean;
  // Whether there is older feedback than the last entry on the page.
  older: boolean;
}

const KINDS: Record<Feedback['kind'], string> = { idea: 'Idea', bug: 'Bug', words: 'Word lists' };
const LANGUAGES: Record<Feedback['language'], string> = { zh: 'Chinese', en: 'English' };
const PAGES: Record<Feedback['page'], string> = { home: 'home page', room: 'room' };

// "2026-10-09 13:05 UTC" from the ISO time that the database keeps.
const when = (iso: string) => iso.replace('T', ' ').replace(/:\d{2}(\.\d+)?Z$/, ' UTC');

// Players wrote the text and the contact, and the page sent the version, so all of it is escaped
// like anything else that comes from outside. The text keeps its line breaks.
function entry(feedback: Feedback): string {
  const facts = [
    `#${feedback.id}`,
    KINDS[feedback.kind],
    escape(when(feedback.createdAt)),
    `version ${escape(feedback.version)}`,
    LANGUAGES[feedback.language],
    `from the ${PAGES[feedback.page]}`,
  ];
  return (
    `<article><p>${facts.join(' &middot; ')}</p>` +
    `<p class="text">${escape(feedback.text)}</p>` +
    `<p>${feedback.contact === null ? 'No contact' : `Contact: ${escape(feedback.contact)}`}</p>` +
    (feedback.userAgent === null ? '' : `<p>Browser: ${escape(feedback.userAgent)}</p>`) +
    '</article>'
  );
}

function feedbackSection({ total, entries, paged, older }: FeedbackPage): string {
  if (total === 0) return '<p>None yet.</p>';
  const links = [
    ...(paged ? ['<a href="/#feedback">Latest</a>'] : []),
    ...(older ? [`<a href="/?before=${(entries.at(-1) as Feedback).id}#feedback">Older</a>`] : []),
  ];
  return (
    `<p>${total} in all, newest first.</p>${entries.map(entry).join('')}` +
    (links.length > 0 ? `<p class="more">${links.join(' &middot; ')}</p>` : '')
  );
}

const NO_FEEDBACK: FeedbackPage = { total: 0, entries: [], paged: false, older: false };

// `now` is the time on the clock that the samples were taken on (History in stats.ts).
export function renderStatusPage(
  stats: Stats,
  samples: readonly Sample[],
  now: number,
  feedback = NO_FEEDBACK,
): string {
  const { memory } = stats;
  // The limit is the service's as a whole, with its file cache (stats.ts); this is the process's
  // share of it.
  const share =
    memory.limit === null ? '' : `${Math.round((memory.rss / memory.limit) * 100)}% of the ${mb(memory.limit)} limit`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="5">
<title>Reviewer 2 status</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Reviewer 2 status</h1>
<p>Version ${escape(stats.version)} &middot; up ${duration(stats.uptime)} &middot; reloads every 5 seconds</p>
<h2>Players</h2>
<dl>${tile('Online', stats.players.online)}${tile('Offline', stats.players.offline, 'with a seat to come back to')}</dl>
<h2>Rooms</h2>
<dl>${tile('Waiting', stats.rooms.lobby)}${tile('Playing', stats.rooms.playing)}${tile('Game over', stats.rooms.ended)}</dl>
<h2>Connections</h2>
<dl>${tile('WebSocket', stats.connections.websocket)}${tile('Long-polling', stats.connections.polling)}</dl>
${countries(stats)}
<h2>Memory</h2>
<dl>${tile('Process', mb(memory.rss), share)}${tile('JavaScript heap', mb(memory.heapUsed))}</dl>
<h2>Last 24 hours</h2>
${chart(samples, now)}
<h2 id="feedback">Feedback</h2>
${feedbackSection(feedback)}
</main>
</body>
</html>
`;
}

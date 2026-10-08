import { UNKNOWN_COUNTRY } from './core/clientIp';
import type { Sample, Stats } from './stats';

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

const megabytes = (bytes: number) => `${Math.round(bytes / 2 ** 20)} MB`;

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

// The chart spans the samples there are, up to the last 24 hours, and its scale starts at 0.
const WIDTH = 600;
const HEIGHT = 160;

function chart(samples: readonly Sample[], now: number): string {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last) return '<p>No samples yet. The first is taken 30 seconds after the server starts.</p>';
  const span = Math.max(last.at - first.at, 1);
  const top = Math.max(1, ...samples.map(({ players, rooms }) => Math.max(players, rooms)));
  const line = (key: 'players' | 'rooms') => {
    const points = samples.map(
      (sample) =>
        `${Math.round(((sample.at - first.at) / span) * WIDTH)},${Math.round(HEIGHT - (sample[key] / top) * HEIGHT)}`,
    );
    // A single sample is a level line across the chart rather than a point nobody can see.
    if (samples.length === 1) points.push(`${WIDTH},${points[0]?.split(',')[1]}`);
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

export function renderStatusPage(stats: Stats, samples: readonly Sample[], now = Date.now()): string {
  const { memory } = stats;
  const share =
    memory.limit === null ? '' : `${Math.round((memory.rss / memory.limit) * 100)}% of ${megabytes(memory.limit)}`;
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
<dl>${tile('In use', megabytes(memory.rss), share)}${tile('JavaScript heap', megabytes(memory.heapUsed))}</dl>
<h2>Last 24 hours</h2>
${chart(samples, now)}
</main>
</body>
</html>
`;
}

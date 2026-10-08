import { describe, expect, test } from 'vitest';
import type { Sample, Stats } from './stats';
import { duration, renderStatusPage } from './statusPage';

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
    const page = text(renderStatusPage(stats(), [], NOW));
    expect(page).toContain('Version v0.0.14 &middot; up 3h 12m');
    expect(page).toContain('Online 17');
    expect(page).toContain('Offline 4');
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

test('duration', () => {
  expect(duration(0)).toBe('0s');
  expect(duration(59.9)).toBe('59s');
  expect(duration(60)).toBe('1m');
  expect(duration(3599)).toBe('59m');
  expect(duration(3600)).toBe('1h 0m');
  expect(duration(3 * 86_400 + 4 * 3600 + 59)).toBe('3d 4h');
});

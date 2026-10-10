#!/usr/bin/env node
// Writes the sponsors on GitHub Sponsors into SPONSORS.md, between the two lines that mark them
// (shared/src/sponsors.ts), for .github/workflows/sponsors.yml, which runs it once a day.
//
// It asks GitHub's GraphQL API, with the token in SPONSOR_TOKEN, for the sponsorships of the
// token's owner: the ones that ended too, public ones only, the oldest first. So a sponsor whose
// sponsorship ended stays on the list, and one who makes theirs private drops off it on the next
// run. The query asks for each sponsor's username and nothing else: GitHub filters and sorts with
// includePrivate and orderBy, while asking for a sponsorship's privacy, start or status would need
// the token to read the account's profile. Nothing about amounts or tiers is asked for or written.
//
// It needs only Node, and nothing from npm, which the workflow doesn't install, so that no code but
// this runs with the token. The rest of the file is left as the maintainers wrote it, except "No
// one yet", which goes once someone is listed and comes back when nobody is.
//
// Usage:
//   SPONSOR_TOKEN=<token> node scripts/update-sponsors.mjs
//
// Exit codes: 0 done, whether or not the list changed; 1 GitHub didn't answer with the sponsors,
// or SPONSORS.md has no place for them; 2 no token.

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FILE = join(fileURLToPath(new URL('..', import.meta.url)), 'SPONSORS.md');
const API = 'https://api.github.com/graphql';

// As in shared/src/sponsors.ts; server/src/thanks.test.ts checks that what this writes keeps to its
// rules.
export const START = '<!-- start of GitHub Sponsors, which .github/workflows/sponsors.yml writes -->';
export const END = '<!-- end of GitHub Sponsors -->';
const HEADING = '## GitHub Sponsors';
// What the introduction says while nobody is listed. The rules take any line of it with these
// words for that (shared/src/lists.ts), and so does this script, whatever the maintainers made of it.
const NO_ONE = '_No one yet._';
const SAYS_NO_ONE = /no one yet/i;
const USERNAME = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
// A hundred pages of a hundred sponsors each; more would be a loop.
const MAX_PAGES = 100;

export const QUERY = `query ($cursor: String) {
  viewer {
    sponsorshipsAsMaintainer(first: 100, after: $cursor, activeOnly: false, includePrivate: false, orderBy: { field: CREATED_AT, direction: ASC }) {
      nodes { sponsorEntity { ... on User { login } ... on Organization { login } } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

// What to do about an answer that isn't the sponsors.
const TOKEN_HELP = 'See docs/maintainers.md for the token that SPONSOR_TOKEN must hold.';

// The usernames of the public sponsors, past and present, in the order they started, each once:
// someone who sponsored again has a sponsorship for each time, and is listed by the first. An
// account that no longer exists has no sponsor, and is left out. Throws with GitHub's reason when
// it doesn't answer with them.
export async function fetchSponsors(token, request = fetch) {
  const usernames = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await request(API, {
      method: 'POST',
      headers: {
        Authorization: `bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'reviewer2-sponsors',
      },
      body: JSON.stringify({ query: QUERY, variables: { cursor } }),
    });
    const text = await response.text();
    let answer;
    try {
      answer = JSON.parse(text);
    } catch {
      answer = null;
    }
    if (!response.ok) {
      const reason = answer?.message ?? text.slice(0, 200);
      const what =
        response.status === 401 ? 'refused the token, which is wrong or has expired' : `answered ${response.status}`;
      throw new Error(`GitHub ${what}: ${reason}. ${TOKEN_HELP}`);
    }
    if (answer?.errors?.length) {
      const reasons = answer.errors.map((error) => `${error.type ?? 'ERROR'}: ${error.message}`).join('; ');
      throw new Error(`GitHub didn't give the sponsors: ${reasons}. ${TOKEN_HELP}`);
    }
    const sponsorships = answer?.data?.viewer?.sponsorshipsAsMaintainer;
    if (!Array.isArray(sponsorships?.nodes)) {
      throw new Error(`GitHub answered without the sponsorships: ${text.slice(0, 200)}`);
    }
    for (const node of sponsorships.nodes) {
      const login = node?.sponsorEntity?.login;
      if (typeof login !== 'string') continue;
      if (!USERNAME.test(login)) throw new Error(`GitHub named a sponsor "${login}", which is no GitHub username`);
      if (!usernames.includes(login)) usernames.push(login);
    }
    if (!sponsorships.pageInfo?.hasNextPage) return usernames;
    cursor = sponsorships.pageInfo.endCursor;
  }
  throw new Error(`GitHub had more than ${MAX_PAGES} pages of sponsorships`);
}

// SPONSORS.md with these sponsors between the lines that mark them: under their heading, or
// nothing when there are none. "No one yet", in whatever words, goes from the introduction once
// anyone is listed, here or by hand after the lines, and comes back at its end when nobody is and
// it isn't there. Throws when the file doesn't have the two lines, once each and in order.
export function writeSponsors(text, usernames) {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf(START);
  const end = lines.indexOf(END);
  if (start < 0 || end < start || lines.lastIndexOf(START) !== start || lines.lastIndexOf(END) !== end) {
    throw new Error(`SPONSORS.md must have the line "${START}" once, and the line "${END}" once after it`);
  }
  const block =
    usernames.length === 0 ? [] : [HEADING, '', ...usernames.map((name) => `- [${name}](https://github.com/${name})`)];
  const after = lines.slice(end + 1);
  let before = lines.slice(0, start);
  const listed = usernames.length > 0 || after.some((line) => line.startsWith('- '));
  const saysNoOne = (line) => SAYS_NO_ONE.test(line ?? '');
  if (listed) {
    // Each line that says so, with the blank line that set it apart.
    before = before.filter((line, index, all) => !saysNoOne(line) && !(line === '' && saysNoOne(all[index - 1])));
  } else if (!before.some(saysNoOne)) {
    if (before.at(-1) !== '') before.push('');
    before.push(NO_ONE, '');
  }
  return [...before, START, ...block, END, ...after].join('\n');
}

export async function main(env = process.env, request = fetch) {
  const token = env.SPONSOR_TOKEN?.trim();
  if (!token) {
    console.error('Set SPONSOR_TOKEN to a token as docs/maintainers.md says.');
    return 2;
  }
  try {
    const usernames = await fetchSponsors(token, request);
    const text = readFileSync(FILE, 'utf8');
    const updated = writeSponsors(text, usernames);
    if (updated === text) {
      console.log(`SPONSORS.md is up to date, with ${usernames.length} public sponsors on GitHub.`);
    } else {
      writeFileSync(FILE, updated);
      console.log(`SPONSORS.md now lists ${usernames.length} public sponsors on GitHub.`);
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main();
}

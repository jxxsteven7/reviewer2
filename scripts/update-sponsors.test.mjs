// Tests for scripts/update-sponsors.mjs. Run them with: node --test scripts/update-sponsors.test.mjs
//
// GitHub is played by a function that answers as its GraphQL API does. That what the script writes
// keeps to the rules of SPONSORS.md is checked in server/src/thanks.test.ts.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { END, fetchSponsors, main, QUERY, START, writeSponsors } from './update-sponsors.mjs';

const INTRO = ['# Sponsors', '', 'We thank the people who sponsor Reviewer 2.', ''];
const file = (...lines) => lines.join('\n');
const EMPTY = file(...INTRO, '_No one yet._', '', START, END, '');

// A GitHub that answers each request with the next of `pages`, an object or a Response, and keeps
// the requests.
function github(...pages) {
  const requests = [];
  const request = async (url, init) => {
    requests.push({ url, ...init, body: JSON.parse(init.body) });
    const page = pages.shift();
    return page instanceof Response ? page : Response.json(page);
  };
  return { request, requests };
}
const page = (logins, cursor = null) => ({
  data: {
    viewer: {
      sponsorshipsAsMaintainer: {
        nodes: logins.map((login) => ({ sponsorEntity: login === null ? null : { login } })),
        pageInfo: { hasNextPage: cursor !== null, endCursor: cursor },
      },
    },
  },
});

describe('the sponsors on GitHub', () => {
  test('are asked for by username alone, public ones only, ended ones too, the oldest first', async () => {
    const { request, requests } = github(page(['ann', 'bob']));
    assert.deepEqual(await fetchSponsors('t0ken', request), ['ann', 'bob']);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.github.com/graphql');
    assert.equal(requests[0].headers.Authorization, 'bearer t0ken');
    assert.deepEqual(requests[0].body.variables, { cursor: null });
    for (const argument of [
      'activeOnly: false',
      'includePrivate: false',
      'orderBy: { field: CREATED_AT, direction: ASC }',
    ]) {
      assert.ok(QUERY.includes(argument), argument);
    }
    // These would need the token to read the account's profile, and amounts are never asked for.
    for (const field of ['privacyLevel', 'createdAt', 'isActive', 'tier', 'amount']) {
      assert.ok(!QUERY.includes(field), field);
    }
  });

  test('come page by page, each sponsor once, without accounts that are gone', async () => {
    const { request, requests } = github(page(['ann', null, 'bob'], 'c1'), page(['ann', 'cy']));
    assert.deepEqual(await fetchSponsors('t', request), ['ann', 'bob', 'cy']);
    assert.deepEqual(
      requests.map(({ body }) => body.variables.cursor),
      [null, 'c1'],
    );
  });

  test("fail with GitHub's reason when it doesn't give them", async () => {
    const refused = github(Response.json({ message: 'Bad credentials' }, { status: 401 }));
    await assert.rejects(fetchSponsors('t', refused.request), {
      message: /^GitHub refused the token, which is wrong or has expired: Bad credentials\. See docs\/maintainers\.md/,
    });
    const scopes = github({
      data: null,
      errors: [
        {
          type: 'INSUFFICIENT_SCOPES',
          message:
            "Your token has not been granted the required scopes to execute this query. The 'createdAt' field requires one of the following scopes: ['read:user']",
        },
      ],
    });
    await assert.rejects(fetchSponsors('t', scopes.request), {
      message:
        /^GitHub didn't give the sponsors: INSUFFICIENT_SCOPES: Your token has not been granted .*See docs\/maintainers\.md/,
    });
    const down = github(new Response('<html>busy</html>', { status: 502 }));
    await assert.rejects(fetchSponsors('t', down.request), { message: /^GitHub answered 502: <html>busy<\/html>\./ });
    const odd = github({ data: { viewer: null } });
    await assert.rejects(fetchSponsors('t', odd.request), { message: /^GitHub answered without the sponsorships/ });
    const strange = github(page(['ann', 'not a name']));
    await assert.rejects(fetchSponsors('t', strange.request), { message: /"not a name", which is no GitHub username/ });
  });
});

describe('SPONSORS.md', () => {
  test('gets the sponsors between its lines, in place of "No one yet"', () => {
    assert.equal(
      writeSponsors(EMPTY, ['ann', 'Bob-2']),
      file(
        ...INTRO,
        START,
        '## GitHub Sponsors',
        '',
        '- [ann](https://github.com/ann)',
        '- [Bob-2](https://github.com/Bob-2)',
        END,
        '',
      ),
    );
  });

  test('keeps everything else as it was, and is unchanged when the sponsors are', () => {
    const others = ['## Other ways', '', '- Dr\\. Who', ''];
    const listed = file(
      ...INTRO,
      START,
      '## GitHub Sponsors',
      '',
      '- [ann](https://github.com/ann)',
      END,
      '',
      ...others,
    );
    assert.equal(writeSponsors(listed, ['ann']), listed);
    assert.equal(writeSponsors(listed, ['ann', 'cy']), listed.replace(END, `- [cy](https://github.com/cy)\n${END}`));
    // The sponsors by other ways stay, and so nobody is missing "No one yet".
    assert.equal(writeSponsors(listed, []), file(...INTRO, START, END, '', ...others));
  });

  test('says "No one yet" again when nobody is listed', () => {
    const listed = writeSponsors(EMPTY, ['ann']);
    assert.equal(writeSponsors(listed, []), EMPTY);
    assert.equal(writeSponsors(EMPTY, []), EMPTY);
    assert.equal(
      writeSponsors(file('# Sponsors', START, END), []),
      file('# Sponsors', '', '_No one yet._', '', START, END),
    );
  });

  test('knows "No one yet" in other words, as the rules do', () => {
    for (const noOne of ['_No one yet_', 'No one yet.', '*No one yet, but see below.*']) {
      const empty = EMPTY.replace('_No one yet._', noOne);
      assert.equal(writeSponsors(empty, []), empty);
      assert.equal(writeSponsors(empty, ['ann']), writeSponsors(EMPTY, ['ann']));
    }
  });

  test('must have the lines that mark the sponsors, once each and in order', () => {
    for (const text of [file(...INTRO), file(...INTRO, END, START), file(...INTRO, START, END, START, END)]) {
      assert.throws(() => writeSponsors(text, ['ann']), { message: /^SPONSORS\.md must have the line/ });
    }
  });
});

describe('the script', () => {
  test('wants a token', async () => {
    assert.equal(await main({}, () => assert.fail('asked GitHub without a token')), 2);
    assert.equal(await main({ SPONSOR_TOKEN: ' ' }, () => assert.fail('asked GitHub without a token')), 2);
  });

  test('fails when GitHub does', async () => {
    const refused = github(Response.json({ message: 'Bad credentials' }, { status: 401 }));
    assert.equal(await main({ SPONSOR_TOKEN: 't' }, refused.request), 1);
  });
});

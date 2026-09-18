import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GET, HEAD } from '../app/demo/[code]/route.ts';

/** The route takes its code from the request path, as Next hands it over. */
const at = (code: string) => ({ params: Promise.resolve({ code }) });
const req = new Request('http://localhost/demo/x');

afterEach(() => {
  delete process.env.TG_DEMO_CODE;
});

describe('the door on the input-concepts page', () => {
  test('opens for the code and for nothing else', async () => {
    assert.equal((await HEAD(req, at('ZOOM'))).status, 200);
    assert.equal((await HEAD(req, at('zoom'))).status, 200, 'typed case is not a lock');

    for (const wrong of ['K4XP', 'ZOO', 'ZOOMS', '', 'input-concepts.html']) {
      assert.equal(
        (await HEAD(req, at(wrong))).status,
        404,
        `${wrong || '(empty)'} should look like nothing is there`,
      );
    }
  });

  test('serves the page itself, not a link to it', async () => {
    const res = await GET(req, at('ZOOM'));
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(res.headers.get('x-robots-tag') ?? '', /noindex/);

    const html = await res.text();
    assert.match(html, /^<!doctype html>/i, 'it stands on its own, unwrapped');
    assert.match(html, /Six ways to type 42/);
    assert.ok(html.length > 20_000, 'the whole page, not a truncated read');
  });

  test('a wrong code is refused before the file is even read', async () => {
    const res = await GET(req, at('NOPE'));
    assert.equal(res.status, 404);
    assert.equal(await res.text(), 'Not found');
  });

  test('the environment sets the code, and replaces the fallback', async () => {
    process.env.TG_DEMO_CODE = 'PI42';
    assert.equal((await HEAD(req, at('PI42'))).status, 200);
    assert.equal(
      (await HEAD(req, at('ZOOM'))).status,
      404,
      'the code in the repo stops working once a real one is set',
    );
  });

  test('an empty setting leaves no door at all', async () => {
    process.env.TG_DEMO_CODE = '   ';
    assert.equal((await HEAD(req, at('ZOOM'))).status, 404);
    assert.equal((await HEAD(req, at(''))).status, 404);
  });
});

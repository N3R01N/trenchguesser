import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The input concepts page, behind the game-code box.
 *
 * Nothing links here. The only way in is to type the code on the join screen,
 * and the code is checked here rather than in the browser — the page bundle
 * never learns it, so reading the client source tells you nothing. Any other
 * code gets the same 404 a stranger would, which is also what makes the probe
 * on the join screen safe to fire at every four-letter code somebody types.
 *
 * `TG_DEMO_CODE` is the real answer to keeping it quiet; the fallback is in the
 * repo, so it is a closed door rather than a locked one. Four characters, and
 * one of them outside the room alphabet on purpose: a room code never contains
 * I, O, 0 or 1, so this can never collide with a real game.
 */
const HTML = 'demo/input-concepts.html';

function demoCode(): string {
  // Read per request, not baked in: this route is dynamic, so changing the
  // variable is a redeploy of nothing but the environment.
  return (process.env.TG_DEMO_CODE ?? 'ZOOM').trim().toUpperCase();
}

function opens(code: string): boolean {
  const wanted = demoCode();
  return wanted.length > 0 && code.trim().toUpperCase() === wanted;
}

const MISSING = () => new Response('Not found', { status: 404 });

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await params;
  if (!opens(code)) return MISSING();

  const html = await readFile(join(process.cwd(), HTML), 'utf8');
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Not a game screen: no CDN cache, and no place in an index.
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

/** The join screen asks with HEAD, so answering it never reads the file. */
export async function HEAD(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await params;
  return opens(code) ? new Response(null, { status: 200 }) : MISSING();
}

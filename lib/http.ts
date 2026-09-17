import type { ZodType } from 'zod';
import { RoomError } from './errors.ts';

/** Turns thrown RoomErrors into the status the client should see. */
export async function handle(
  fn: () => Promise<unknown>,
  init?: ResponseInit,
): Promise<Response> {
  try {
    const data = await fn();
    return Response.json(data ?? { ok: true }, init);
  } catch (err) {
    if (err instanceof RoomError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error('[api]', err);
    return Response.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function readBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new RoomError(issue?.message ?? 'Invalid request', 400);
  }
  return parsed.data;
}

/**
 * One second of shared CDN cache. Because the state payload is identical for
 * every player, a table of phones polling at 1.5s collapses into roughly one
 * origin read per second.
 */
export const STATE_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=1, stale-while-revalidate=4',
};

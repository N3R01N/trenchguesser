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
 *
 * `max-age=0` is load-bearing: `s-maxage` only binds shared caches, so without
 * it this response carries no freshness lifetime a browser is told to respect,
 * and one is free to apply a heuristic instead. Safari does. A phone would poll
 * on schedule, be handed its own cached copy of a phase that had already ended,
 * and sit on a screen the rest of the table had left — which is exactly what an
 * iPhone did after the first round. The CDN still gets its second.
 */
export const STATE_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0, s-maxage=1, stale-while-revalidate=4',
};

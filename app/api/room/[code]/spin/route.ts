import { handle, readBody } from '@/lib/http.ts';
import { spinSchema } from '@/lib/schemas.ts';
import { spin } from '@/lib/room.ts';

/**
 * A universe that prices its entries per round fetches them here, and may walk
 * past a few dead ranks before it lands. The spinner is watching a settle
 * animation while this runs, so a couple of seconds is covered.
 */
export const maxDuration = 30;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params;
    const { playerId, rank } = await readBody(req, spinSchema);
    const room = await spin(code, playerId, rank);
    // The resolved rank may differ from the requested one when it was a repeat.
    return { rank: room.round?.rank ?? rank };
  });
}

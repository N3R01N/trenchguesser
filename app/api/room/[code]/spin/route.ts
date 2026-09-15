import { handle, readBody } from '@/lib/http.ts';
import { spinSchema } from '@/lib/schemas.ts';
import { spin } from '@/lib/room.ts';

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

import { handle, readBody } from '@/lib/http.ts';
import { playerSchema } from '@/lib/schemas.ts';
import { startGame } from '@/lib/room.ts';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params;
    const { playerId } = await readBody(req, playerSchema);
    await startGame(code, playerId);
    return { ok: true };
  });
}

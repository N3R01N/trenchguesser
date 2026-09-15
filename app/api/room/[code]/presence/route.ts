import { handle, readBody } from '@/lib/http.ts';
import { presenceSchema } from '@/lib/schemas.ts';
import { setPresence } from '@/lib/room.ts';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params;
    const { playerId, present } = await readBody(req, presenceSchema);
    await setPresence(code, playerId, present);
    return { ok: true };
  });
}

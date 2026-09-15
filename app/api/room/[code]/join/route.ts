import { handle, readBody } from '@/lib/http.ts';
import { joinSchema } from '@/lib/schemas.ts';
import { joinRoom } from '@/lib/room.ts';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params;
    const { name } = await readBody(req, joinSchema);
    const { room, playerId } = await joinRoom(code, name);
    return { code: room.code, playerId };
  });
}

import { handle, readBody } from '@/lib/http.ts';
import { createSchema } from '@/lib/schemas.ts';
import { createRoom } from '@/lib/room.ts';

/** A cold snapshot build crawls 27 pages and takes ~45s. */
export const maxDuration = 120;

export async function POST(req: Request) {
  return handle(async () => {
    const { name, config } = await readBody(req, createSchema);
    const { room, playerId } = await createRoom(name, config ?? {});
    return { code: room.code, playerId };
  });
}

import { handle, readBody } from '@/lib/http.ts';
import { createSchema } from '@/lib/schemas.ts';
import { createRoom } from '@/lib/room.ts';

/**
 * A cold coin snapshot crawls 27 pages and takes ~45s. The collection ladder is
 * ~30 requests and lands in seconds, because NFT numbers are fetched per round.
 */
export const maxDuration = 120;

export async function POST(req: Request) {
  return handle(async () => {
    const { name, config } = await readBody(req, createSchema);
    const { room, playerId } = await createRoom(name, config ?? {});
    return { code: room.code, playerId };
  });
}

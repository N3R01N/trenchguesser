import { handle, readBody } from '@/lib/http.ts';
import { guessSchema } from '@/lib/schemas.ts';
import { submitGuess } from '@/lib/room.ts';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params;
    const { playerId, values } = await readBody(req, guessSchema);
    return submitGuess(code, playerId, values);
  });
}

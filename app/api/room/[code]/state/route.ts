import { handle, STATE_CACHE_HEADERS } from '@/lib/http.ts';
import { publicState } from '@/lib/room.ts';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  return handle(() => publicState(code), { headers: STATE_CACHE_HEADERS });
}

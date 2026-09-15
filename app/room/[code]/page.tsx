import { Game } from '@/components/Game.tsx';

export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <Game code={code.toUpperCase()} />;
}

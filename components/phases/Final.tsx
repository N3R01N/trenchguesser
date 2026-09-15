'use client';

import { useRouter } from 'next/navigation';
import type { PublicState } from '@/lib/room.ts';
import { ranked } from '@/lib/badges.ts';
import { forgetPlayer } from '@/lib/identity.ts';
import { ordinal } from '@/lib/format.ts';
import { useStagger } from '@/lib/motion.ts';
import { Confetti } from '../Confetti.tsx';
import { PlayerRow } from '../ui.tsx';

const PODIUM = ['🥇', '🥈', '🥉'];

export function Final({ state, you }: { state: PublicState; you: string }) {
  const router = useRouter();
  const order = ranked(state.players);
  const winner = order[0];
  const yourPlace = order.findIndex((p) => p.id === you) + 1;
  const shown = useStagger(order.length, 260);

  function exit() {
    forgetPlayer(state.code);
    router.push('/');
  }

  return (
    <main className="screen">
      <Confetti fire={yourPlace === 1} />

      <div className="stack center">
        <span className="label">Final scores</span>
        <h1 className="winner-name">
          {winner?.name} wins <span aria-hidden="true">👑</span>
        </h1>
        <p className="muted">
          {yourPlace === 1
            ? 'You called the trenches better than anyone.'
            : yourPlace === order.length
              ? `Dead last. ${order.length === 2 ? 'Out of two.' : `Out of ${order.length}.`} 💩`
              : `You finished ${ordinal(yourPlace)} of ${order.length}.`}
        </p>
      </div>

      <div className="screen-body">
        <ul className={`players podium shown-${shown}`}>
          {order.map((p, i) => (
            <PlayerRow
              key={p.id}
              player={p}
              players={state.players}
              you={you}
              position={i + 1}
              medal={PODIUM[i]}
            />
          ))}
        </ul>
      </div>

      <div className="screen-foot">
        <button className="btn btn-primary btn-lg" onClick={exit}>
          Exit
        </button>
      </div>
    </main>
  );
}

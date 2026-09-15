'use client';

import { useRouter } from 'next/navigation';
import type { PublicState } from '@/lib/room.ts';
import { ranked } from '@/lib/badges.ts';
import { forgetPlayer } from '@/lib/identity.ts';
import { ordinal } from '@/lib/format.ts';
import { PlayerRow } from '../ui.tsx';

export function Final({ state, you }: { state: PublicState; you: string }) {
  const router = useRouter();
  const order = ranked(state.players);
  const winner = order[0];
  const yourPlace = order.findIndex((p) => p.id === you) + 1;

  function exit() {
    forgetPlayer(state.code);
    router.push('/');
  }

  return (
    <main className="screen">
      <div className="stack center">
        <span className="label">Final scores</span>
        <h1>
          {winner?.name} wins <span aria-hidden="true">👑</span>
        </h1>
        <p className="muted">
          {yourPlace === 1
            ? 'You called the trenches better than anyone.'
            : `You finished ${ordinal(yourPlace)} of ${order.length}.`}
        </p>
      </div>

      <div className="screen-body">
        <ul className="players">
          {order.map((p, i) => (
            <PlayerRow
              key={p.id}
              player={p}
              players={state.players}
              you={you}
              position={i + 1}
            />
          ))}
        </ul>

        <div className="card stack">
          <span className="label">Coins seen</span>
          <p className="muted" style={{ margin: 0 }}>
            {state.totalRounds} rounds across ranks{' '}
            {state.config.range === 'noob'
              ? '100–500'
              : state.config.range === 'normal'
                ? '100–1000'
                : '100–2500'}
            .
          </p>
        </div>
      </div>

      <div className="screen-foot">
        <button className="btn btn-primary btn-lg" onClick={exit}>
          Exit
        </button>
      </div>
    </main>
  );
}

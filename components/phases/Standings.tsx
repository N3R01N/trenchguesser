'use client';

import { useState } from 'react';
import { post } from '@/lib/client.ts';
import type { PublicState } from '@/lib/room.ts';
import { ranked } from '@/lib/badges.ts';
import { PlayerRow, RoundDots } from '../ui.tsx';

export function Standings({
  state,
  you,
  onChanged,
}: {
  state: PublicState;
  you: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const order = ranked(state.players);
  const delta = state.round?.result?.delta ?? {};

  const currentIdx = state.players.findIndex((p) => p.id === state.activePlayerId);
  const next = state.players[(currentIdx + 1) % state.players.length];
  const lastRound = state.roundNo >= state.totalRounds;
  const yours = next?.id === you || you === state.hostId;

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/room/${state.code}/advance`, { playerId: you });
      onChanged();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="screen">
      <div className="row spread">
        <h2>Standings</h2>
        <RoundDots state={state} />
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
              delta={delta[p.id]}
            />
          ))}
        </ul>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="screen-foot">
        {yours ? (
          <button className="btn btn-primary btn-lg" disabled={busy} onClick={go}>
            {lastRound
              ? 'See final scores'
              : next?.id === you
                ? 'Your turn — spin'
                : `Start ${next?.name}'s round`}
          </button>
        ) : (
          <button className="btn btn-lg" disabled>
            {lastRound ? 'Wrapping up…' : `Waiting for ${next?.name ?? 'the next player'}`}
          </button>
        )}
      </div>
    </main>
  );
}

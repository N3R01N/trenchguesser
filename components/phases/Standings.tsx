'use client';

import { useState } from 'react';
import { post } from '@/lib/client.ts';
import type { PublicState } from '@/lib/room.ts';
import { ranked } from '@/lib/badges.ts';
import { useFlip } from '@/lib/motion.ts';
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
  // Crowning everyone who took a category makes the crown meaningless in a
  // two-player game; only the round's biggest gainers get it.
  const best = Math.max(0, ...Object.values(delta));
  const winners = new Set(
    best > 0
      ? Object.entries(delta)
          .filter(([, d]) => d === best)
          .map(([id]) => id)
      : [],
  );

  // Rows are keyed by round so the animation runs once per scored round.
  const bindRow = useFlip<HTMLLIElement>([
    `${state.roundNo}`,
    ...order.map((p) => p.id),
  ]);

  const currentIdx = state.players.findIndex((p) => p.id === state.activePlayerId);
  const next = state.players[(currentIdx + 1) % state.players.length];
  const lastRound = state.roundNo >= state.totalRounds;
  /**
   * Starting the next round belongs to whoever is about to spin, or the host.
   *
   * Ending the game belongs to nobody: there is no next turn to take, so gating
   * it left anyone who was neither staring at a dead button with the game over.
   * And if the player whose turn it is has gone quiet, anyone may start it —
   * otherwise a table waits on two people who have both closed their tabs.
   */
  const stalled = next ? !next.present : false;
  const yours = lastRound || stalled || next?.id === you || you === state.hostId;

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
              deltas={delta}
              crown={winners.has(p.id)}
              rowRef={bindRow(p.id)}
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
                : stalled
                  ? `Start without ${next?.name}`
                  : `Start ${next?.name}'s round`}
          </button>
        ) : (
          <button className="btn btn-lg" disabled>
            Waiting for {next?.name ?? 'the next player'}
          </button>
        )}
      </div>
    </main>
  );
}

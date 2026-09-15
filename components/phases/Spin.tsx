'use client';

import { useEffect, useRef, useState } from 'react';
import { buzz, post } from '@/lib/client.ts';
import type { PublicState } from '@/lib/room.ts';
import { RANGES } from '@/lib/types.ts';
import { RoundDots } from '../ui.tsx';

/**
 * The reel.
 *
 * The player stops on a *number*, not a coin, so nobody gains an information
 * advantage by taking their own turn — everyone learns which token it is at the
 * same instant.
 */
export function Spin({
  state,
  you,
  onChanged,
}: {
  state: PublicState;
  you: string;
  onChanged: () => void;
}) {
  const { from, to } = RANGES[state.config.range];
  const isMine = state.activePlayerId === you;
  const spinner = state.players.find((p) => p.id === state.activePlayerId);

  const [display, setDisplay] = useState<number>(from);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<number>(0);

  // Free-running reel until someone stops it.
  useEffect(() => {
    if (stopping) return;
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 45) {
        last = t;
        setDisplay(from + Math.floor(Math.random() * (to - from + 1)));
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [from, to, stopping]);

  async function stop() {
    if (!isMine || stopping) return;
    setStopping(true);
    buzz(20);
    const picked = display;
    try {
      const res = await post<{ rank: number }>(`/api/room/${state.code}/spin`, {
        playerId: you,
        rank: picked,
      });
      setDisplay(res.rank);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
      setStopping(false);
    }
  }

  return (
    <main className="screen">
      <div className="row spread">
        <RoundDots state={state} />
        <span className="label">
          {RANGES[state.config.range].label} · {from}–{to}
        </span>
      </div>

      <div className="screen-body center" style={{ justifyContent: 'center' }}>
        <div className="spinner-window">
          <span className="spinner-number mono">{display}</span>
        </div>
        <p className="muted">
          {isMine
            ? 'Tap stop. Whatever number you land on is the coin everybody guesses.'
            : `${spinner?.name ?? 'Someone'} is spinning…`}
        </p>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="screen-foot">
        {isMine ? (
          <button
            className="btn btn-primary btn-lg"
            disabled={stopping}
            onClick={stop}
          >
            {stopping ? 'Locking it in…' : 'Stop'}
          </button>
        ) : (
          <button className="btn btn-lg" disabled>
            Waiting for {spinner?.name ?? 'the spinner'}
          </button>
        )}
      </div>
    </main>
  );
}

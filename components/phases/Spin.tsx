'use client';

import { useEffect, useRef, useState } from 'react';
import { buzz, post } from '@/lib/client.ts';
import type { PublicState } from '@/lib/room.ts';
import { ENTRY_NOUN, rangeLabel } from '@/lib/types.ts';
import { prefersReducedMotion } from '@/lib/motion.ts';
import { RoundDots } from '../ui.tsx';

/**
 * The reel.
 *
 * The player stops on a *number*, not a coin, so taking your own turn earns no
 * information advantage — everyone learns which token it is at the same instant,
 * during the shared beat on the next screen.
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
  const { rankFrom: from, rankTo: to } = state.config;
  const difficulty = rangeLabel(state.config.mode, from, to);
  const isMine = state.activePlayerId === you;
  const spinner = state.players.find((p) => p.id === state.activePlayerId);

  const [display, setDisplay] = useState<number>(from);
  const [landed, setLanded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    if (landed !== null) return;
    if (prefersReducedMotion()) {
      setDisplay(Math.round((from + to) / 2));
      return;
    }

    let last = 0;
    const tick = (t: number) => {
      if (t - last > 42) {
        last = t;
        setDisplay(from + Math.floor(Math.random() * (to - from + 1)));
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [from, to, landed]);

  async function stop() {
    if (!isMine || landed !== null) return;
    buzz([12, 40, 24]);
    const picked = display;
    setLanded(picked);
    try {
      const res = await post<{ rank: number }>(`/api/room/${state.code}/spin`, {
        playerId: you,
        rank: picked,
      });
      setLanded(res.rank);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
      setLanded(null);
    }
  }

  return (
    <main className="screen">
      <div className="row spread">
        <RoundDots state={state} />
        <span className="label">
          {difficulty} · {from}–{to}
        </span>
      </div>

      <div className="screen-body center" style={{ justifyContent: 'center' }}>
        <div className={`reel${landed === null ? ' is-spinning' : ' is-landed'}`}>
          <span className="reel-number mono">{landed ?? display}</span>
        </div>
        <p className="muted">
          {landed !== null
            ? 'Locked.'
            : isMine
              ? `Tap stop. Whatever number you land on is the ${
                  ENTRY_NOUN[state.config.mode]
                } everybody guesses.`
              : `${spinner?.name ?? 'Someone'} is spinning…`}
        </p>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="screen-foot">
        {isMine ? (
          <button
            className="btn btn-primary btn-lg"
            disabled={landed !== null}
            onClick={stop}
          >
            {landed !== null ? 'Here it comes…' : 'Stop'}
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

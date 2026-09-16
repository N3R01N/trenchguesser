'use client';

import { useEffect, useState } from 'react';
import type { PublicState } from '@/lib/room.ts';
import type { Player } from '@/lib/types.ts';
import { badgesFor } from '@/lib/badges.ts';

export function TimerRing({
  ms,
  totalMs,
  size = 120,
}: {
  ms: number;
  totalMs: number;
  size?: number;
}) {
  const r = size / 2 - 8;
  const circumference = 2 * Math.PI * r;
  const fraction = totalMs > 0 ? Math.max(0, Math.min(1, ms / totalMs)) : 0;
  const seconds = Math.ceil(ms / 1000);
  const urgent = ms <= 3000;

  return (
    <svg className="timer-ring" width={size} height={size} aria-hidden="true">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--surface-2)"
        strokeWidth="6"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={urgent ? 'var(--bad)' : 'var(--accent)'}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - fraction)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.1s linear' }}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fill={urgent ? 'var(--bad)' : 'var(--text)'}
        fontSize={size / 3}
        fontWeight="700"
        fontFamily="ui-monospace, monospace"
      >
        {seconds}
      </text>
    </svg>
  );
}

export function CoinHeader({
  coin,
  rank,
}: {
  coin: { s: string; n: string; img: string };
  rank: number;
}) {
  return (
    <div className="coin">
      {coin.img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coin.img} alt="" width={48} height={48} />
      ) : (
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--surface-2)' }} />
      )}
      <div>
        <div className="coin-rank">#{rank} by market cap</div>
        <div className="coin-name">{coin.n}</div>
        <div className="coin-ticker">{coin.s}</div>
      </div>
    </div>
  );
}

export function PlayerRow({
  player,
  players,
  you,
  position,
  delta,
  deltas,
  rowRef,
  crown,
  medal,
}: {
  player: Player;
  players: Player[];
  you: string;
  position?: number;
  delta?: number;
  deltas?: Record<string, number>;
  rowRef?: (el: HTMLLIElement | null) => void;
  crown?: boolean;
  medal?: string;
}) {
  const badges = badgesFor(players, player.id, deltas);

  return (
    <li
      ref={rowRef}
      className={`player${player.id === you ? ' is-you' : ''}${
        player.present ? '' : ' is-out'
      }${crown ? ' is-crowned' : ''}`}
    >
      {medal ? (
        <span className="player-pos" aria-hidden="true">
          {medal}
        </span>
      ) : (
        position !== undefined && <span className="player-pos">{position}</span>
      )}
      <span className="player-name">{player.name}</span>
      {badges.length > 0 && (
        <span className="badges">
          {badges.map((b) => (
            <span key={b.emoji} title={b.title}>
              {b.emoji}
            </span>
          ))}
        </span>
      )}
      {delta !== undefined && delta !== 0 && (
        <span className={`player-delta ${delta > 0 ? 'up' : 'down'}`}>
          {delta > 0 ? `+${delta}` : delta}
        </span>
      )}
      <span className="player-score">{player.score}</span>
    </li>
  );
}

/** One dot per round: filled for rounds already played. */
export function RoundDots({ state }: { state: PublicState }) {
  if (state.totalRounds === 0 || state.totalRounds > 20) {
    return (
      <span className="label">
        Round {state.roundNo} of {state.totalRounds}
      </span>
    );
  }
  return (
    <div className="dots" aria-label={`Round ${state.roundNo} of ${state.totalRounds}`}>
      {Array.from({ length: state.totalRounds }, (_, i) => (
        <span key={i} className={`dot${i < state.roundNo ? ' filled' : ''}`} />
      ))}
    </div>
  );
}

/**
 * Under prefers-reduced-motion the global rule collapses every animation to
 * 0.01ms, so this stops spinning and reads as a plain ring. WaitNote's ticking
 * counter is what carries "still working" in that case.
 */
export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  );
}

export interface WaitStage {
  /** Seconds elapsed at which this line takes over. */
  after: number;
  text: string;
}

/**
 * An indeterminate wait that visibly moves. The server reports no progress, so
 * the stages are timed against what the pipeline actually does rather than a
 * measured percentage — the counter next to them is the honest part, and it is
 * there so a long cold build never looks like a dead button.
 */
export function WaitNote({
  stages,
  title,
}: {
  stages: WaitStage[];
  title: string;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, []);

  const stage = stages.reduce(
    (best, s) => (elapsed >= s.after ? s : best),
    stages[0],
  );

  return (
    <div className="wait" aria-live="polite">
      <Spinner />
      <div className="wait-text">
        <div className="wait-title">{title}</div>
        <div className="muted">{stage?.text}</div>
      </div>
      <span className="wait-elapsed mono">{elapsed}s</span>
    </div>
  );
}

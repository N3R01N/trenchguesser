'use client';

import { useState } from 'react';
import { post } from '@/lib/client.ts';
import type { PublicState } from '@/lib/room.ts';
import { CATEGORY_LABELS, UNIVERSE_RANGES, roundDuration } from '@/lib/types.ts';

export function Lobby({
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
  const [copied, setCopied] = useState(false);

  const isHost = you === state.hostId;
  const enough = state.players.length >= 2;
  const seconds = Math.round(
    roundDuration(state.config.baseRoundMs, state.config.categories.length) / 1000,
  );

  async function share() {
    const url = `${location.origin}/room/${state.code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Trenchguesser', text: `Join: ${state.code}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // The user dismissed the share sheet, or the clipboard is blocked.
    }
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/room/${state.code}/start`, { playerId: you });
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen">
      <div className="stack">
        <span className="label">Game code</span>
        <div className="code">{state.code}</div>
        <button className="btn btn-ghost" onClick={share}>
          {copied ? 'Link copied' : 'Share link'}
        </button>
      </div>

      <div className="screen-body">
        <div className="row spread">
          <span className="label">
            {state.players.length} player{state.players.length === 1 ? '' : 's'}
          </span>
          <span className="label">
            {state.config.roundsMode === 'flat'
              ? `${state.config.roundsValue} rounds`
              : `${state.config.roundsValue} each`}
            {' · '}
            {seconds}s
          </span>
        </div>

        <ul className="players">
          {state.players.map((p) => (
            <li
              key={p.id}
              className={`player${p.id === you ? ' is-you' : ''}`}
            >
              <span className="player-pos">{p.id === state.hostId ? '★' : ''}</span>
              <span className="player-name">{p.name}</span>
              {p.id === you && <span className="label">you</span>}
            </li>
          ))}
        </ul>

        <div className="card stack">
          <span className="label">Guessing</span>
          <div>{state.config.categories.map((c) => CATEGORY_LABELS[c]).join(' · ')}</div>
          <span className="label">Difficulty</span>
          <div>
            {UNIVERSE_RANGES[state.config.mode][state.config.range].label} — ranks{' '}
            {UNIVERSE_RANGES[state.config.mode][state.config.range].from}–
            {UNIVERSE_RANGES[state.config.mode][state.config.range].to}
          </div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="screen-foot">
        {isHost ? (
          <button
            className="btn btn-primary btn-lg"
            disabled={busy || !enough}
            onClick={start}
          >
            {enough ? 'Start game' : 'Waiting for one more player'}
          </button>
        ) : (
          <p className="muted" style={{ textAlign: 'center' }}>
            Waiting for the host to start…
          </p>
        )}
      </div>
    </main>
  );
}

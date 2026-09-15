'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { post } from '@/lib/client.ts';
import { playerFor, lastName, rememberPlayer } from '@/lib/identity.ts';
import { useCountdown, useRoomState } from '@/lib/useRoomState.ts';
import { HEARTBEAT_MS } from '@/lib/types.ts';
import { Lobby } from './phases/Lobby.tsx';
import { Spin } from './phases/Spin.tsx';
import { Guess } from './phases/Guess.tsx';
import { Reveal } from './phases/Reveal.tsx';
import { Standings } from './phases/Standings.tsx';
import { Final } from './phases/Final.tsx';

export function Game({ code }: { code: string }) {
  const [you, setYou] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const { state, error, loading, refresh, msLeft, msUntil } = useRoomState(code);
  const ms = useCountdown(msLeft);

  // The shared beat between the reel stopping and the sliders going live.
  const opensAt = state?.round?.opensAt;
  const introLeft = useCallback(() => msUntil(opensAt), [msUntil, opensAt]);
  const introMs = useCountdown(introLeft);

  // localStorage is unavailable during the server render.
  useEffect(() => {
    setYou(playerFor(code));
    setReady(true);
  }, [code]);

  const known = !!state && !!you && state.players.some((p) => p.id === you);

  /**
   * Phase transitions are driven by whichever client notices first — the server
   * decides whether the move is legal. The active player tries immediately and
   * everyone else waits a beat, so the common case is a single request rather
   * than one per phone.
   */
  const attempted = useRef('');
  useEffect(() => {
    if (!state || !you || !known) return;

    const spinnerGone =
      state.phase === 'spinning' &&
      !state.players.find((p) => p.id === state.activePlayerId)?.present;

    const shouldAdvance =
      spinnerGone ||
      (state.phase === 'guessing' &&
        (ms === 0 ||
          state.players
            .filter((p) => p.present)
            .every((p) => state.submitted.includes(p.id)))) ||
      (state.phase === 'reveal' && ms === 0);

    if (!shouldAdvance) return;

    // A stalled spin needs retrying: presence decays without bumping the
    // version, so the version alone would only ever let one attempt through.
    const key = spinnerGone
      ? `spin-rescue:${state.v}:${Math.floor(Date.now() / 5000)}`
      : `${state.phase}:${state.v}`;
    if (attempted.current === key) return;
    attempted.current = key;

    const idx = state.players.findIndex((p) => p.id === you);
    const delay = state.activePlayerId === you ? 0 : 900 + idx * 350;

    const t = setTimeout(async () => {
      try {
        await post(`/api/room/${code}/advance`, { playerId: you });
      } catch {
        // A 409 just means someone else got there first.
      }
      void refresh();
    }, delay);

    return () => clearTimeout(t);
  }, [state, you, known, ms, code, refresh]);

  /**
   * Heartbeat. A closed tab or a locked phone sends no goodbye, so presence is
   * something you keep proving rather than something you announce.
   */
  useEffect(() => {
    if (!you || !known) return;
    const beat = () =>
      void post(`/api/room/${code}/presence`, { playerId: you }).catch(() => {});

    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') beat();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [code, you, known]);

  const onChanged = useCallback(() => void refresh(), [refresh]);

  if (!ready || (loading && !state)) {
    return (
      <main className="screen center" style={{ justifyContent: 'center' }}>
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (error && !state) {
    return (
      <main className="screen center" style={{ justifyContent: 'center' }}>
        <div className="error">{error}</div>
        <a className="btn" href="/">
          Back
        </a>
      </main>
    );
  }

  if (!state) return null;

  if (!known) {
    return (
      <JoinPrompt
        code={code}
        started={state.phase !== 'lobby'}
        onJoined={(id) => {
          setYou(id);
          void refresh();
        }}
      />
    );
  }

  switch (state.phase) {
    case 'lobby':
      return <Lobby state={state} you={you!} onChanged={onChanged} />;
    case 'spinning':
      return <Spin state={state} you={you!} onChanged={onChanged} />;
    case 'guessing':
      return (
        <Guess
          state={state}
          you={you!}
          ms={ms}
          introMs={introMs}
          onChanged={onChanged}
        />
      );
    case 'reveal':
      return <Reveal state={state} you={you!} />;
    case 'standings':
      return <Standings state={state} you={you!} onChanged={onChanged} />;
    case 'final':
      return <Final state={state} you={you!} />;
  }
}

/** Shown when someone opens a room link without an identity for it. */
function JoinPrompt({
  code,
  started,
  onJoined,
}: {
  code: string;
  started: boolean;
  onJoined: (playerId: string) => void;
}) {
  const [name, setName] = useState(() => lastName());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ code: string; playerId: string }>(
        `/api/room/${code}/join`,
        { name },
      );
      rememberPlayer(res.code, res.playerId, name);
      onJoined(res.playerId);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="screen">
      <div className="screen-body center" style={{ justifyContent: 'center' }}>
        <span className="label">Joining</span>
        <div className="code">{code}</div>
        {started && (
          <p className="muted">
            This game is already under way — you can&apos;t join mid-game.
          </p>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      <form className="screen-foot" onSubmit={join}>
        <div className="field">
          <span className="label">Your name</span>
          <input
            type="text"
            maxLength={16}
            placeholder="Degen McGee"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={started}
          />
        </div>
        <button
          className="btn btn-primary btn-lg"
          disabled={busy || started || !name.trim()}
        >
          {busy ? 'Joining…' : 'Join'}
        </button>
        <a className="btn btn-ghost" href="/">
          Back
        </a>
      </form>
    </main>
  );
}

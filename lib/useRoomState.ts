'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicState } from './room.ts';

const POLL_MS = 1_500;

/**
 * The transport seam.
 *
 * Polling rather than WebSockets: Vercel Hobby caps a function at 300s so every
 * socket would die and reconnect every five minutes, connections pin to a single
 * instance so fan-out needs Redis anyway, and a turn-based game with a visible
 * countdown does not need sub-second push. The state route carries a one-second
 * CDN cache, so a table full of phones collapses into roughly one origin read
 * per second. Swapping to sockets later should only touch this file.
 */
export function useRoomState(code: string | null, playerId: string | null) {
  const [state, setState] = useState<PublicState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /** serverTime - clientTime, so countdowns agree across devices. */
  const offset = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const version = useRef(-1);

  const fetchState = useCallback(async () => {
    if (!code || !playerId) return;

    inFlight.current?.abort();
    const ac = new AbortController();
    inFlight.current = ac;

    try {
      const res = await fetch(
        `/api/room/${encodeURIComponent(code)}/state?you=${encodeURIComponent(playerId)}`,
        { signal: ac.signal },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const next = (await res.json()) as PublicState;

      offset.current = next.serverTime - Date.now();
      setError(null);

      // Skip the re-render when nothing actually moved.
      if (next.v !== version.current) {
        version.current = next.v;
        setState(next);
      } else {
        setState((prev) => (prev ? { ...prev, submitted: next.submitted } : next));
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [code, playerId]);

  useEffect(() => {
    if (!code || !playerId) return;

    let timer: ReturnType<typeof setInterval>;

    const start = () => {
      void fetchState();
      timer = setInterval(() => void fetchState(), POLL_MS);
    };
    const stop = () => clearInterval(timer);

    const onVisibility = () => {
      stop();
      if (document.visibilityState === 'visible') start();
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      inFlight.current?.abort();
    };
  }, [code, playerId, fetchState]);

  /** Milliseconds left in the current phase, corrected for clock drift. */
  const msLeft = useCallback(() => {
    if (!state?.phaseEndsAt) return null;
    return Math.max(0, state.phaseEndsAt - (Date.now() + offset.current));
  }, [state]);

  return { state, error, loading, refresh: fetchState, msLeft };
}

/** A countdown that ticks locally so the UI stays smooth between polls. */
export function useCountdown(msLeft: () => number | null, tickMs = 100) {
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setMs(msLeft());
    tick();
    const t = setInterval(tick, tickMs);
    return () => clearInterval(t);
  }, [msLeft, tickMs]);

  return ms;
}

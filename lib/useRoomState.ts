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
export function useRoomState(code: string | null) {
  const [state, setState] = useState<PublicState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /** serverTime - clientTime, so countdowns agree across devices. */
  const offset = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const version = useRef(-1);

  const fetchState = useCallback(async () => {
    if (!code) return;

    inFlight.current?.abort();
    const ac = new AbortController();
    inFlight.current = ac;

    try {
      // `no-store` on the request as well as the response: a browser that
      // applies its own heuristic freshness would otherwise hand this poll a
      // copy of a phase the rest of the table has already left.
      const t0 = Date.now();
      const res = await fetch(`/api/room/${encodeURIComponent(code)}/state`, {
        signal: ac.signal,
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const next = (await res.json()) as PublicState;
      const t1 = Date.now();

      /**
       * Halfway through the round trip is the closest this client gets to the
       * moment the server stamped its time. Taking it against the arrival alone
       * would put every countdown in the app a whole trip ahead of the server,
       * which is how a client ends up asking to end a phase before it has.
       */
      offset.current = next.serverTime - (t0 + t1) / 2;
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
  }, [code]);

  useEffect(() => {
    if (!code) return;

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
  }, [code, fetchState]);

  /** Milliseconds until a server timestamp, corrected for clock drift. */
  const msUntil = useCallback((ts: number | null | undefined) => {
    if (!ts) return null;
    return Math.max(0, ts - (Date.now() + offset.current));
  }, []);

  const msLeft = useCallback(
    () => msUntil(state?.phaseEndsAt),
    [msUntil, state?.phaseEndsAt],
  );

  return { state, error, loading, refresh: fetchState, msLeft, msUntil };
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

'use client';

import { useEffect, useRef } from 'react';
import { post } from './client.ts';
import type { PublicState } from './room.ts';

/** How long the closing standings hold before the podium takes over. */
export const FINAL_STANDINGS_HOLD_MS = 4_000;

/**
 * How long a rejected attempt waits before trying again.
 *
 * A rejection is not a transition. The room version only moves on a successful
 * write, so a client that gives up after one 409 would never try again — and
 * the reveal has no button to fall back on, which is how a table ends up stuck
 * on the result screen forever.
 *
 * Rescuing a stalled spin needs the same second chance for a different reason:
 * presence decays on its own clock, so the attempt that was too early carries
 * the same version as the one that will be let through.
 *
 * Comfortably longer than the poll, deliberately: if a write lands but its
 * reply is lost, the next poll arrives first and moves the room on, so the
 * retry is disarmed rather than asking for a phase the table has already had.
 */
export const ADVANCE_RETRY_MS = 3_000;

/**
 * How often the driver re-checks.
 *
 * It cannot ride on renders: a countdown pinned at 0 keeps setting the same
 * value, React bails out on the identical state, and nothing re-renders — so
 * the moment to retry would never come around.
 */
const TICK_MS = 250;

/**
 * A beat before the active player posts, rather than none at all.
 *
 * Its clock is the one most likely to be running ahead of the server's, so
 * firing the instant the local countdown hits zero lands before the deadline
 * and earns a 409. Still well under the 900ms everyone else waits, so the
 * table still makes one request rather than one per phone.
 */
const ACTIVE_DELAY_MS = 250;

export interface AdvancePlan {
  /** Identifies the transition being attempted, so each one is tried once. */
  key: string;
  /** How long to hold off, staggered so the table doesn't all post at once. */
  delay: number;
}

/**
 * Whether this client should try to end the current phase, and when.
 *
 * Phase transitions are driven by whichever client notices first — the server
 * decides whether the move is legal. The active player tries first and everyone
 * else waits a beat, so the common case is a single request.
 */
export function advancePlan(
  state: PublicState,
  you: string,
  msLeft: number | null,
): AdvancePlan | null {
  const spinnerGone =
    state.phase === 'spinning' &&
    !state.players.find((p) => p.id === state.activePlayerId)?.present;

  // The last standings has no next turn to wait for, so it ends itself rather
  // than needing a tap. The button is still there for anyone who wants it.
  const gameOver =
    state.phase === 'standings' && state.roundNo >= state.totalRounds;

  const shouldAdvance =
    spinnerGone ||
    gameOver ||
    (state.phase === 'guessing' &&
      (msLeft === 0 ||
        state.players
          .filter((p) => p.present)
          .every((p) => state.submitted.includes(p.id)))) ||
    (state.phase === 'reveal' && msLeft === 0);

  if (!shouldAdvance) return null;

  const idx = state.players.findIndex((p) => p.id === you);
  // Long enough on the final standings to read them before the podium.
  const delay = gameOver
    ? FINAL_STANDINGS_HOLD_MS + idx * 250
    : state.activePlayerId === you
      ? ACTIVE_DELAY_MS
      : 900 + idx * 350;

  return { key: `${state.phase}:${state.v}`, delay };
}

export interface AdvanceDriver {
  /** Feeds in the current plan; null means there is nothing to advance. */
  tick(plan: AdvancePlan | null): void;
  stop(): void;
}

/**
 * Keeps trying to end a phase until the server agrees or the room moves on.
 *
 * The key alone cannot decide when to stop: a rejected attempt leaves the room
 * version exactly as it was, so the same key comes back around. What separates
 * the two outcomes is what happens afterwards — a success settles the
 * transition, a rejection only postpones it.
 */
export function createAdvanceDriver({
  send,
  refresh,
}: {
  send: () => Promise<unknown>;
  refresh: () => void;
}): AdvanceDriver {
  let key = '';
  /** Bumped whenever an outstanding attempt stops counting. */
  let cycle = 0;
  let busy = false;
  /** Earliest time to attempt again; Infinity once the server has agreed. */
  let nextAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel(): void {
    cycle += 1;
    if (timer) clearTimeout(timer);
    timer = null;
    busy = false;
  }

  function attempt(mine: number): void {
    timer = null;
    void (async () => {
      let sent = true;
      try {
        await send();
      } catch {
        // A 409 just means someone else got there first — or that we arrived a
        // moment early. Either way it is not a reason to stop.
        sent = false;
      }
      if (mine !== cycle) return; // the phase moved on beneath us
      busy = false;
      nextAt = sent ? Infinity : Date.now() + ADVANCE_RETRY_MS;
      refresh();
    })();
  }

  return {
    tick(plan) {
      if (!plan) {
        if (key) cancel();
        key = '';
        return;
      }
      if (plan.key !== key) {
        cancel();
        key = plan.key;
        nextAt = 0;
      }
      if (busy || Date.now() < nextAt) return;

      busy = true;
      const mine = cycle;
      timer = setTimeout(() => attempt(mine), plan.delay);
    },
    stop: cancel,
  };
}

/** Wires the driver to the room state, ticking on its own clock. */
export function useAutoAdvance({
  code,
  state,
  you,
  known,
  msLeft,
  refresh,
}: {
  code: string;
  state: PublicState | null;
  you: string | null;
  known: boolean;
  msLeft: () => number | null;
  refresh: () => Promise<void> | void;
}): void {
  const latest = useRef({ state, you, known, msLeft, refresh });
  useEffect(() => {
    latest.current = { state, you, known, msLeft, refresh };
  });

  useEffect(() => {
    const driver = createAdvanceDriver({
      send: () =>
        post(`/api/room/${code}/advance`, { playerId: latest.current.you }),
      refresh: () => void latest.current.refresh(),
    });

    const tick = () => {
      const { state: s, you: me, known: joined, msLeft: left } = latest.current;
      driver.tick(s && me && joined ? advancePlan(s, me, left()) : null);
    };

    tick();
    const t = setInterval(tick, TICK_MS);
    return () => {
      clearInterval(t);
      driver.stop();
    };
  }, [code]);
}

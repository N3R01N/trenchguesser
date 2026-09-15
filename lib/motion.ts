'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Honour the OS setting in JS-driven animation, not just in CSS. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * Counts a number up on the log axis.
 *
 * A linear count-up to $1.2M spends most of its time in the hundreds of
 * thousands and lands with no sense of scale. Interpolating the exponent instead
 * sweeps through the magnitudes the way the slider does.
 */
export function useCountUp(target: number, durationMs = 900, delayMs = 0): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));

  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }

    const from = Math.log10(Math.max(target, 1e-12)) - 3;
    const to = Math.log10(Math.max(target, 1e-12));
    let frame = 0;
    let start = 0;

    const timer = setTimeout(() => {
      const tick = (now: number) => {
        if (!start) start = now;
        const t = Math.min(1, (now - start) / durationMs);
        setValue(10 ** (from + (to - from) * easeOutCubic(t)));
        if (t < 1) frame = requestAnimationFrame(tick);
        else setValue(target);
      };
      frame = requestAnimationFrame(tick);
    }, delayMs);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [target, durationMs, delayMs]);

  return value;
}

/** Reveals items one after another so the eye can follow. */
export function useStagger(count: number, stepMs = 700): number {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? count : 0));

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(count);
      return;
    }
    setShown(0);
    const timers = Array.from({ length: count }, (_, i) =>
      setTimeout(() => setShown(i + 1), i * stepMs),
    );
    return () => timers.forEach(clearTimeout);
  }, [count, stepMs]);

  return shown;
}

/**
 * FLIP: measure where rows were, let them re-order, then animate the gap away.
 * Watching yourself get overtaken is the point of a leaderboard.
 */
export function useFlip<T extends HTMLElement>(keys: string[]) {
  const refs = useRef(new Map<string, T>());
  const positions = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    if (prefersReducedMotion()) return;

    for (const [key, el] of refs.current) {
      const top = el.getBoundingClientRect().top;
      const previous = positions.current.get(key);

      if (previous !== undefined && previous !== top) {
        el.animate(
          [{ transform: `translateY(${previous - top}px)` }, { transform: 'translateY(0)' }],
          { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        );
      }
      positions.current.set(key, top);
    }
  }, [keys]);

  return (key: string) => (el: T | null) => {
    if (el) refs.current.set(key, el);
    else refs.current.delete(key);
  };
}

/** Keeps the screen awake while a round is running. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let released = false;
    let lock: WakeLockSentinel | null = null;

    void navigator.wakeLock
      ?.request('screen')
      .then((sentinel) => {
        if (released) void sentinel.release();
        else lock = sentinel;
      })
      .catch(() => {
        // Unsupported, or denied because the page is hidden. Not worth surfacing.
      });

    return () => {
      released = true;
      void lock?.release().catch(() => {});
    };
  }, [active]);
}

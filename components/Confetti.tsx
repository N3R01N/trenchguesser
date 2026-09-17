'use client';

import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/lib/motion.ts';

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  color: string;
}

/**
 * Read off the theme rather than fixed, or a burst is invisible on paper and
 * again on black. Gold and red come along because they are the only two hues
 * the palette keeps, and a burst of nothing but greyscale reads as dust.
 */
const PALETTE_TOKENS = ['--text', '--gold', '--muted', '--bad'];

function palette(): string[] {
  try {
    const root = getComputedStyle(document.documentElement);
    const found = PALETTE_TOKENS.map((t) => root.getPropertyValue(t).trim()).filter(
      Boolean,
    );
    if (found.length) return found;
  } catch {
    // Computed styles are unavailable in some embedded views.
  }
  return ['#888888'];
}

/**
 * A one-shot burst for a bullseye guess. Canvas rather than DOM nodes: 70 spans
 * animating at once on a mid-range phone drops frames, a single canvas does not.
 */
export function Confetti({ fire }: { fire: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!fire || prefersReducedMotion()) return;
    const el = canvas.current;
    if (!el) return;

    const ctx = el.getContext('2d');
    if (!ctx) return;

    const colors = palette();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = (el.width = el.offsetWidth * dpr);
    const h = (el.height = el.offsetHeight * dpr);

    const bits: Bit[] = Array.from({ length: 70 }, () => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const speed = (4 + Math.random() * 7) * dpr;
      return {
        x: w / 2,
        y: h * 0.42,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        w: (4 + Math.random() * 5) * dpr,
        h: (7 + Math.random() * 7) * dpr,
        color: colors[Math.floor(Math.random() * colors.length)]!,
      };
    });

    let frame = 0;
    let life = 0;

    const tick = () => {
      life += 1;
      ctx.clearRect(0, 0, w, h);

      for (const b of bits) {
        b.vy += 0.42 * dpr;
        b.vx *= 0.992;
        b.x += b.vx;
        b.y += b.vy;
        b.rot += b.vr;

        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.globalAlpha = Math.max(0, 1 - life / 95);
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.restore();
      }

      if (life < 95) frame = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [fire]);

  return <canvas ref={canvas} className="confetti" aria-hidden="true" />;
}

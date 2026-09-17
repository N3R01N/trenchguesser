'use client';

import { amount } from '@/lib/format.ts';
import type { Unit } from '@/lib/types.ts';

export interface ScaleEntry {
  id: string;
  name: string;
  guess: number | null;
  won: boolean;
  you: boolean;
}

/** Three decades either side of the truth. Anything wider stops being readable. */
const DECADES = 3;

/**
 * Where every guess landed, on the axis the scoring actually uses.
 *
 * One lane per player so dots never collide, with the true value as a line
 * running through all of them — distance from that line is exactly the error
 * being scored.
 */
export function LogScale({
  truth,
  entries,
  show,
  unit,
  zeroLabel,
}: {
  truth: number;
  entries: ScaleEntry[];
  show: boolean;
  unit: Unit;
  zeroLabel?: string;
}) {
  const centre = Math.log10(Math.max(truth, 1e-12));
  const lo = centre - DECADES;
  const hi = centre + DECADES;

  const place = (v: number) => {
    const l = Math.log10(Math.max(v, 1e-12));
    return Math.max(0, Math.min(100, ((l - lo) / (hi - lo)) * 100));
  };

  const offScale = (v: number) => {
    const l = Math.log10(Math.max(v, 1e-12));
    return l < lo || l > hi;
  };

  return (
    <div className="scale">
      <div className="scale-axis" aria-hidden="true">
        {[-2, -1, 0, 1, 2].map((d) => (
          <span
            key={d}
            className={`scale-tick${d === 0 ? ' is-truth' : ''}`}
            style={{ left: `${place(10 ** (centre + d))}%` }}
          />
        ))}
      </div>

      {entries.map((e, i) => (
        <div className="scale-lane" key={e.id}>
          <span className={`scale-name${e.you ? ' is-you' : ''}`}>{e.name}</span>
          <span className="scale-track">
            {e.guess === null ? (
              <span className="scale-none">no guess 💀</span>
            ) : (
              <span
                className={`scale-dot${e.won ? ' won' : ''}${
                  offScale(e.guess) ? ' off' : ''
                }`}
                style={{
                  left: show ? `${place(e.guess)}%` : '50%',
                  transitionDelay: `${i * 90}ms`,
                }}
                title={e.guess === 0 && zeroLabel ? zeroLabel : amount(e.guess, unit)}
              />
            )}
          </span>
        </div>
      ))}

      <div className="scale-legend" aria-hidden="true">
        <span>{amount(10 ** lo, unit)}</span>
        <span className="scale-legend-truth">{amount(truth, unit)}</span>
        <span>{amount(10 ** hi, unit)}</span>
      </div>
    </div>
  );
}

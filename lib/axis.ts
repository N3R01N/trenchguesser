import { amount, decadeLabel } from './format.ts';
import { CATEGORY_BOUNDS, CATEGORY_UNITS, type Category } from './types.ts';

/**
 * The guessing axis, and what letting go of it does.
 *
 * A log slider over a category's whole range cannot be aimed. A punk sale runs
 * 0.01 to 5,000 ETH — 5.7 orders of magnitude — so a thousand steps put 1.3%
 * between neighbours and a thumb covers a dozen of them at once. There is no
 * position that means 42, which is what made entering a number like 42 a fight.
 *
 * Two things fix it together. Every value is quantised to two significant
 * figures, so 42 is a number the axis can hold at all; and releasing the thumb
 * narrows the axis around where it landed, so the second pass is a fine one.
 * Coarse then exact, without ever taking a second thumb or a keyboard.
 */

export const STEPS = 1000;

/** What a release keeps of the current span. */
const ZOOM_KEEP = 4;

/**
 * How narrow the axis is allowed to get.
 *
 * About half a decade, which at two significant figures is some fifty values
 * across the track — a comfortable few pixels each. Narrower would be aiming
 * at a precision the game does not score.
 */
const MIN_SPAN = 0.6;

export interface Axis {
  /** Bottom of the current window. */
  lo: number;
  /** Top of the current window. */
  hi: number;
  /** Where the thumb sits, 0 to STEPS, within that window. */
  step: number;
}

const lg = Math.log10;

/** The full range for a category, thumb in the middle. */
export function fullAxis(cat: Category): Axis {
  const [lo, hi] = CATEGORY_BOUNDS[cat];
  return { lo, hi, step: STEPS / 2 };
}

/**
 * The value a player has actually named.
 *
 * Two significant figures, or a whole number where the category counts things.
 * The readout already rounds to this, so anything finer is a number the player
 * was never shown and cannot have meant.
 */
export function quantize(value: number, cat: Category): number {
  const [lo, hi] = CATEGORY_BOUNDS[cat];
  const held = Math.min(hi, Math.max(lo, value));
  if (!Number.isFinite(held)) return lo;
  if (CATEGORY_UNITS[cat] === 'count') return Math.max(1, Math.round(held));
  const unit = 10 ** (Math.floor(lg(held)) - 1);
  return Math.round(held / unit) * unit;
}

/** What the thumb is pointing at. */
export function valueAt(axis: Axis, cat: Category): number {
  const t = axis.step / STEPS;
  return quantize(10 ** (lg(axis.lo) + t * (lg(axis.hi) - lg(axis.lo))), cat);
}

/** Where a value sits on a window, as a step. */
export function stepFor(value: number, lo: number, hi: number): number {
  if (!(hi > lo)) return STEPS / 2;
  const t = (lg(value) - lg(lo)) / (lg(hi) - lg(lo));
  return Math.round(Math.min(1, Math.max(0, t)) * STEPS);
}

export function isZoomed(axis: Axis, cat: Category): boolean {
  const [lo, hi] = CATEGORY_BOUNDS[cat];
  return axis.lo > lo || axis.hi < hi;
}

/**
 * Narrows the axis around the thumb, keeping the value under it.
 *
 * A quarter of the span per release: from a punk sale's 5.7 decades that is
 * 1.4, then 0.6 and no further. The first pass stays coarse enough to be
 * recoverable when you land nowhere near, which is what the whole-range
 * button is for.
 */
export function refine(axis: Axis, cat: Category): Axis {
  const [floor, ceiling] = CATEGORY_BOUNDS[cat];
  const span = lg(axis.hi) - lg(axis.lo);
  if (span <= MIN_SPAN * 1.02) return axis;

  const value = valueAt(axis, cat);
  const half = Math.max(MIN_SPAN, span / ZOOM_KEEP) / 2;
  const lo = Math.max(floor, 10 ** (lg(value) - half));
  const hi = Math.min(ceiling, 10 ** (lg(value) + half));
  return { lo, hi, step: stepFor(value, lo, hi) };
}

/** Back to the whole range, still pointing at the value you had. */
export function widen(axis: Axis, cat: Category): Axis {
  const [lo, hi] = CATEGORY_BOUNDS[cat];
  return { lo, hi, step: stepFor(valueAt(axis, cat), lo, hi) };
}

export interface Tick {
  /** Percent across the track. */
  at: number;
  text: string;
}

/**
 * Labels under the track.
 *
 * Powers of ten while the window holds several, every third one while it holds
 * many — so a label always lands on a K/M/B/T boundary on the widest axes. A
 * window inside a single decade has no round number to point at, so it names
 * its own ends instead, which is also how you can see it has narrowed.
 */
export function ticksFor(axis: Axis, cat: Category): Tick[] {
  const unit = CATEGORY_UNITS[cat];
  const span = lg(axis.hi) - lg(axis.lo);
  const at = (v: number) => ((lg(v) - lg(axis.lo)) / span) * 100;

  const first = Math.ceil(lg(axis.lo));
  const last = Math.floor(lg(axis.hi));
  const every = last - first > 3 ? 3 : 1;
  const start = every === 3 ? Math.ceil(first / 3) * 3 : first;

  const ticks: Tick[] = [];
  for (let d = start; d <= last; d += every) {
    ticks.push({ at: at(10 ** d), text: decadeLabel(d, unit) });
  }
  if (ticks.length >= 2) return ticks;

  return [
    { at: 0, text: amount(axis.lo, unit) },
    { at: 100, text: amount(axis.hi, unit) },
  ];
}

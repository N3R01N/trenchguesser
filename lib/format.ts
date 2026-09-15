/** Display helpers. Market caps span $80k to $1.5T, so everything is compact. */

const UNITS: [number, string][] = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];

/** 1_527_651 -> "1.53M". Sub-dollar values keep three significant digits. */
export function compact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';

  for (const [size, suffix] of UNITS) {
    if (n >= size) {
      const v = n / size;
      return `${v >= 100 ? v.toFixed(0) : v.toFixed(2)}${suffix}`;
    }
  }
  if (n >= 1) return n.toFixed(2);

  // Players think in decimals down to about a millionth; past that a run of
  // zeros is unreadable and the exponent is clearer.
  if (n >= 1e-6) return n.toFixed(Math.min(12, Math.max(2, 2 - Math.floor(Math.log10(n)))));

  const exp = Math.floor(Math.log10(n));
  const mantissa = n / 10 ** exp;
  return `${mantissa.toFixed(1)}e${exp}`;
}

/** Axis labels sit on exact powers of ten, so they can be shorter still. */
export function decadeLabel(exp: number): string {
  const suffix: Record<number, string> = { 0: '', 3: 'K', 6: 'M', 9: 'B', 12: 'T' };
  if (exp >= 0 && exp <= 12 && exp % 3 === 0) return `$1${suffix[exp]}`;
  if (exp < 0 && exp >= -3) return `$${(10 ** exp).toFixed(-exp)}`;
  return `1e${exp}`;
}

export function usd(n: number): string {
  return `$${compact(n)}`;
}

/** "12.7x too low" / "spot on" — the phrase under a revealed guess. */
export function offBy(guess: number | null, actual: number): string {
  if (guess === null) return 'no guess';
  const ratio = guess > actual ? guess / actual : actual / guess;
  if (ratio < 1.02) return 'spot on';
  const dir = guess > actual ? 'too high' : 'too low';
  return `${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)}x ${dir}`;
}

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

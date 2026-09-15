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

  // 0.0000809 rather than 8.09e-5 — players think in decimals here.
  return n.toPrecision(3).replace(/e-(\d+)$/, (_, exp) => {
    const zeros = '0'.repeat(Number(exp) - 1);
    return `0.${zeros}${n.toPrecision(3).split('e')[0].replace('.', '')}`;
  });
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

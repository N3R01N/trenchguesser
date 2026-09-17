import {
  FDV_MERGE_RATIO,
  type Category,
  type CategoryOutcome,
  type Guess,
  type RoundResult,
  type Truth,
} from './types.ts';

/** Float noise must never fake-break a genuine tie. */
const ERROR_EPSILON = 1e-9;
/** log10(0) is -Infinity; clamp so a zero guess is merely terrible, not fatal. */
const VALUE_FLOOR = 1e-12;

/** A value only scores if it is a real positive number — the log axis needs one. */
function usable(v: number | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * Squared error on the log axis.
 *
 * Plain squared difference ranks identically to absolute difference (squaring is
 * monotonic over non-negative values), and it rewards lowballing: guessing low is
 * bounded by the actual value, guessing high is unbounded. On the log axis, being
 * 3x off beats being 13x off in either direction.
 */
export function logError(guess: number, actual: number | undefined): number {
  const g = Number.isFinite(guess) && guess > 0 ? guess : VALUE_FLOOR;
  const a = usable(actual) ? actual : VALUE_FLOOR;
  const d = Math.log10(g) - Math.log10(a);
  return d * d;
}

/** How many times off a guess was, always >= 1. Drives the reveal animation tier. */
export function ratioOff(guess: number, actual: number): number {
  const g = Number.isFinite(guess) && guess > 0 ? guess : VALUE_FLOOR;
  const a = Number.isFinite(actual) && actual > 0 ? actual : VALUE_FLOOR;
  return g > a ? g / a : a / g;
}

export type RevealTier = 'bullseye' | 'close' | 'off' | 'way-off';

export function revealTier(guess: number | null, actual: number): RevealTier {
  if (guess === null) return 'way-off';
  const r = ratioOff(guess, actual);
  if (r <= 1.2) return 'bullseye';
  if (r <= 3) return 'close';
  if (r <= 10) return 'off';
  return 'way-off';
}

/**
 * FDV duplicates market cap for ~53% of the universe. When it does, scoring both
 * would hand a free second point to whoever won market cap, so we drop fdv for
 * the round and tell the client to label the input "Market cap / FDV".
 */
export function isFdvMerged(truth: Truth): boolean {
  const { mcap, fdv } = truth;
  if (!mcap || !fdv) return true;
  const ratio = mcap > fdv ? mcap / fdv : fdv / mcap;
  return ratio <= FDV_MERGE_RATIO;
}

/**
 * The categories actually scored this round.
 *
 * A category the universe never filled in is dropped before anything else: it
 * has no true value, so there is nothing to be close to. What survives then goes
 * through the FDV merge rule.
 */
export function effectiveCategories(
  configured: Category[],
  truth: Truth,
): { cats: Category[]; mergedFdv: boolean } {
  const available = configured.filter((c) => usable(truth[c]));

  const hasBoth = available.includes('mcap') && available.includes('fdv');
  if (!hasBoth) return { cats: available, mergedFdv: false };

  const merged = isFdvMerged(truth);
  if (!merged) return { cats: available, mergedFdv: false };
  return { cats: available.filter((c) => c !== 'fdv'), mergedFdv: true };
}

/**
 * Scores one round.
 *
 * Per category: every winner gains +1 for each loser, every loser drops -1 for
 * each winner. Ties share the win. Players who never submitted are automatic
 * losers and can never win. If nobody submitted, the category is void and
 * nobody moves. The delta always sums to zero.
 */
export function scoreRound(
  playerIds: string[],
  cats: Category[],
  truth: Truth,
  guesses: Record<string, Guess>,
): RoundResult {
  const delta: Record<string, number> = Object.fromEntries(
    playerIds.map((id) => [id, 0]),
  );
  const outcomes: CategoryOutcome[] = [];

  for (const cat of cats) {
    const actual = truth[cat];
    const errors: Record<string, number | null> = {};

    for (const id of playerIds) {
      const raw = guesses[id]?.values?.[cat];
      errors[id] =
        typeof raw === 'number' && Number.isFinite(raw) && raw > 0
          ? logError(raw, actual)
          : null;
    }

    const submitted = playerIds.filter((id) => errors[id] !== null);
    let winners: string[] = [];

    if (submitted.length > 0) {
      const best = Math.min(...submitted.map((id) => errors[id] as number));
      winners = submitted.filter(
        (id) => (errors[id] as number) <= best + ERROR_EPSILON,
      );
    }

    const w = winners.length;
    const l = playerIds.length - w;

    // Void when nobody guessed (w === 0) or everybody tied (l === 0).
    if (w > 0 && l > 0) {
      const winnerSet = new Set(winners);
      for (const id of playerIds) {
        delta[id] += winnerSet.has(id) ? l : -w;
      }
    }

    outcomes.push({ cat, winners, errors });
  }

  return { outcomes, delta };
}

/** Category wins for a player in a scored round — feeds the 🎯 badge. */
export function countCategoryWins(result: RoundResult, playerId: string): number {
  return result.outcomes.filter((o) => o.winners.includes(playerId)).length;
}

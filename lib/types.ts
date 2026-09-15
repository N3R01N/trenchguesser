/** Shared domain types. No runtime deps so tests can import freely. */

export const CATEGORIES = ['price', 'mcap', 'ath', 'fdv', 'vol'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  price: 'Price',
  mcap: 'Market cap',
  ath: 'All-time high',
  fdv: 'FDV',
  vol: '24h volume',
};

/** A coin as stored in the snapshot. Rank is its index in the snapshot, 1-based. */
export interface Coin {
  id: string;
  s: string; // ticker, uppercase
  n: string; // name
  img: string;
  price: number;
  mcap: number;
  ath: number;
  fdv: number;
  vol: number;
}

/** What players are allowed to see before the reveal. */
export type PublicCoin = Pick<Coin, 'id' | 's' | 'n' | 'img'>;

export const RANGES = {
  noob: { label: 'Noob coin', from: 100, to: 500 },
  normal: { label: 'Normal', from: 100, to: 1000 },
  degen: { label: 'Degen', from: 100, to: 2500 },
} as const;

export type RangeKey = keyof typeof RANGES;

export interface GameConfig {
  categories: Category[];
  /** Host-set base for a single-category round. Each extra category adds EXTRA_MS. */
  baseRoundMs: number;
  roundsMode: 'flat' | 'perPlayer';
  roundsValue: number;
  range: RangeKey;
}

export const DEFAULT_CONFIG: GameConfig = {
  categories: ['price', 'mcap'],
  baseRoundMs: 10_000,
  roundsMode: 'flat',
  roundsValue: 10,
  range: 'degen',
};

/** Each category beyond the first buys more time, so per-guess pressure stays constant. */
export const EXTRA_MS_PER_CATEGORY = 5_000;

export function roundDuration(base: number, categoryCount: number): number {
  return base + EXTRA_MS_PER_CATEGORY * Math.max(0, categoryCount - 1);
}

export type Phase =
  | 'lobby'
  | 'spinning'
  | 'guessing'
  | 'reveal'
  | 'standings'
  | 'final';

export interface Player {
  id: string;
  name: string;
  score: number;
  present: boolean;
  /** Category wins across the game — drives the 🎯 badge. */
  catWins: number;
  /** Consecutive rounds with a positive point delta — drives 🔥. */
  streak: number;
}

export interface Guess {
  at: number;
  values: Partial<Record<Category, number>>;
}

export interface CategoryOutcome {
  cat: Category;
  winners: string[];
  /** null means the player never submitted — an automatic loss. */
  errors: Record<string, number | null>;
}

export interface RoundResult {
  outcomes: CategoryOutcome[];
  /** Points gained or lost this round, per player. Always sums to zero. */
  delta: Record<string, number>;
}

export interface Round {
  i: number; // 1-based round number
  rank: number;
  spunBy: string;
  coin: PublicCoin;
  /** Frozen at spin time. Stripped from every payload until phase === 'reveal'. */
  truth: Record<Category, number>;
  /** Effective categories for this round — fdv is dropped when it duplicates mcap. */
  cats: Category[];
  mergedFdv: boolean;
  durationMs: number;
  /** Server epoch ms at which the sliders become live. */
  opensAt: number;
  result: RoundResult | null;
}

export interface Room {
  code: string;
  v: number;
  hostId: string;
  createdAt: number;
  config: GameConfig;
  phase: Phase;
  /** Server epoch ms. The only clock that counts. */
  phaseEndsAt: number | null;
  turnIdx: number;
  /** When the current spin turn began — drives the auto-spin for absent players. */
  spinningSince: number;
  totalRounds: number;
  usedRanks: number[];
  players: Player[];
  round: Round | null;
}

/**
 * The beat between the reel stopping and the sliders going live.
 *
 * Everyone watches the number land and the coin drop in together, and the
 * guessing clock only starts afterwards — so spinning never costs you time.
 */
export const SPIN_SETTLE_MS = 1_800;

/**
 * How often a client proves it is still there.
 *
 * A closed tab or a locked phone sends no goodbye, so presence is something you
 * keep proving rather than something you announce.
 */
export const HEARTBEAT_MS = 8_000;

/** Per-category beat during the reveal, shared by the server clock and the UI. */
export const REVEAL_STEP_MS = 2_400;

/** Guesses landing within 1.5s of the deadline still count. */
export const GUESS_GRACE_MS = 1_500;

/** FDV within this ratio of market cap is the same number — merge the categories. */
export const FDV_MERGE_RATIO = 1.1;

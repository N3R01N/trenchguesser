/** Shared domain types. No runtime deps so tests can import freely. */

export const CATEGORIES = [
  // coins
  'price',
  'mcap',
  'ath',
  'fdv',
  'vol',
  // nft collections
  'floor',
  'atvol',
  'owners',
  'sales',
] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * What a category's numbers are counted in.
 *
 * Coins are priced in dollars, collections in ETH — a floor is never quoted in
 * anything else — and owners and sales are not money at all, so they carry no
 * prefix. The unit rides with the category rather than with the universe,
 * because one round can mix money and counts.
 */
export type Unit = 'usd' | 'eth' | 'count';

export const CATEGORY_UNITS: Record<Category, Unit> = {
  price: 'usd',
  mcap: 'usd',
  ath: 'usd',
  fdv: 'usd',
  vol: 'usd',
  floor: 'eth',
  atvol: 'eth',
  owners: 'count',
  sales: 'count',
};

export const CATEGORY_LABELS: Record<Category, string> = {
  price: 'Price',
  mcap: 'Market cap',
  ath: 'All-time high',
  fdv: 'FDV',
  vol: '24h volume',
  floor: 'Floor price',
  atvol: 'All-time volume',
  owners: 'Owners',
  sales: 'Sales',
};

/**
 * The numbers under guess for one entry.
 *
 * Partial because a universe only fills in its own categories: a coin has no
 * floor price and an NFT collection has no all-time high.
 */
export type Truth = Partial<Record<Category, number>>;

/** One guessable thing. A coin today; an NFT collection is the same shape. */
export interface Entry {
  id: string;
  s: string; // ticker or short label, uppercase
  n: string; // name
  img: string;
  values: Truth;
}

/** What players are allowed to see before the reveal. */
export type PublicEntry = Omit<Entry, 'values'>;

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

export type PublicCoin = PublicEntry;

/** What a snapshot build produced. The host screen reports it while it waits. */
export interface SnapshotMeta {
  builtAt: number;
  size: number;
  chunks: number;
  bytes: number;
}

export type UniverseKey = 'coins' | 'nfts';

/**
 * What each universe can actually fill in.
 *
 * A category outside this list has no true value for the round, so scoring
 * drops it — the host is only ever offered the ones that mean something.
 */
export const UNIVERSE_CATEGORIES: Record<UniverseKey, readonly Category[]> = {
  coins: ['price', 'mcap', 'ath', 'fdv', 'vol'],
  nfts: ['floor', 'atvol', 'owners', 'sales'],
};

/**
 * A ranked pool of things to guess.
 *
 * The game asks for the entry at a rank and scores whatever values come back;
 * it never learns what kind of thing it is. Each source owns its own crawl, its
 * own exclusions and its own snapshot keys. Implementations are server-only —
 * this is the interface, which is erased.
 */
export interface UniverseSource {
  key: UniverseKey;
  /** Builds the ranked pool when the cached one has aged out. */
  ensureSnapshot(force?: boolean): Promise<SnapshotMeta>;
  /** The entry at a 1-based rank, or null when the rank is out of range. */
  entryAtRank(rank: number): Promise<Entry | null>;
  snapshotMeta(): Promise<SnapshotMeta | null>;
}

export type RangeKey = 'noob' | 'normal' | 'degen';

export interface Range {
  label: string;
  from: number;
  to: number;
}

/**
 * How deep into the ladder each difficulty reaches.
 *
 * Coins start at 100 because the top of that list is common knowledge and no
 * fun to guess. Collections start at 1: there are far fewer of them, and
 * recognising the art is half the appeal rather than a giveaway.
 */
export const UNIVERSE_RANGES: Record<UniverseKey, Record<RangeKey, Range>> = {
  coins: {
    noob: { label: 'Noob coin', from: 100, to: 500 },
    normal: { label: 'Normal', from: 100, to: 1000 },
    degen: { label: 'Degen', from: 100, to: 2500 },
  },
  nfts: {
    noob: { label: 'Blue chips', from: 1, to: 80 },
    normal: { label: 'Normal', from: 1, to: 250 },
    degen: { label: 'Degen', from: 1, to: 1000 },
  },
};

/**
 * Where a guess stops being good, per universe.
 *
 * A coin price spans about thirteen orders of magnitude and an NFT floor about
 * five, so the same ratio is a far better guess on the collection ladder than
 * on the coin one. Holding the thresholds equal would make almost every NFT
 * round read as a bullseye.
 */
export const REVEAL_TIERS: Record<UniverseKey, { bullseye: number; close: number; off: number }> = {
  coins: { bullseye: 1.2, close: 3, off: 10 },
  nfts: { bullseye: 1.1, close: 2, off: 5 },
};

/** What one entry is called, for anything a player reads. */
export const ENTRY_NOUN: Record<UniverseKey, string> = {
  coins: 'coin',
  nfts: 'collection',
};

/** What the rank in "#412 by ..." is a rank of. */
export const RANKED_BY: Record<UniverseKey, string> = {
  coins: 'market cap',
  nfts: 'all-time volume',
};

export const UNIVERSE_LABELS: Record<UniverseKey, string> = {
  coins: 'Coins',
  nfts: 'NFTs',
};

export interface GameConfig {
  /** Which universe the game draws from. */
  mode: UniverseKey;
  categories: Category[];
  /** Host-set base for a single-category round. Each extra category adds EXTRA_MS. */
  baseRoundMs: number;
  roundsMode: 'flat' | 'perPlayer';
  roundsValue: number;
  range: RangeKey;
}

export const DEFAULT_CATEGORIES: Record<UniverseKey, Category[]> = {
  coins: ['price', 'mcap'],
  nfts: ['floor', 'owners'],
};

export const DEFAULT_CONFIG: GameConfig = {
  mode: 'coins',
  categories: [...DEFAULT_CATEGORIES.coins],
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
  truth: Truth;
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

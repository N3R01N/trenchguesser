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
  // cryptopunks
  'lastSale',
  'highSale',
  'saleCount',
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
  lastSale: 'eth',
  highSale: 'eth',
  saleCount: 'count',
};

/**
 * Categories where zero is an answer rather than missing data.
 *
 * Three quarters of punks have sold and a quarter never have, so "never sold"
 * is one of the things you can be right about. The label is what the button
 * says; a category without one treats zero as no value at all, which is what
 * every coin and collection category wants.
 */
export const CATEGORY_ZERO_LABEL: Partial<Record<Category, string>> = {
  lastSale: 'Never sold',
  highSale: 'Never sold',
  saleCount: 'Never sold',
};

export function zeroMeans(cat: Category): string | undefined {
  return CATEGORY_ZERO_LABEL[cat];
}

/**
 * Categories whose slider stops short of the real maximum.
 *
 * Punk sales run to 124,457 ETH, but only three in the whole history clear
 * 5,000 — the genuine record at 8,000 and two flash-loan stunts. Stretching the
 * axis to hold them would waste most of the slider on prices nothing has, so
 * the truth keeps its real value and the answer above the cap is a bucket.
 */
export const CATEGORY_OVER_CAP: Partial<Record<Category, number>> = {
  lastSale: 5_000,
  highSale: 5_000,
};

/**
 * What an over-the-cap answer submits.
 *
 * Chosen so that naming the bucket beats pinning the slider at 5,000 for every
 * sale that actually lives above it — 8,000, 24,000 and 124,457 ETH. On the log
 * axis that needs a value between the cap and about 12,800, so anyone who says
 * "over" is rewarded for saying it rather than for guessing how far over.
 */
export const OVER_CAP_GUESS = 10_000;

/**
 * How an entry's picture wants to be shown.
 *
 * A token logo is a circle by convention. A punk is 24x24 pixel art blown up to
 * 1024, and its traits are the entire guess — an alien is worth a thousand
 * plain males — so it gets room and hard edges instead of a cropped thumbnail.
 */
export const ART: Record<UniverseKey, { round: boolean; pixel: boolean; size: number }> = {
  coins: { round: true, pixel: false, size: 48 },
  nfts: { round: true, pixel: false, size: 48 },
  punks: { round: false, pixel: true, size: 64 },
};

/** The picture gets the screen to itself on the beat before the sliders. */
export const INTRO_ART_SIZE: Record<UniverseKey, number> = {
  coins: 48,
  nfts: 48,
  punks: 168,
};

/**
 * Slider bounds per category, in orders of magnitude.
 *
 * A log slider is the only input that works here: typing $1,500,000 on a phone
 * keyboard inside ten seconds is not possible, and because scoring is itself
 * logarithmic, slider travel maps linearly onto score.
 */
export const CATEGORY_BOUNDS: Record<Category, [number, number]> = {
  price: [1e-9, 1e4],
  mcap: [1e4, 1e12],
  ath: [1e-9, 1e5],
  fdv: [1e4, 1e13],
  vol: [1e2, 1e11],
  // NFT collections, denominated in ETH. Far fewer decades than a coin spans,
  // so guesses cluster harder and rounds run tighter.
  //
  // Measured off a live 2,876-deep ladder rather than guessed: floors run from
  // 0.00024 to 29.7 ETH, all-time volume 269 to 1.38M, owners 220 to 5.3K and
  // sales 476 to 39K. The bounds sit a little outside that on both sides —
  // wide enough that a real value is never out of reach, tight enough that the
  // slider is not mostly dead travel.
  floor: [1e-5, 1e2],
  atvol: [1e2, 1e7],
  owners: [1e2, 1e5],
  sales: [1e2, 1e6],
  // Punk sales run 0.01 to 4,850 ETH across 5.7 decades. The slider stops at
  // 5,000; the three sales above it are answered with a bucket, not aimed at.
  lastSale: [1e-2, 5e3],
  highSale: [1e-2, 5e3],
  // Thirty thousand sales spread over ten thousand punks: most that have sold
  // at all have sold a handful of times, and the most flipped are in the dozens.
  // A hundred is out of reach of the real ladder on purpose — the top of the
  // axis is meant to be an overbid, not a target.
  saleCount: [1, 1e2],
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
  lastSale: 'Last sale',
  highSale: 'Highest sale',
  saleCount: 'Number of sales',
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
  /**
   * Per-category asides revealed with the truth — the date a punk's last sale
   * happened, say. Withheld until the reveal for the same reason the numbers
   * are: a 2021 date narrows a price to within a decade.
   */
  notes?: Partial<Record<Category, string>>;
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

export const UNIVERSE_KEYS = ['coins', 'nfts', 'punks'] as const;
export type UniverseKey = (typeof UNIVERSE_KEYS)[number];

/**
 * What each universe can actually fill in.
 *
 * A category outside this list has no true value for the round, so scoring
 * drops it — the host is only ever offered the ones that mean something.
 */
export const UNIVERSE_CATEGORIES: Record<UniverseKey, readonly Category[]> = {
  coins: ['price', 'mcap', 'ath', 'fdv', 'vol'],
  nfts: ['floor', 'atvol', 'owners', 'sales'],
  punks: ['lastSale', 'highSale', 'saleCount'],
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
 *
 * These are starting points rather than the choice itself: picking one fills
 * the two numbers the game actually spins between, which the host is then free
 * to move. A table that wants ranks 50 to 200 is not a difficulty we can name.
 */
export const UNIVERSE_RANGES: Record<UniverseKey, Record<RangeKey, Range>> = {
  coins: {
    noob: { label: 'Noob coin', from: 100, to: 500 },
    normal: { label: 'Normal', from: 100, to: 1000 },
    degen: { label: 'Degen', from: 100, to: 2500 },
  },
  nfts: {
    noob: { label: 'Blue chips', from: 1, to: 250 },
    normal: { label: 'Normal', from: 1, to: 500 },
    degen: { label: 'Degen', from: 1, to: 1000 },
  },
  /**
   * A punk's index says nothing about what it is worth, so there is no harder
   * or easier end of this ladder to pick. All three tiers are the whole set,
   * and the host screen hides the choice rather than offering three of the same.
   */
  punks: {
    noob: { label: 'All punks', from: 0, to: 9999 },
    normal: { label: 'All punks', from: 0, to: 9999 },
    degen: { label: 'All punks', from: 0, to: 9999 },
  },
};

/**
 * How far each ladder really goes.
 *
 * The presets stop well short of these, because a hand-typed range should be
 * able to reach the end of the pool. Past the end there is nothing to land on:
 * the spin clamps to whatever the snapshot actually holds, so these are what
 * the host is allowed to ask for rather than a promise.
 */
export const RANK_LIMITS: Record<UniverseKey, { min: number; max: number }> = {
  coins: { min: 1, max: 2_500 },
  nfts: { min: 1, max: 2_800 },
  punks: { min: 0, max: 9_999 },
};

/** Fewer ranks than this and a game would keep landing on the same entry. */
export const MIN_RANK_SPAN = 10;

/**
 * The range the game will actually spin between.
 *
 * Hand-typed numbers arrive in any state — empty, reversed, past the end of the
 * ladder — and the server normalises rather than refuses, because a bad range
 * should cost the host a correction on screen, not a failed room.
 */
export function normalizeRankRange(
  mode: UniverseKey,
  from: number,
  to: number,
): { from: number; to: number } {
  const limit = RANK_LIMITS[mode];
  const preset = UNIVERSE_RANGES[mode].degen;

  const clamp = (v: number, fallback: number) =>
    Number.isFinite(v)
      ? Math.min(limit.max, Math.max(limit.min, Math.round(v)))
      : fallback;

  let lo = clamp(from, preset.from);
  let hi = clamp(to, preset.to);
  if (lo > hi) [lo, hi] = [hi, lo];

  // Widen upwards where there is room, downwards where there is not.
  if (hi - lo < MIN_RANK_SPAN) {
    hi = Math.min(limit.max, lo + MIN_RANK_SPAN);
    lo = Math.max(limit.min, hi - MIN_RANK_SPAN);
  }
  return { from: lo, to: hi };
}

/** What to call a range: the preset it matches, or that it is nobody's preset. */
export function rangeLabel(mode: UniverseKey, from: number, to: number): string {
  const presets = Object.values(UNIVERSE_RANGES[mode]);
  return presets.find((r) => r.from === from && r.to === to)?.label ?? 'Custom';
}

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
  punks: { bullseye: 1.15, close: 2.5, off: 8 },
};

/** What one entry is called, for anything a player reads. */
export const ENTRY_NOUN: Record<UniverseKey, string> = {
  coins: 'coin',
  nfts: 'collection',
  punks: 'punk',
};

/** What the number on the reel is. A punk's index is the punk, not a ranking. */
export const RANK_LABEL: Record<UniverseKey, string> = {
  coins: 'Rank',
  nfts: 'Rank',
  punks: 'Punk',
};

/** What the rank in "#412 by ..." is a rank of. */
export const RANKED_BY: Record<UniverseKey, string> = {
  coins: 'market cap',
  nfts: 'all-time volume',
  punks: '',
};

export const UNIVERSE_LABELS: Record<UniverseKey, string> = {
  coins: 'Coins',
  nfts: 'NFTs',
  punks: 'Punks',
};

export interface GameConfig {
  /** Which universe the game draws from. */
  mode: UniverseKey;
  categories: Category[];
  /** Host-set base for a single-category round. Each extra category adds EXTRA_MS. */
  baseRoundMs: number;
  roundsMode: 'flat' | 'perPlayer';
  roundsValue: number;
  /** The ladder positions this game spins between. A preset only seeds them. */
  rankFrom: number;
  rankTo: number;
}

export const DEFAULT_CATEGORIES: Record<UniverseKey, Category[]> = {
  coins: ['price', 'mcap'],
  nfts: ['floor', 'owners'],
  punks: ['lastSale', 'highSale'],
};

export const DEFAULT_CONFIG: GameConfig = {
  mode: 'coins',
  categories: [...DEFAULT_CATEGORIES.coins],
  baseRoundMs: 10_000,
  roundsMode: 'flat',
  roundsValue: 10,
  rankFrom: UNIVERSE_RANGES.coins.degen.from,
  rankTo: UNIVERSE_RANGES.coins.degen.to,
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
  /** Revealed alongside the truth, never before it. */
  notes: Partial<Record<Category, string>>;
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

/**
 * How early a client may ask to end the reveal.
 *
 * Countdowns run a touch ahead of the server — the clock offset is read off a
 * response that has already crossed the network — so the first client to hit
 * zero tends to knock a few milliseconds early. The transition is idempotent
 * and the reveal is generous, so meeting it early costs nothing, where turning
 * it away used to cost the round.
 */
export const REVEAL_GRACE_MS = 500;

/** FDV within this ratio of market cap is the same number — merge the categories. */
export const FDV_MERGE_RATIO = 1.1;

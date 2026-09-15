import { store } from './redis.ts';
import type { Coin } from './types.ts';

const CG_BASE = 'https://api.coingecko.com/api/v3';

/**
 * Raw rank 2547 today is "Linde plc (Ondo Tokenized Stock)" at $470. These six
 * categories strip the list down to things worth guessing. Deliberately absent:
 * `real-world-assets-rwa`, which holds legitimate protocol tokens like ONDO.
 */
const EXCLUDED_CATEGORIES = [
  'stablecoins',
  'bridged-tokens',
  'wrapped-tokens',
  'liquid-staking-tokens',
  'tokenized-products',
  'xstocks-ecosystem',
] as const;

const PER_PAGE = 250;
/** 27 pages of raw list yields ~2,532 survivors — the whole usable universe. */
const CRAWL_PAGES = 27;
/** Below this, prices are stale and the "right" answer is fiction. */
const VOLUME_FLOOR = 10_000;

const SNAPSHOT_TTL_MS = 3 * 60 * 60 * 1000;
const EXCLUSIONS_TTL_S = 24 * 60 * 60;
const KEY_TTL_S = 7 * 24 * 60 * 60;

const K = {
  meta: 'snap:meta',
  chunk: (i: number) => `snap:c:${i}`,
  exclusions: 'snap:excl',
  lock: 'snap:lock',
};

export interface SnapshotMeta {
  builtAt: number;
  size: number;
  chunks: number;
  bytes: number;
}

interface MarketRow {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number | null;
  market_cap: number | null;
  total_volume: number | null;
  ath: number | null;
  fully_diluted_valuation: number | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The keyless API 429s on the third consecutive call, so a Demo key is required.
 * Retries cover both rate limiting and the transient network failures seen while
 * crawling 27 pages back to back.
 */
async function cg<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = process.env.COINGECKO_API_KEY;
  if (!key) throw new Error('COINGECKO_API_KEY is not set');

  const url = `${CG_BASE}${path}?${new URLSearchParams(params)}`;
  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'x-cg-demo-api-key': key, accept: 'application/json' },
        cache: 'no-store',
      });
      if (res.status === 429) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`CoinGecko ${res.status} on ${path}`);
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw new Error(`CoinGecko request failed: ${path} — ${String(lastError)}`);
}

/** Ids of every coin in the excluded categories. ~3,202 of them. */
export async function buildExclusionSet(): Promise<string[]> {
  const ids = new Set<string>();

  for (const category of EXCLUDED_CATEGORIES) {
    for (let page = 1; ; page++) {
      const rows = await cg<MarketRow[]>('/coins/markets', {
        vs_currency: 'usd',
        category,
        per_page: String(PER_PAGE),
        page: String(page),
      });
      for (const r of rows) ids.add(r.id);
      if (rows.length < PER_PAGE) break;
      await sleep(700);
    }
    await sleep(700);
  }
  return [...ids];
}

async function cachedExclusions(): Promise<Set<string>> {
  const s = store();
  const cached = await s.get<string[]>(K.exclusions);
  if (cached) return new Set(cached);

  const ids = await buildExclusionSet();
  await s.set(K.exclusions, ids, { ex: EXCLUSIONS_TTL_S });
  return new Set(ids);
}

async function crawlMarkets(pages: number): Promise<MarketRow[]> {
  const rows: MarketRow[] = [];
  for (let page = 1; page <= pages; page++) {
    const batch = await cg<MarketRow[]>('/coins/markets', {
      vs_currency: 'usd',
      order: 'market_cap_desc',
      per_page: String(PER_PAGE),
      page: String(page),
    });
    if (batch.length === 0) break;
    rows.push(...batch);
    await sleep(700);
  }
  return rows;
}

/**
 * Rank is position in this array, not CoinGecko's `market_cap_rank` field — that
 * field disagrees with the market_cap_desc ordering (page 11 held ranks
 * 2113-2588 interleaved, all 250 rows mismatched).
 */
export async function buildUniverse(): Promise<Coin[]> {
  const [excluded, rows] = [await cachedExclusions(), await crawlMarkets(CRAWL_PAGES)];

  return rows
    .filter((r) => !excluded.has(r.id))
    .filter(
      (r) =>
        r.current_price &&
        r.market_cap &&
        r.ath &&
        r.fully_diluted_valuation &&
        r.total_volume &&
        r.total_volume >= VOLUME_FLOOR,
    )
    .map((r) => ({
      id: r.id,
      s: r.symbol.toUpperCase(),
      n: r.name,
      img: r.image,
      price: r.current_price as number,
      mcap: r.market_cap as number,
      ath: r.ath as number,
      fdv: r.fully_diluted_valuation as number,
      vol: r.total_volume as number,
    }));
}

async function writeSnapshot(coins: Coin[]): Promise<SnapshotMeta> {
  const s = store();
  const chunks = Math.ceil(coins.length / PER_PAGE);
  let bytes = 0;

  for (let i = 0; i < chunks; i++) {
    const slice = coins.slice(i * PER_PAGE, (i + 1) * PER_PAGE);
    bytes += JSON.stringify(slice).length;
    await s.set(K.chunk(i), slice, { ex: KEY_TTL_S });
  }

  const meta: SnapshotMeta = {
    builtAt: Date.now(),
    size: coins.length,
    chunks,
    bytes,
  };
  await s.set(K.meta, meta, { ex: KEY_TTL_S });
  return meta;
}

/**
 * Rebuilds lazily on lobby creation rather than on a schedule: Vercel Hobby only
 * permits daily cron, fired within a +/-59 minute window. One builder at a time;
 * everyone else keeps serving the stale snapshot.
 */
export async function ensureSnapshot(force = false): Promise<SnapshotMeta> {
  const s = store();
  const meta = await s.get<SnapshotMeta>(K.meta);

  if (!force && meta && Date.now() - meta.builtAt < SNAPSHOT_TTL_MS) return meta;

  const gotLock = await s.set(K.lock, Date.now(), { nx: true, ex: 180 });
  if (!gotLock) {
    if (meta) return meta;
    // No snapshot at all and someone else is building it — wait them out.
    for (let i = 0; i < 40; i++) {
      await sleep(2000);
      const fresh = await s.get<SnapshotMeta>(K.meta);
      if (fresh) return fresh;
    }
    throw new Error('snapshot build timed out');
  }

  try {
    const coins = await buildUniverse();
    if (coins.length < 500) {
      throw new Error(`refusing to publish a thin universe (${coins.length} coins)`);
    }
    return await writeSnapshot(coins);
  } finally {
    await s.del(K.lock);
  }
}

/** Chunked reads keep a single rank lookup at ~45 KB instead of the full ~440 KB. */
export async function coinAtRank(rank: number): Promise<Coin | null> {
  const s = store();
  const meta = await s.get<SnapshotMeta>(K.meta);
  if (!meta || rank < 1 || rank > meta.size) return null;

  const chunk = await s.get<Coin[]>(K.chunk(Math.floor((rank - 1) / PER_PAGE)));
  return chunk?.[(rank - 1) % PER_PAGE] ?? null;
}

export async function snapshotMeta(): Promise<SnapshotMeta | null> {
  return store().get<SnapshotMeta>(K.meta);
}

export const UNIVERSE_CONFIG = {
  PER_PAGE,
  CRAWL_PAGES,
  VOLUME_FLOOR,
  EXCLUDED_CATEGORIES,
  SNAPSHOT_TTL_MS,
};

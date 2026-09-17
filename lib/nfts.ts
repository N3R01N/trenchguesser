import { store } from './redis.ts';
import { RoomError } from './errors.ts';
import type { Entry, SnapshotMeta, UniverseSource } from './types.ts';

const OS_BASE = 'https://api.opensea.io/api/v2';

/**
 * Ethereum only.
 *
 * Floors and volumes come denominated in each chain's own token, so a
 * multi-chain ladder would stand a POL floor next to an ETH one and make a
 * single log axis meaningless. Ethereum is also where the collections anyone
 * recognises live, and staying on one chain keeps the crawl short.
 */
const CHAIN = 'ethereum';

/**
 * Rank is position in an all-time-volume ordering.
 *
 * Daily volume reorders constantly and floats wash-traded junk to the top; the
 * all-time ladder barely moves week to week, which is what lets a snapshot go
 * stale without going wrong.
 */
const SORT_BY = 'total_volume';

/** The endpoint's own maximum. */
const PER_PAGE = 100;
/** ~3,000 raw rows in, ~1,000 survivors out — the whole recognisable universe. */
const CRAWL_PAGES = 30;
/** Rows per stored chunk, so one rank lookup reads ~25 KB rather than the lot. */
const CHUNK = 250;

/**
 * OpenSea's own anti-scam signal, and the highest-value filter available.
 * It arrives in the cheap list call, so it costs nothing to apply.
 */
const SAFE_STATUSES = new Set(['verified', 'approved']);

/** Below this a collection's floor is fiction — there is no real market. */
const SALES_FLOOR = 50;

const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_TTL_S = 7 * 24 * 60 * 60;
/**
 * Numbers are fetched per round, so two rooms landing on the same collection
 * would otherwise pay twice. Short enough that a floor never goes properly
 * stale; scoring is logarithmic, so a quarter-hour of drift is noise.
 */
const STATS_TTL_S = 15 * 60;

const K = {
  meta: 'snap:nfts:meta',
  chunk: (i: number) => `snap:nfts:c:${i}`,
  lock: 'snap:nfts:lock',
  stats: (slug: string) => `nft:stats:${slug}`,
};

/** A collection as stored in the snapshot. Rank is its index, 1-based. */
export interface Collection {
  slug: string;
  n: string; // display name
  s: string; // category, uppercased — collections have no ticker
  img: string;
}

interface TopRow {
  collection: string;
  name: string;
  image_url?: string | null;
  category?: string | null;
  safelist_status?: string | null;
  is_nsfw?: boolean;
  is_disabled?: boolean;
}

interface TopResponse {
  collections?: TopRow[];
  next?: string | null;
}

interface StatsResponse {
  total?: {
    floor_price?: number | null;
    volume?: number | null;
    num_owners?: number | null;
    sales?: number | null;
  };
}

/** What a collection is actually worth, fetched the moment it is landed on. */
export interface CollectionStats {
  floor: number;
  atvol: number;
  owners: number;
  sales: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A free-tier key allows 600 reads an hour, and the docs warn that some endpoint
 * groups are metered tighter than that headline. Rather than hardcode a pace we
 * read what the response tells us: back off to the window reset on a 429, and
 * keep the last seen budget around so a caller can look at it.
 */
export let lastRateLimit: { limit: string; remaining: string; reset: string } | null =
  null;

async function os<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const key = process.env.OPENSEA_API_KEY;
  if (!key) throw new RoomError('NFT mode needs OPENSEA_API_KEY to be set', 503);

  const qs = new URLSearchParams(params).toString();
  const url = `${OS_BASE}${path}${qs ? `?${qs}` : ''}`;
  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'x-api-key': key, accept: 'application/json' },
        cache: 'no-store',
      });

      const limit = res.headers.get('x-ratelimit-limit');
      if (limit) {
        lastRateLimit = {
          limit,
          remaining: res.headers.get('x-ratelimit-remaining') ?? '?',
          reset: res.headers.get('x-ratelimit-reset') ?? '?',
        };
      }

      if (res.status === 429) {
        const reset = Number(res.headers.get('x-ratelimit-reset'));
        const waitMs = Number.isFinite(reset)
          ? Math.min(30_000, Math.max(0, reset * 1000 - Date.now()))
          : 2000 * (attempt + 1);
        await sleep(waitMs || 2000 * (attempt + 1));
        continue;
      }
      // A collection that has gone away is a fact, not a failure to retry.
      if (res.status === 404) throw new Error(`OpenSea 404 on ${path}`);
      if (!res.ok) throw new Error(`OpenSea ${res.status} on ${path}`);
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (String(err).includes('404')) throw err;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw new Error(`OpenSea request failed: ${path} — ${String(lastError)}`);
}

/**
 * Everything worth filtering on arrives in the list call, which costs one
 * request per hundred collections. The numbers cost one request each, so the
 * junk is thrown out here — before any of that is spent.
 */
function keep(row: TopRow): boolean {
  if (!row.collection || !row.name) return false;
  if (row.is_nsfw || row.is_disabled) return false;
  if (!SAFE_STATUSES.has(row.safelist_status ?? '')) return false;
  // The art is the whole appeal of this mode; a blank tile is a dead round.
  if (!row.image_url) return false;
  return true;
}

export async function buildUniverse(pages = CRAWL_PAGES): Promise<Collection[]> {
  const out: Collection[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < pages; page++) {
    const params: Record<string, string> = {
      sort_by: SORT_BY,
      chains: CHAIN,
      limit: String(PER_PAGE),
    };
    if (cursor) params.cursor = cursor;

    const res = await os<TopResponse>('/collections/top', params);
    const rows = res.collections ?? [];

    for (const row of rows) {
      if (!keep(row) || seen.has(row.collection)) continue;
      seen.add(row.collection);
      out.push({
        slug: row.collection,
        n: row.name,
        s: (row.category ?? '').toUpperCase(),
        img: row.image_url as string,
      });
    }

    cursor = res.next ?? undefined;
    if (!cursor || rows.length < PER_PAGE) break;
    await sleep(250);
  }

  return out;
}

async function writeSnapshot(collections: Collection[]): Promise<SnapshotMeta> {
  const s = store();
  const chunks = Math.ceil(collections.length / CHUNK);
  let bytes = 0;

  for (let i = 0; i < chunks; i++) {
    const slice = collections.slice(i * CHUNK, (i + 1) * CHUNK);
    bytes += JSON.stringify(slice).length;
    await s.set(K.chunk(i), slice, { ex: KEY_TTL_S });
  }

  const meta: SnapshotMeta = {
    builtAt: Date.now(),
    size: collections.length,
    chunks,
    bytes,
  };
  await s.set(K.meta, meta, { ex: KEY_TTL_S });
  return meta;
}

/**
 * The ranked ladder only — names, art and order, no numbers.
 *
 * It is roughly thirty requests, so unlike the coin crawl this is cheap enough
 * to run inside a lobby creation. The numbers are fetched per round instead.
 */
export async function ensureSnapshot(force = false): Promise<SnapshotMeta> {
  const s = store();
  const meta = await s.get<SnapshotMeta>(K.meta);

  if (!force && meta && Date.now() - meta.builtAt < SNAPSHOT_TTL_MS) return meta;

  const gotLock = await s.set(K.lock, Date.now(), { nx: true, ex: 180 });
  if (!gotLock) {
    if (meta) return meta;
    for (let i = 0; i < 40; i++) {
      await sleep(2000);
      const fresh = await s.get<SnapshotMeta>(K.meta);
      if (fresh) return fresh;
    }
    throw new Error('nft snapshot build timed out');
  }

  try {
    const collections = await buildUniverse();
    if (collections.length < 100) {
      throw new Error(`refusing to publish a thin universe (${collections.length})`);
    }
    return await writeSnapshot(collections);
  } finally {
    await s.del(K.lock);
  }
}

export async function collectionAtRank(rank: number): Promise<Collection | null> {
  const s = store();
  const meta = await s.get<SnapshotMeta>(K.meta);
  if (!meta || rank < 1 || rank > meta.size) return null;

  const chunk = await s.get<Collection[]>(K.chunk(Math.floor((rank - 1) / CHUNK)));
  return chunk?.[(rank - 1) % CHUNK] ?? null;
}

/** One request, cached, and never allowed to take a round down with it. */
export async function statsFor(slug: string): Promise<CollectionStats | null> {
  const s = store();
  const cached = await s.get<CollectionStats>(K.stats(slug));
  if (cached) return cached;

  let res: StatsResponse;
  try {
    res = await os<StatsResponse>(`/collections/${slug}/stats`);
  } catch {
    return null;
  }

  const total = res.total;
  if (!total) return null;

  const stats: CollectionStats = {
    floor: Number(total.floor_price ?? 0),
    atvol: Number(total.volume ?? 0),
    owners: Number(total.num_owners ?? 0),
    sales: Number(total.sales ?? 0),
  };

  // The build could not filter on numbers it had not fetched, so this is where
  // a collection with no real market gets thrown out.
  if (!(stats.sales >= SALES_FLOOR) || !(stats.floor > 0)) return null;

  await s.set(K.stats(slug), stats, { ex: STATS_TTL_S });
  return stats;
}

/** NFT collections, ranked by all-time volume, priced at the moment you land. */
export const nftSource: UniverseSource = {
  key: 'nfts',
  ensureSnapshot,
  async snapshotMeta() {
    return store().get<SnapshotMeta>(K.meta);
  },
  async entryAtRank(rank: number): Promise<Entry | null> {
    const c = await collectionAtRank(rank);
    if (!c) return null;

    const stats = await statsFor(c.slug);
    if (!stats) return null; // caller re-rolls onto another rank

    return {
      id: c.slug,
      s: c.s,
      n: c.n,
      img: c.img,
      values: {
        floor: stats.floor,
        atvol: stats.atvol,
        owners: stats.owners,
        sales: stats.sales,
      },
    };
  },
};

export const NFT_UNIVERSE_CONFIG = {
  CHAIN,
  SORT_BY,
  PER_PAGE,
  CRAWL_PAGES,
  SAFE_STATUSES,
  SALES_FLOOR,
  SNAPSHOT_TTL_MS,
  STATS_TTL_S,
};

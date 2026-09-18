import { store } from './redis.ts';
import { RoomError } from './errors.ts';
import type { Entry, SnapshotMeta, Truth, UniverseSource } from './types.ts';

const BASE = 'https://www.cryptopunks.app';

/** Every punk is playable, because "never sold" is an answer rather than a gap. */
const PUNK_COUNT = 10_000;

/**
 * The smallest sale worth calling a price, and deliberately the same as the
 * bottom of the slider.
 *
 * Sales at exactly 0 ETH are an artefact of the punk contract — accepting a bid
 * emits a sale the feed records at zero, and 4% of the history looks like that.
 * Another few dozen are dust. Anything under a hundredth of an ETH is a number
 * no player could aim at, so a punk left with nothing above this reads as never
 * sold, which is an answer rather than a gap.
 */
const MIN_SALE_ETH = 0.01;

/**
 * Where the slider stops, and where the "over" bucket begins.
 *
 * Three sales in the whole of punk history clear it: #9998 at 124,457 and #1563
 * at 24,000, both flash-loan stunts, and #5822 at 8,000, which is the genuine
 * record. They are kept at their real values and answered with a bucket rather
 * than a slider nobody could aim.
 */
export const SALE_CAP_ETH = 5_000;

const PAGE = 1_000;
/** 31 pages covers the history to June 2017; the guard is for a bad cursor. */
const MAX_PAGES = 80;

const SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;
const KEY_TTL_S = 7 * 24 * 60 * 60;
const CHUNK = 500;

const K = {
  meta: 'snap:punks:meta',
  chunk: (i: number) => `snap:punks:c:${i}`,
  lock: 'snap:punks:lock',
};

/** One punk, flattened for storage. Zero means never sold at a real price. */
interface Row {
  /** last sale, and when */
  l: number;
  la: number;
  /** highest sale, and when */
  h: number;
  ha: number;
  /** how many real sales it has had */
  n: number;
}

interface SaleRow {
  id: string;
  punkId: string;
  value: string;
  timestamp: string | number;
}

interface SalesPage {
  data?: SaleRow[];
  pageInfo?: { endCursor?: string | null };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * cryptopunks.app blocks requests without a browser user agent, and its docs
 * are wrong in three places — /details returns no history whatever the docs
 * say, batch-recent-history caps at three rows, and hasNextPage is always
 * false. Only the cursor can be trusted, so the crawl runs until a page
 * repeats itself rather than until the API says to stop.
 */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0 Safari/537.36';

async function api<T>(path: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        headers: { 'user-agent': UA, accept: 'application/json' },
        cache: 'no-store',
      });
      if (res.status === 429) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`cryptopunks.app ${res.status} on ${path}`);
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw new RoomError(`Could not reach cryptopunks.app — ${String(lastError)}`, 503);
}

const empty = (): Row => ({ l: 0, la: 0, h: 0, ha: 0, n: 0 });

/** Every sale ever, folded down to one row per punk. */
export async function buildUniverse(): Promise<Row[]> {
  const rows: Row[] = Array.from({ length: PUNK_COUNT }, empty);
  const seen = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const qs: string = `action=all-sales&limit=${PAGE}${
      cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
    }`;
    const body: SalesPage = await api<SalesPage>(`/api/punks?${qs}`);

    const batch = body.data ?? [];
    if (batch.length === 0) break;

    let fresh = 0;
    for (const s of batch) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      fresh += 1;

      const index = Number(s.punkId);
      const eth = Number(BigInt(s.value)) / 1e18;
      const at = Number(s.timestamp);
      if (!Number.isInteger(index) || index < 0 || index >= PUNK_COUNT) continue;
      if (!(eth >= MIN_SALE_ETH) || !Number.isFinite(at)) continue;

      const row = rows[index] as Row;
      row.n += 1;
      if (at > row.la) {
        row.l = eth;
        row.la = at;
      }
      if (eth > row.h) {
        row.h = eth;
        row.ha = at;
      }
    }

    // The feed says hasNextPage:false on every page, so exhaustion is detected
    // by a page that adds nothing rather than by asking.
    if (fresh === 0) break;
    const next: string | null = body.pageInfo?.endCursor ?? null;
    if (!next) break;
    cursor = next;
    await sleep(120);
  }

  return rows;
}

async function writeSnapshot(rows: Row[]): Promise<SnapshotMeta> {
  const s = store();
  const chunks = Math.ceil(rows.length / CHUNK);
  let bytes = 0;

  for (let i = 0; i < chunks; i++) {
    const slice = rows.slice(i * CHUNK, (i + 1) * CHUNK);
    bytes += JSON.stringify(slice).length;
    await s.set(K.chunk(i), slice, { ex: KEY_TTL_S });
  }

  const meta: SnapshotMeta = { builtAt: Date.now(), size: rows.length, chunks, bytes };
  await s.set(K.meta, meta, { ex: KEY_TTL_S });
  return meta;
}

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
    throw new RoomError('punk snapshot build timed out', 503);
  }

  try {
    const rows = await buildUniverse();
    const sold = rows.filter((r) => r.n > 0).length;
    if (sold < 1_000) {
      throw new RoomError(`refusing to publish a thin punk history (${sold} sold)`, 503);
    }
    return await writeSnapshot(rows);
  } finally {
    await s.del(K.lock);
  }
}

export async function rowAt(index: number): Promise<Row | null> {
  const s = store();
  const meta = await s.get<SnapshotMeta>(K.meta);
  if (!meta || index < 0 || index >= meta.size) return null;

  const chunk = await s.get<Row[]>(K.chunk(Math.floor(index / CHUNK)));
  return chunk?.[index % CHUNK] ?? null;
}

/** "Mar 2021" — the era is the whole point, the day is noise. */
function when(at: number): string | undefined {
  if (!at) return undefined;
  return new Date(at * 1000).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * CryptoPunks, where the rank on the reel is the punk's own index.
 *
 * No re-roll: a punk that never sold is not a gap in the universe, it is one of
 * the answers, so all ten thousand are playable.
 */
export const punkSource: UniverseSource = {
  key: 'punks',
  ensureSnapshot,
  async snapshotMeta() {
    return store().get<SnapshotMeta>(K.meta);
  },
  async entryAtRank(index: number): Promise<Entry | null> {
    const row = await rowAt(index);
    if (!row) return null;

    const values: Truth = {
      lastSale: row.l,
      highSale: row.h,
      saleCount: row.n,
    };
    const notes: Record<string, string> = {};
    const lastWhen = when(row.la);
    const highWhen = when(row.ha);
    if (lastWhen) notes.lastSale = lastWhen;
    if (highWhen) notes.highSale = highWhen;

    return {
      id: `punk-${index}`,
      s: '',
      n: `CryptoPunk #${index}`,
      img: `${BASE}/api/punks/${index}/image`,
      values,
      notes,
    };
  },
};

export const PUNK_UNIVERSE_CONFIG = {
  PUNK_COUNT,
  MIN_SALE_ETH,
  SALE_CAP_ETH,
  PAGE,
  SNAPSHOT_TTL_MS,
};

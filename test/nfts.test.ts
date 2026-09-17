process.env.TG_REVEAL_MS = '0';
process.env.OPENSEA_API_KEY = 'test-key';

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../lib/redis.ts';
import { buildUniverse, nftSource, statsFor, NFT_UNIVERSE_CONFIG } from '../lib/nfts.ts';
import { createRoom, joinRoom, spin, startGame } from '../lib/room.ts';
import type { Collection } from '../lib/nfts.ts';

interface StubRow {
  collection: string;
  name: string;
  image_url?: string | null;
  category?: string | null;
  safelist_status?: string | null;
  is_nsfw?: boolean;
  is_disabled?: boolean;
}

const good = (slug: string, over: Partial<StubRow> = {}): StubRow => ({
  collection: slug,
  name: slug.toUpperCase(),
  image_url: `https://img/${slug}.png`,
  category: 'pfps',
  safelist_status: 'verified',
  ...over,
});

/** Healthy numbers — comfortably past the sales floor with a real floor price. */
const liveStats = { floor_price: 2.5, volume: 90_000, num_owners: 4_200, sales: 9_000 };
/** A collection with no real market behind it. */
const deadStats = { floor_price: 0, volume: 3, num_owners: 4, sales: 3 };

let calls: string[] = [];
let original: typeof globalThis.fetch;

/** Routes a stubbed OpenSea by URL. Nothing here ever touches the network. */
function stubFetch(handlers: {
  top?: (cursor: string | null) => { collections: StubRow[]; next?: string | null };
  stats?: (slug: string) => object | null;
}) {
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url.pathname);

    const body = (obj: unknown) =>
      ({
        ok: true,
        status: 200,
        headers: new Headers({ 'x-ratelimit-limit': '600', 'x-ratelimit-remaining': '599' }),
        json: async () => obj,
      }) as unknown as Response;

    if (url.pathname.endsWith('/collections/top')) {
      return body(handlers.top?.(url.searchParams.get('cursor')) ?? { collections: [] });
    }
    const m = url.pathname.match(/\/collections\/([^/]+)\/stats$/);
    if (m) {
      const total = handlers.stats?.(m[1]!);
      if (!total) return { ok: false, status: 404, headers: new Headers() } as Response;
      return body({ total });
    }
    throw new Error(`unstubbed ${url.pathname}`);
  }) as typeof fetch;
}

/** Seeds a ranked ladder so nothing has to be crawled. */
async function seedLadder(slugs: string[]): Promise<void> {
  const collections: Collection[] = slugs.map((slug) => ({
    slug,
    n: slug.toUpperCase(),
    s: 'PFPS',
    img: `https://img/${slug}.png`,
  }));
  const s = store();
  await s.set('snap:nfts:c:0', collections);
  await s.set('snap:nfts:meta', {
    builtAt: Date.now(),
    size: collections.length,
    chunks: 1,
    bytes: 1,
  });
}

beforeEach(() => {
  calls = [];
  original = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = original;
});

describe('the collection ladder', () => {
  test('keeps only what a party game can show, and holds rank order', async () => {
    stubFetch({
      top: () => ({
        collections: [
          good('punks'),
          good('nsfw-thing', { is_nsfw: true }),
          good('apes'),
          good('gone', { is_disabled: true }),
          good('rando', { safelist_status: 'not_requested' }),
          good('no-art', { image_url: null }),
          good('doodles', { safelist_status: 'approved' }),
          good('punks'), // a duplicate across pages must not take a second rank
        ],
        next: null,
      }),
    });

    const universe = await buildUniverse(1);
    assert.deepEqual(
      universe.map((c) => c.slug),
      ['punks', 'apes', 'doodles'],
      'nsfw, disabled, unverified, art-less and duplicate rows all drop out',
    );
    assert.equal(universe[0]!.s, 'PFPS', 'category stands in for a ticker');
  });

  test('stops when a page comes back short, without asking for another', async () => {
    stubFetch({ top: () => ({ collections: [good('a'), good('b')], next: 'more' }) });
    await buildUniverse(5);
    assert.equal(calls.length, 1, 'a short page is the end of the ladder');
  });
});

describe('fetching what a collection is worth', () => {
  test('a real collection maps onto the categories NFT mode scores', async () => {
    stubFetch({ stats: () => liveStats });
    const stats = await statsFor('alive-1');
    assert.deepEqual(stats, { floor: 2.5, atvol: 90_000, owners: 4_200, sales: 9_000 });
  });

  test('a collection with no real market behind it is refused', async () => {
    stubFetch({ stats: () => deadStats });
    assert.equal(await statsFor('dead-1'), null);
  });

  test('a floorless collection is refused even when it has traded', async () => {
    stubFetch({ stats: () => ({ ...liveStats, floor_price: 0 }) });
    assert.equal(await statsFor('floorless-1'), null);
  });

  test('sales exactly at the floor are enough', async () => {
    stubFetch({ stats: () => ({ ...liveStats, sales: NFT_UNIVERSE_CONFIG.SALES_FLOOR }) });
    assert.ok(await statsFor('edge-1'));
  });

  test('two rooms landing on the same collection pay for it once', async () => {
    stubFetch({ stats: () => liveStats });
    await statsFor('cached-1');
    const before = calls.length;
    await statsFor('cached-1');
    assert.equal(calls.length, before, 'the second lookup is served from the cache');
  });

  test('a refusal is never cached — a dead collection may come back', async () => {
    stubFetch({ stats: () => deadStats });
    await statsFor('dead-2');
    const before = calls.length;
    await statsFor('dead-2');
    assert.equal(calls.length, before + 1);
  });
});

describe('landing on a collection', () => {
  test('a rank past the end of the ladder is nothing at all', async () => {
    await seedLadder(['a1', 'a2']);
    stubFetch({ stats: () => liveStats });
    assert.equal(await nftSource.entryAtRank(99), null);
  });

  test('an entry carries the art and the numbers', async () => {
    await seedLadder(['b1', 'b2']);
    stubFetch({ stats: () => liveStats });
    const entry = await nftSource.entryAtRank(2);
    assert.equal(entry?.id, 'b2');
    assert.equal(entry?.img, 'https://img/b2.png');
    assert.deepEqual(entry?.values, {
      floor: 2.5,
      atvol: 90_000,
      owners: 4_200,
      sales: 9_000,
    });
  });
});

describe('a spin that lands on nothing', () => {
  test('walks past the dead collections and burns the ranks it spent', async () => {
    await seedLadder(['d1', 'd2', 'live-3', 'live-4', 'live-5']);
    stubFetch({ stats: (slug) => (slug.startsWith('live') ? liveStats : deadStats) });

    const { room, playerId: hostId } = await createRoom('Mat', {
      mode: 'nfts',
      categories: ['floor', 'owners'],
      roundsValue: 3,
    });
    await joinRoom(room.code, 'Ana');
    await startGame(room.code, hostId);

    const spun = await spin(room.code, hostId, 1);

    assert.equal(spun.round?.coin.id, 'live-3', 'it slid on to something guessable');
    assert.equal(spun.round?.rank, 3);
    assert.deepEqual(
      spun.usedRanks,
      [1, 2, 3],
      'the two dead ranks are spent, so the room never offers them again',
    );
    assert.deepEqual(spun.round?.cats, ['floor', 'owners']);
  });

  test('gives up rather than walking the whole ladder', async () => {
    await seedLadder(['x1', 'x2', 'x3', 'x4', 'x5', 'x6']);
    stubFetch({ stats: () => deadStats });

    const { room, playerId: hostId } = await createRoom('Mat', {
      mode: 'nfts',
      categories: ['floor'],
      roundsValue: 3,
    });
    await joinRoom(room.code, 'Ana');
    await startGame(room.code, hostId);

    await assert.rejects(() => spin(room.code, hostId, 1), /Could not find a collection/);
  });
});

describe('a game knows which universe it belongs to', () => {
  test('a category the chosen universe cannot fill never makes it into the config', async () => {
    await seedLadder(['e1', 'e2']);
    stubFetch({ stats: () => liveStats });

    const { room } = await createRoom('Mat', {
      mode: 'nfts',
      categories: ['price', 'mcap', 'floor'],
    });
    assert.deepEqual(room.config.categories, ['floor'], 'coin categories are dropped');
  });

  test('asking for nothing the universe has falls back to its defaults', async () => {
    await seedLadder(['f1', 'f2']);
    stubFetch({ stats: () => liveStats });

    const { room } = await createRoom('Mat', { mode: 'nfts', categories: ['ath'] });
    assert.deepEqual(room.config.categories, ['floor', 'owners']);
  });
});

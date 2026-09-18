import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../lib/redis.ts';
import { punkSource } from '../lib/punks.ts';
import {
  CATEGORY_BOUNDS,
  UNIVERSE_CATEGORIES,
  zeroMeans,
  type Category,
} from '../lib/types.ts';

/** One chunk of hand-written punks, so nothing here touches the network. */
async function seedPunks(): Promise<void> {
  const rows = [
    // #0: sold three times, most recently for 12 ETH
    { l: 12, la: 1_600_000_000, h: 40, ha: 1_500_000_000, n: 3 },
    // #1: never sold at a real price
    { l: 0, la: 0, h: 0, ha: 0, n: 0 },
    // #2: flipped hard
    { l: 55, la: 1_650_000_000, h: 900, ha: 1_620_000_000, n: 27 },
  ];
  const s = store();
  await s.set('snap:punks:c:0', rows);
  await s.set('snap:punks:meta', {
    builtAt: Date.now(),
    size: rows.length,
    chunks: 1,
    bytes: 1,
  });
}

describe('what a punk is guessed on', () => {
  beforeEach(seedPunks);

  test('is the last sale, the highest, and how many there have been', () => {
    assert.deepEqual(UNIVERSE_CATEGORIES.punks, [
      'lastSale',
      'highSale',
      'saleCount',
    ]);
  });

  test('a punk carries its sale count alongside its prices', async () => {
    const entry = await punkSource.entryAtRank(0);
    assert.deepEqual(entry?.values, { lastSale: 12, highSale: 40, saleCount: 3 });

    const flipped = await punkSource.entryAtRank(2);
    assert.equal(flipped?.values.saleCount, 27);
  });

  test('a punk that never sold has none, which is an answer not a gap', async () => {
    const entry = await punkSource.entryAtRank(1);
    assert.equal(entry?.values.saleCount, 0);
    assert.equal(zeroMeans('saleCount'), 'Never sold');
  });

  test('the count is counted, not priced', async () => {
    // The axis has to reach the most-flipped punk without wasting its travel
    // on numbers of sales nothing has ever had.
    const [lo, hi] = CATEGORY_BOUNDS.saleCount;
    assert.equal(lo, 1, 'one sale is the least a sold punk can have had');
    assert.ok(hi >= 100, 'and the top is an overbid, not a target');

    for (const cat of UNIVERSE_CATEGORIES.punks as Category[]) {
      assert.ok(CATEGORY_BOUNDS[cat][0] > 0, `${cat} needs a log axis to live on`);
    }
  });
});

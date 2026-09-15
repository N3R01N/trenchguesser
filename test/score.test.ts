import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  logError,
  ratioOff,
  revealTier,
  isFdvMerged,
  effectiveCategories,
  scoreRound,
  countCategoryWins,
} from '../lib/score.ts';
import type { Category, Guess } from '../lib/types.ts';

const truth = (over: Partial<Record<Category, number>> = {}) => ({
  price: 0.000637,
  mcap: 637_102,
  ath: 0.0412,
  fdv: 637_102,
  vol: 32_379,
  ...over,
});

const guessesOf = (m: Record<string, Partial<Record<Category, number>>>) =>
  Object.fromEntries(
    Object.entries(m).map(([id, values]) => [id, { at: 0, values } as Guess]),
  );

const sum = (d: Record<string, number>) =>
  Object.values(d).reduce((a, b) => a + b, 0);

describe('log error', () => {
  test('is symmetric in ratio, not in difference', () => {
    // 10x low and 10x high are equally wrong
    assert.equal(logError(10, 100).toFixed(10), logError(1000, 100).toFixed(10));
  });

  test('beats the lowball exploit that raw squared error rewards', () => {
    const actual = 637_102;
    const lowball = 50_000; // 12.7x low
    const overshoot = 2_000_000; // 3.1x high

    // raw squared error would crown the lowball
    const rawLow = (lowball - actual) ** 2;
    const rawHigh = (overshoot - actual) ** 2;
    assert.ok(rawLow < rawHigh, 'raw error picks the worse guess');

    // log error correctly crowns the closer guess
    assert.ok(logError(overshoot, actual) < logError(lowball, actual));
  });

  test('a zero or negative guess is terrible but does not crash', () => {
    assert.ok(Number.isFinite(logError(0, 1000)));
    assert.ok(Number.isFinite(logError(-5, 1000)));
    assert.ok(logError(0, 1000) > logError(1, 1000));
  });
});

describe('points', () => {
  const five = ['a', 'b', 'c', 'd', 'e'];

  test('one winner takes +4, everyone else -1', () => {
    const t = truth();
    const r = scoreRound(
      five,
      ['mcap'],
      t,
      guessesOf({
        a: { mcap: 640_000 }, // closest
        b: { mcap: 100_000 },
        c: { mcap: 10_000_000 },
        d: { mcap: 50 },
        e: { mcap: 900_000_000 },
      }),
    );
    assert.deepEqual(r.delta, { a: 4, b: -1, c: -1, d: -1, e: -1 });
    assert.equal(sum(r.delta), 0);
  });

  test('two winners take +3 each, everyone else -2', () => {
    const t = truth();
    // a and b are equally wrong in opposite directions -> exact tie
    const r = scoreRound(
      five,
      ['mcap'],
      t,
      guessesOf({
        a: { mcap: t.mcap * 2 },
        b: { mcap: t.mcap / 2 },
        c: { mcap: t.mcap * 100 },
        d: { mcap: t.mcap * 1000 },
        e: { mcap: t.mcap / 5000 },
      }),
    );
    assert.deepEqual(r.delta, { a: 3, b: 3, c: -2, d: -2, e: -2 });
    assert.equal(sum(r.delta), 0);
  });

  test('a missing guess is an automatic loss and can never win', () => {
    const r = scoreRound(
      ['a', 'b'],
      ['price'],
      truth(),
      guessesOf({ a: { price: 0.000637 } }), // b never submitted
    );
    assert.deepEqual(r.outcomes[0].winners, ['a']);
    assert.equal(r.outcomes[0].errors.b, null);
    assert.deepEqual(r.delta, { a: 1, b: -1 });
  });

  test('nobody guesses: category is void, nobody moves', () => {
    const r = scoreRound(['a', 'b', 'c'], ['price'], truth(), guessesOf({}));
    assert.deepEqual(r.outcomes[0].winners, []);
    assert.deepEqual(r.delta, { a: 0, b: 0, c: 0 });
    assert.equal(sum(r.delta), 0);
  });

  test('everybody ties: nobody moves', () => {
    const r = scoreRound(
      ['a', 'b', 'c'],
      ['price'],
      truth(),
      guessesOf({
        a: { price: 0.001 },
        b: { price: 0.001 },
        c: { price: 0.001 },
      }),
    );
    assert.equal(r.outcomes[0].winners.length, 3);
    assert.equal(sum(r.delta), 0);
    assert.deepEqual(r.delta, { a: 0, b: 0, c: 0 });
  });

  test('multi-category rounds still sum to zero', () => {
    const t = truth({ fdv: 9_000_000 });
    const r = scoreRound(
      ['a', 'b', 'c', 'd'],
      ['price', 'mcap', 'ath', 'fdv', 'vol'],
      t,
      guessesOf({
        a: { price: 0.0006, mcap: 600_000, ath: 0.04, fdv: 9e6, vol: 30_000 },
        b: { price: 0.01, mcap: 1_000_000, ath: 1, vol: 1_000 },
        c: { price: 0.00001, mcap: 5_000 },
        d: {},
      }),
    );
    assert.equal(sum(r.delta), 0);
    assert.equal(r.outcomes.length, 5);
  });

  test('category wins are counted for the badge', () => {
    const t = truth({ fdv: 9_000_000 });
    const r = scoreRound(
      ['a', 'b'],
      ['price', 'mcap'],
      t,
      guessesOf({
        a: { price: t.price, mcap: t.mcap },
        b: { price: 10, mcap: 10 },
      }),
    );
    assert.equal(countCategoryWins(r, 'a'), 2);
    assert.equal(countCategoryWins(r, 'b'), 0);
  });
});

describe('zero-sum invariant under fuzzing', () => {
  test('1000 random rounds all sum to zero', () => {
    let rng = 1234567;
    const rand = () => ((rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648);

    const allCats: Category[] = ['price', 'mcap', 'ath', 'fdv', 'vol'];

    for (let i = 0; i < 1000; i++) {
      const n = 2 + Math.floor(rand() * 7);
      const players = Array.from({ length: n }, (_, k) => `p${k}`);
      const cats = allCats.filter(() => rand() > 0.4);
      if (cats.length === 0) cats.push('price');

      const t = truth({
        price: 10 ** (rand() * 8 - 6),
        mcap: 10 ** (4 + rand() * 8),
        vol: 10 ** (4 + rand() * 6),
      });

      const g: Record<string, Partial<Record<Category, number>>> = {};
      for (const p of players) {
        if (rand() < 0.15) continue; // AFK
        const values: Partial<Record<Category, number>> = {};
        for (const c of cats) {
          if (rand() < 0.1) continue; // skipped one slider
          const noise = rand() < 0.2 ? 0 : 10 ** (rand() * 6 - 3);
          values[c] = t[c] * noise;
        }
        g[p] = values;
      }

      const r = scoreRound(players, cats, t, guessesOf(g));
      assert.equal(sum(r.delta), 0, `round ${i} did not sum to zero`);
    }
  });
});

describe('fdv merge rule', () => {
  test('identical fdv and mcap merge', () => {
    assert.equal(isFdvMerged(truth({ mcap: 637_102, fdv: 637_102 })), true);
  });

  test('fdv 5% above mcap still merges', () => {
    assert.equal(isFdvMerged(truth({ mcap: 1_000_000, fdv: 1_050_000 })), true);
  });

  test('fdv 10x mcap does not merge', () => {
    assert.equal(isFdvMerged(truth({ mcap: 1_000_000, fdv: 10_000_000 })), false);
  });

  test('effective categories drop fdv only when both are configured', () => {
    const dup = truth({ mcap: 500_000, fdv: 500_000 });
    assert.deepEqual(effectiveCategories(['mcap', 'fdv'], dup), {
      cats: ['mcap'],
      mergedFdv: true,
    });
    // fdv alone is a real category even when it equals mcap
    assert.deepEqual(effectiveCategories(['fdv'], dup), {
      cats: ['fdv'],
      mergedFdv: false,
    });
    const distinct = truth({ mcap: 500_000, fdv: 9_000_000 });
    assert.deepEqual(effectiveCategories(['mcap', 'fdv'], distinct), {
      cats: ['mcap', 'fdv'],
      mergedFdv: false,
    });
  });
});

describe('reveal tiers', () => {
  test('tier boundaries', () => {
    assert.equal(revealTier(100, 100), 'bullseye');
    assert.equal(revealTier(119, 100), 'bullseye');
    assert.equal(revealTier(250, 100), 'close');
    assert.equal(revealTier(900, 100), 'off');
    assert.equal(revealTier(50_000, 100), 'way-off');
    assert.equal(revealTier(null, 100), 'way-off');
  });

  test('ratio is direction-agnostic', () => {
    assert.equal(ratioOff(1000, 100), 10);
    assert.equal(ratioOff(10, 100), 10);
  });
});

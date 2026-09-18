import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPS,
  fullAxis,
  isZoomed,
  quantize,
  refine,
  stepFor,
  ticksFor,
  valueAt,
  widen,
  type Axis,
} from '../lib/axis.ts';
import { CATEGORY_BOUNDS } from '../lib/types.ts';

/** Puts the thumb on a value, the way dragging to it would. */
function aimedAt(value: number, axis: Axis): Axis {
  return { ...axis, step: stepFor(value, axis.lo, axis.hi) };
}

/** Drags to a value and lets go, as many times as stated. */
function drag(value: number, cat: 'lastSale' | 'price' | 'saleCount', passes = 1): Axis {
  let axis = fullAxis(cat);
  for (let i = 0; i < passes; i++) axis = refine(aimedAt(value, axis), cat);
  return axis;
}

describe('naming a number on a log axis', () => {
  test('two significant figures, because that is what the readout says', () => {
    assert.equal(quantize(41.7, 'lastSale'), 42);
    assert.equal(quantize(4.163, 'lastSale'), 4.2);
    assert.equal(quantize(0.0104, 'lastSale'), 0.01);
    assert.equal(quantize(3_140_000, 'mcap'), 3_100_000);
    assert.equal(quantize(1.37e-7, 'price'), 1.4e-7);
  });

  test('a count is a whole number of things', () => {
    assert.equal(quantize(7.43, 'saleCount'), 7);
    assert.equal(quantize(26.5, 'saleCount'), 27);
    assert.equal(quantize(0.2, 'saleCount'), 1, 'one sale is the fewest there can be');
  });

  test('a value never leaves the category it belongs to', () => {
    const [lo, hi] = CATEGORY_BOUNDS.lastSale;
    assert.equal(quantize(1e9, 'lastSale'), hi);
    assert.equal(quantize(0, 'lastSale'), lo);
    assert.equal(quantize(Number.NaN, 'lastSale'), lo);
  });

  test('42 is barely a target on the full punk axis', () => {
    // The complaint, stated as a test. Two of a thousand steps mean 42, which
    // over a phone's track is about a pixel — there is nothing to aim at.
    assert.ok(share(42, fullAxis('lastSale'), 'lastSale') < 0.005);
  });
});

/** How much of the track means exactly this value. */
function share(value: number, axis: Axis, cat: 'lastSale' | 'price' | 'saleCount') {
  let hits = 0;
  for (let step = 0; step <= STEPS; step++) {
    if (valueAt({ ...axis, step }, cat) === value) hits += 1;
  }
  return hits / STEPS;
}

describe('letting go of the thumb', () => {
  test('closes the axis in around the number under it', () => {
    const once = drag(42, 'lastSale');
    assert.ok(once.lo < 42 && once.hi > 42, 'the value stays on the axis');
    assert.ok(once.hi / once.lo < 5_000 / 0.01, 'and the axis is narrower than it was');
    assert.equal(valueAt(once, 'lastSale'), 42, 'and still under the thumb');
  });

  test('a second pass is where 42 stops being a fight', () => {
    const before = share(42, fullAxis('lastSale'), 'lastSale');
    const after = share(42, drag(42, 'lastSale', 2), 'lastSale');

    // Roughly 2% of the track against 0.2%: six or seven pixels on a phone,
    // where it was one. That is the whole point of the second pass.
    assert.ok(after > 0.015, `42 is only ${(after * 100).toFixed(1)}% of the track`);
    assert.ok(after / before > 5, 'and a real improvement on the full axis');
  });

  test('stops narrowing rather than aiming at precision nothing scores', () => {
    const deep = drag(42, 'lastSale', 6);
    const span = Math.log10(deep.hi) - Math.log10(deep.lo);
    assert.ok(span > 0.5, `the axis collapsed to ${span.toFixed(2)} decades`);
    assert.deepEqual(refine(deep, 'lastSale'), deep, 'and a further release is a no-op');
  });

  test('never runs past the ends of the category', () => {
    const [lo, hi] = CATEGORY_BOUNDS.lastSale;
    for (const target of [0.01, 5_000, 0.013, 4_800]) {
      const axis = drag(target, 'lastSale', 3);
      assert.ok(axis.lo >= lo, `${target} pushed the axis below ${lo}`);
      assert.ok(axis.hi <= hi, `${target} pushed the axis past ${hi}`);
      assert.ok(axis.hi > axis.lo, `${target} collapsed the axis`);
    }
  });

  test('the widest axis in the game takes the same two passes', () => {
    // Coin price spans thirteen decades, and a target down at the bottom.
    const axis = drag(4.2e-6, 'price', 2);
    assert.equal(valueAt(axis, 'price'), 4.2e-6);
    assert.ok(Math.log10(axis.hi) - Math.log10(axis.lo) < 2);
  });

  test('a short axis is left alone, because it was never the problem', () => {
    const axis = drag(27, 'saleCount', 3);
    assert.equal(valueAt(axis, 'saleCount'), 27);
    assert.ok(isZoomed(axis, 'saleCount'), 'it still tightens what little it can');
  });
});

describe('getting back out', () => {
  test('the whole range returns, still pointing at your number', () => {
    const zoomed = drag(42, 'lastSale', 2);
    assert.ok(isZoomed(zoomed, 'lastSale'));

    const back = widen(zoomed, 'lastSale');
    assert.deepEqual(
      [back.lo, back.hi],
      CATEGORY_BOUNDS.lastSale,
      'the axis is the category again',
    );
    assert.equal(valueAt(back, 'lastSale'), 42, 'and 4,000 is one drag away again');
    assert.equal(isZoomed(back, 'lastSale'), false);
  });
});

describe('the labels under the track', () => {
  test('a wide axis ticks on the K/M/B boundaries', () => {
    const ticks = ticksFor(fullAxis('mcap'), 'mcap');
    assert.ok(ticks.length >= 2);
    assert.deepEqual(
      ticks.map((t) => t.text),
      ['$1M', '$1B', '$1T'],
      'the first whole boundary above $10K is a million',
    );
  });

  test('an axis inside one decade names its own ends instead', () => {
    const ticks = ticksFor(drag(42, 'lastSale', 3), 'lastSale');
    assert.equal(ticks.length, 2);
    assert.deepEqual(
      ticks.map((t) => t.at),
      [0, 100],
    );
    assert.ok(ticks[0]!.text.includes('ETH'), 'and says what it is counting');
  });

  test('every label lands inside the track', () => {
    for (const cat of ['lastSale', 'price', 'saleCount'] as const) {
      for (const axis of [fullAxis(cat), drag(42, cat, 1), drag(42, cat, 2)]) {
        for (const tick of ticksFor(axis, cat)) {
          assert.ok(
            tick.at >= -0.01 && tick.at <= 100.01,
            `${cat} put a label at ${tick.at}%`,
          );
        }
      }
    }
  });
});

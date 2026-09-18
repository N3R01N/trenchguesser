import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { amount, compact, decadeLabel, offBy, ordinal } from '../lib/format.ts';

describe('amounts carry their unit', () => {
  test('dollars keep the mark they always had', () => {
    assert.equal(amount(1_527_651, 'usd'), '$1.53M');
    assert.equal(amount(0.000637, 'usd'), '$0.000637');
  });

  test('ETH is written as ETH, not as dollars', () => {
    assert.equal(amount(2.5, 'eth'), '2.5 ETH');
    assert.equal(amount(12.345, 'eth'), '12.3 ETH');
  });

  test('a small floor does not trail a run of zeros', () => {
    // compact() would render this "0.00100", which reads as a rounding artefact
    assert.equal(amount(0.001, 'eth'), '0.001 ETH');
    assert.equal(amount(0.0012345, 'eth'), '0.00123 ETH');
  });

  test('large ETH volumes abbreviate', () => {
    assert.equal(amount(90_000, 'eth'), '90.00K ETH');
  });

  test('counts are not money', () => {
    assert.equal(amount(4_200, 'count'), '4,200');
    assert.equal(amount(42, 'count'), '42');
  });

  test('counts abbreviate once they stop being readable', () => {
    assert.equal(amount(1_250_000, 'count'), '1.25M');
  });

  test('nothing renders a dollar sign it has not earned', () => {
    for (const unit of ['eth', 'count'] as const) {
      assert.ok(!amount(1234, unit).includes('$'), `${unit} must not read as dollars`);
    }
  });

  test('a missing or impossible value degrades rather than throwing', () => {
    assert.equal(amount(0, 'usd'), '$0');
    assert.equal(amount(0, 'eth'), '0');
    assert.equal(amount(Number.NaN, 'count'), '0');
  });
});

describe('axis labels', () => {
  test('dollars carry their mark', () => {
    assert.equal(decadeLabel(6), '$1M');
    assert.equal(decadeLabel(-3), '$0.001');
  });

  test('other units do not, because the readout above already says', () => {
    assert.equal(decadeLabel(6, 'eth'), '1M');
    assert.equal(decadeLabel(3, 'count'), '1K');
    assert.equal(decadeLabel(-3, 'eth'), '0.001');
  });

  test('dollars stay the default, so coin mode is untouched', () => {
    assert.equal(decadeLabel(9), decadeLabel(9, 'usd'));
  });

  test('a short axis ticks between the K/M/B boundaries, and reads as a number', () => {
    // A two-decade axis — a punk's sale count — would carry one label if it
    // could only tick on the boundaries, and "1e2" reads as a bug.
    assert.equal(decadeLabel(2, 'count'), '100');
    assert.equal(decadeLabel(4, 'count'), '10K');
    assert.equal(decadeLabel(5, 'usd'), '$100K');
  });

  test('past the biggest suffix it keeps counting in trillions', () => {
    assert.equal(decadeLabel(13, 'usd'), '$10T');
    assert.equal(decadeLabel(-6, 'usd'), '1e-6');
  });
});

describe('unchanged helpers', () => {
  test('compact still does what the coin screens expect', () => {
    assert.equal(compact(1_527_651), '1.53M');
  });

  test('off-by is a ratio, so it never needed a unit', () => {
    assert.equal(offBy(100, 100), 'spot on');
    assert.equal(offBy(1000, 100), '10x too high');
    assert.equal(offBy(null, 100), 'no guess');
  });

  test('ordinals', () => {
    assert.equal(ordinal(1), '1st');
    assert.equal(ordinal(12), '12th');
    assert.equal(ordinal(23), '23rd');
  });
});

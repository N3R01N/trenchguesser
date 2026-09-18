import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADVANCE_RETRY_MS,
  FINAL_STANDINGS_HOLD_MS,
  advancePlan,
  createAdvanceDriver,
  type AdvanceDriver,
} from '../lib/autoAdvance.ts';
import type { PublicState } from '../lib/room.ts';
import { DEFAULT_CONFIG, type Player } from '../lib/types.ts';

const HOST = 'p-host';
const ANA = 'p-ana';

function player(id: string, present = true): Player {
  return { id, name: id, score: 0, present, catWins: 0, streak: 0 };
}

/** A room sitting on the reveal, exactly as a phone would see it. */
function revealState(over: Partial<PublicState> = {}): PublicState {
  return {
    code: 'ABCD',
    v: 7,
    serverTime: Date.now(),
    phase: 'reveal',
    phaseEndsAt: Date.now(),
    hostId: HOST,
    activePlayerId: HOST,
    config: DEFAULT_CONFIG,
    totalRounds: 4,
    roundNo: 1,
    players: [player(HOST), player(ANA)],
    round: null,
    submitted: [HOST, ANA],
    ...over,
  };
}

/** The component's own beat, which is what keeps the driver looking. */
const TICK_MS = 250;

describe('deciding to end a phase', () => {
  test('the reveal ends itself once the clock is out, and not before', () => {
    const state = revealState();
    assert.equal(advancePlan(state, HOST, 1_200), null, 'still revealing');
    assert.ok(advancePlan(state, HOST, 0), 'the clock has run out');
  });

  test('the active player goes first, but not instantly', () => {
    const state = revealState();
    const active = advancePlan(state, HOST, 0)!;
    const other = advancePlan(state, ANA, 0)!;

    assert.ok(active.delay > 0, 'never racing its own countdown to the server');
    assert.ok(
      active.delay < other.delay,
      'and still ahead of everyone else, so the table makes one request',
    );
  });

  test('the closing standings holds long enough to read', () => {
    const state = revealState({ phase: 'standings', roundNo: 4, totalRounds: 4 });
    assert.ok(advancePlan(state, HOST, null)!.delay >= FINAL_STANDINGS_HOLD_MS);
  });

  test('a phase nobody has to end is left alone', () => {
    const state = revealState({ phase: 'standings', roundNo: 1 });
    assert.equal(advancePlan(state, HOST, null), null);
  });

  test('the key follows the room version, not the phase alone', () => {
    const state = revealState();
    assert.notEqual(
      advancePlan(state, HOST, 0)!.key,
      advancePlan(revealState({ v: 8 }), HOST, 0)!.key,
    );
  });
});

describe('a rejected attempt', () => {
  let sent: number;
  let outcome: () => Promise<unknown>;
  let driver: AdvanceDriver;

  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    sent = 0;
    outcome = () => Promise.reject(new Error('Reveal still running'));
    driver = createAdvanceDriver({
      send: () => {
        sent += 1;
        return outcome();
      },
      refresh: () => {},
    });
  });

  afterEach(() => {
    driver.stop();
    mock.timers.reset();
  });

  /** Runs the component's tick loop over a stretch of (fake) time. */
  async function run(state: PublicState, ms: number): Promise<void> {
    for (let t = 0; t < ms; t += TICK_MS) {
      driver.tick(advancePlan(state, HOST, 0));
      mock.timers.tick(TICK_MS);
      // let whatever the tick set going settle before the next one
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    }
  }

  test('is tried again, though the room version never moved', async () => {
    const state = revealState();

    await run(state, 1_000);
    assert.equal(sent, 1, 'the first attempt goes out on the deadline');

    await run(state, ADVANCE_RETRY_MS - 1_000);
    assert.equal(sent, 1, 'and is not hammered in the meantime');

    await run(state, 2_000);
    assert.equal(
      sent,
      2,
      'a 409 must not disable the only thing that can end the reveal',
    );
  });

  test('keeps being tried for as long as the room is stuck there', async () => {
    const state = revealState();
    await run(state, 4 * ADVANCE_RETRY_MS);
    assert.ok(sent >= 3, `gave up after ${sent} attempts`);
  });
});

describe('an accepted attempt', () => {
  test('settles the transition rather than being repeated', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    let sent = 0;
    const driver = createAdvanceDriver({
      send: () => {
        sent += 1;
        return Promise.resolve({ ok: true });
      },
      refresh: () => {},
    });

    // The room version only moves once the next poll comes back, so the plan
    // the driver sees is unchanged for a while after the server has agreed.
    const state = revealState();
    for (let t = 0; t < 3 * ADVANCE_RETRY_MS; t += TICK_MS) {
      driver.tick(advancePlan(state, HOST, 0));
      mock.timers.tick(TICK_MS);
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    }

    assert.equal(sent, 1, 'one transition, one request');
    driver.stop();
    mock.timers.reset();
  });
});

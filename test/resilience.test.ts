process.env.TG_REVEAL_MS = '0';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../lib/redis.ts';
import {
  advance,
  createRoom,
  heartbeat,
  joinRoom,
  publicState,
  spin,
  startGame,
  submitGuess,
} from '../lib/room.ts';
import { ensureSnapshot } from '../lib/coins.ts';
import type { Category, Coin } from '../lib/types.ts';

const PER_PAGE = 250;

async function seedUniverse(size = 2500): Promise<void> {
  const coins: Coin[] = Array.from({ length: size }, (_, i) => {
    const mcap = 1e10 / (i + 1);
    return {
      id: `coin-${i + 1}`,
      s: `C${i + 1}`,
      n: `Coin ${i + 1}`,
      img: '',
      price: mcap / 1e9,
      mcap,
      ath: (mcap / 1e9) * 4,
      fdv: i % 3 === 0 ? mcap * 8 : mcap,
      vol: mcap / 20,
    };
  });
  const s = store();
  for (let i = 0; i < Math.ceil(size / PER_PAGE); i++) {
    await s.set(`snap:coins:c:${i}`, coins.slice(i * PER_PAGE, (i + 1) * PER_PAGE));
  }
  await s.set('snap:coins:meta', {
    builtAt: Date.now(),
    size,
    chunks: Math.ceil(size / PER_PAGE),
    bytes: 1,
  });
}

/** Ages a player's heartbeat so they read as gone. */
async function goQuiet(code: string, playerId: string): Promise<void> {
  const s = store();
  const key = `room:${code}:seen`;
  const seen = await s.hgetall<number>(key);
  await s.hset(key, playerId, Date.now() - 60_000);
  void seen;
}

/** Pretends the current spin turn started long enough ago to be rescued. */
async function ageSpinTurn(code: string): Promise<void> {
  const s = store();
  const key = `room:${code}`;
  const room = await s.get<Record<string, unknown>>(key);
  await s.set(key, { ...room, spinningSince: Date.now() - 60_000 });
}

describe('presence', () => {
  beforeEach(async () => {
    await seedUniverse();
  });

  test('a player is present from the moment they join', async () => {
    const { room, playerId: hostId } = await createRoom('Mat');
    const { playerId: anaId } = await joinRoom(room.code, 'Ana');

    const s = await publicState(room.code);
    assert.equal(s.players.find((p) => p.id === hostId)?.present, true);
    assert.equal(s.players.find((p) => p.id === anaId)?.present, true);
  });

  test('a silent player fades out, and a heartbeat brings them back', async () => {
    const { room, playerId: hostId } = await createRoom('Mat');
    const { playerId: anaId } = await joinRoom(room.code, 'Ana');

    await goQuiet(room.code, anaId);
    let s = await publicState(room.code);
    assert.equal(s.players.find((p) => p.id === anaId)?.present, false);
    assert.equal(s.players.find((p) => p.id === hostId)?.present, true);

    await heartbeat(room.code, anaId);
    s = await publicState(room.code);
    assert.equal(s.players.find((p) => p.id === anaId)?.present, true);
  });
});

describe('host migration', () => {
  beforeEach(async () => {
    await seedUniverse();
  });

  test('a vanished host hands the lobby to someone still here', async () => {
    const { room, playerId: hostId } = await createRoom('Mat');
    const { playerId: anaId } = await joinRoom(room.code, 'Ana');

    await goQuiet(room.code, hostId);
    await heartbeat(room.code, anaId);

    const s = await publicState(room.code);
    assert.equal(s.hostId, anaId, 'Ana inherits the lobby');

    // and can actually start the game
    await joinRoom(room.code, 'Bo');
    const started = await startGame(room.code, anaId);
    assert.equal(started.phase, 'spinning');
  });

  test('the host is left alone while they are still around', async () => {
    const { room, playerId: hostId } = await createRoom('Mat');
    const { playerId: anaId } = await joinRoom(room.code, 'Ana');

    await heartbeat(room.code, anaId);
    const s = await publicState(room.code);
    assert.equal(s.hostId, hostId);
  });
});

describe('a player who walks away', () => {
  beforeEach(async () => {
    await seedUniverse();
  });

  test('cannot stall the game on their turn', async () => {
    const { room, playerId: hostId } = await createRoom('Mat', { roundsValue: 4 });
    const { playerId: anaId } = await joinRoom(room.code, 'Ana');
    await startGame(room.code, hostId);

    // It is Mat's turn and Mat has gone.
    await goQuiet(room.code, hostId);

    await assert.rejects(
      () => advance(room.code, anaId),
      /Giving them a moment/,
      'the game waits a beat before spinning for someone',
    );

    await ageSpinTurn(room.code);
    const rescued = await advance(room.code, anaId);

    assert.equal(rescued.phase, 'guessing');
    assert.equal(rescued.round?.spunBy, hostId, 'the turn still belongs to Mat');
    assert.ok(rescued.round?.rank, 'a coin was drawn anyway');
  });

  test('is not rescued while they are still present', async () => {
    const { room, playerId: hostId } = await createRoom('Mat', { roundsValue: 4 });
    const { playerId: anaId } = await joinRoom(room.code, 'Ana');
    await startGame(room.code, hostId);
    await ageSpinTurn(room.code);

    await assert.rejects(
      () => advance(room.code, anaId),
      /Waiting for the spinner/,
      'nobody may spin for a player who is right there',
    );
  });

  test('loses every category they were absent for, and the round still balances', async () => {
    const { room, playerId: hostId } = await createRoom('Mat', {
      categories: ['price', 'mcap'],
      roundsValue: 4,
    });
    const { playerId: anaId } = await joinRoom(room.code, 'Ana');
    const { playerId: boId } = await joinRoom(room.code, 'Bo');

    await startGame(room.code, hostId);
    await spin(room.code, hostId, 800);

    const values: Partial<Record<Category, number>> = { price: 1, mcap: 1e6 };
    await submitGuess(room.code, hostId, values);
    await submitGuess(room.code, anaId, { price: 2, mcap: 2e6 });
    // Bo has wandered off entirely
    await goQuiet(room.code, boId);

    // Everyone still here has answered, so the round can close early.
    const scored = await advance(room.code, hostId);
    const result = scored.round!.result!;

    assert.equal(result.delta[boId], -2, 'Bo drops a point per category');
    assert.equal(
      Object.values(result.delta).reduce((a, b) => a + b, 0),
      0,
      'and the round is still zero-sum',
    );
  });
});

describe('snapshot building under contention', () => {
  test('only one builder runs; the others take the existing snapshot', async () => {
    await seedUniverse(600);

    // Force everyone to consider the snapshot stale at the same moment.
    const s = store();
    const meta = await s.get<Record<string, unknown>>('snap:coins:meta');
    await s.set('snap:coins:meta', { ...meta, builtAt: Date.now() - 10 * 3600_000 });

    let builds = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      builds += 1;
      throw new Error('network should not be reached by the losers of the lock');
    }) as typeof fetch;

    try {
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => ensureSnapshot()),
      );
      const served = results.filter((r) => r.status === 'fulfilled');
      assert.ok(served.length >= 4, 'the losers are served the stale snapshot');
      assert.ok(builds <= 1, `only one builder should hit the network, saw ${builds}`);
    } finally {
      globalThis.fetch = original;
    }
  });
});

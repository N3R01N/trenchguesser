process.env.TG_REVEAL_MS = '0';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../lib/redis.ts';
import {
  advance,
  createRoom,
  joinRoom,
  publicState,
  resolveRank,
  spin,
  startGame,
  submitGuess,
  RoomError,
} from '../lib/room.ts';
import type { Category, Coin } from '../lib/types.ts';

const PER_PAGE = 250;

/** Seeds a fake snapshot so nothing in these tests touches the network. */
async function seedUniverse(size = 2500): Promise<Coin[]> {
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
      // every third coin has a distinct FDV; the rest duplicate mcap
      fdv: i % 3 === 0 ? mcap * 8 : mcap,
      vol: mcap / 20,
    };
  });

  const s = store();
  const chunks = Math.ceil(size / PER_PAGE);
  for (let i = 0; i < chunks; i++) {
    await s.set(`snap:c:${i}`, coins.slice(i * PER_PAGE, (i + 1) * PER_PAGE));
  }
  await s.set('snap:meta', {
    builtAt: Date.now(),
    size,
    chunks,
    bytes: 1,
  });
  return coins;
}

/** Fast-forwards past the guessing deadline without waiting out a real timer. */
async function expirePhase(code: string): Promise<void> {
  const s = store();
  const key = `room:${code}`;
  const raw = await s.get<Record<string, unknown>>(key);
  await s.set(key, { ...raw, phaseEndsAt: Date.now() - 1 });
}

const totalScore = (players: { score: number }[]) =>
  players.reduce((a, p) => a + p.score, 0);

describe('room lifecycle', () => {
  beforeEach(async () => {
    await seedUniverse();
  });

  test('host creates, players join, host starts', async () => {
    const { room, playerId: hostId } = await createRoom('Mat', {
      categories: ['price', 'mcap'],
      roundsMode: 'flat',
      roundsValue: 4,
      range: 'degen',
    });

    await joinRoom(room.code, 'Ana');
    await joinRoom(room.code, 'Bo');

    const started = await startGame(room.code, hostId);
    assert.equal(started.phase, 'spinning');
    assert.equal(started.players.length, 3);
    assert.equal(started.totalRounds, 4);
    assert.equal(started.turnIdx, 0);
    assert.equal(started.players[0].id, hostId, 'host takes the first turn');
  });

  test('rounds-per-player multiplies by the locked player count', async () => {
    const { room, playerId: hostId } = await createRoom('Mat', {
      roundsMode: 'perPlayer',
      roundsValue: 3,
    });
    await joinRoom(room.code, 'Ana');
    await joinRoom(room.code, 'Bo');
    await joinRoom(room.code, 'Cy');
    const started = await startGame(room.code, hostId);
    assert.equal(started.totalRounds, 12);
  });

  test('a game cannot start with one player', async () => {
    const { room, playerId } = await createRoom('Solo');
    await assert.rejects(() => startGame(room.code, playerId), RoomError);
  });

  test('joining after start is refused', async () => {
    const { room, playerId: hostId } = await createRoom('Mat');
    await joinRoom(room.code, 'Ana');
    await startGame(room.code, hostId);
    await assert.rejects(() => joinRoom(room.code, 'Late'), /already started/);
  });

  test('only the active player may spin', async () => {
    const { room, playerId: hostId } = await createRoom('Mat');
    const { playerId: anaId } = await joinRoom(room.code, 'Ana');
    await startGame(room.code, hostId);
    await assert.rejects(() => spin(room.code, anaId, 500), /Not your turn/);
    const spun = await spin(room.code, hostId, 500);
    assert.equal(spun.phase, 'guessing');
    assert.equal(spun.round?.rank, 500);
  });
});

describe('secrecy', () => {
  beforeEach(async () => {
    await seedUniverse();
  });

  test('truth is withheld until the reveal, and so are rival guesses', async () => {
    const { room, playerId: hostId } = await createRoom('Mat', {
      categories: ['price', 'mcap'],
      roundsValue: 2,
    });
    const { playerId: anaId } = await joinRoom(room.code, 'Ana');
    await startGame(room.code, hostId);
    await spin(room.code, hostId, 1200);

    await submitGuess(room.code, hostId, { price: 1, mcap: 1e6 });
    await submitGuess(room.code, anaId, { price: 2, mcap: 2e6 });

    const during = await publicState(room.code);
    assert.equal(during.round?.truth, null, 'no truth before reveal');
    assert.equal(during.round?.result, null);
    assert.equal(during.round?.guesses, null, 'no guesses leak before reveal');
    assert.equal(during.submitted.length, 2, 'but everyone knows who locked in');

    await advance(room.code, hostId); // guessing -> reveal

    const after = await publicState(room.code);
    assert.ok(after.round?.truth, 'truth appears at reveal');
    assert.ok(after.round?.result);
    assert.equal(Object.keys(after.round?.guesses ?? {}).length, 2);
  });

  test('late guesses are refused past the grace window', async () => {
    const { room, playerId: hostId } = await createRoom('Mat', { baseRoundMs: 1 });
    const { playerId: anaId } = await joinRoom(room.code, 'Ana');
    await startGame(room.code, hostId);
    await spin(room.code, hostId, 300);

    // baseRoundMs 1 + 5000 for the second category + 1500 grace
    await new Promise((r) => setTimeout(r, 10));
    await submitGuess(room.code, anaId, { price: 1 }); // still inside the window

    const s = store();
    const key = `room:${room.code}`;
    const raw = await s.get<{ phaseEndsAt: number }>(key);
    await s.set(key, { ...raw, phaseEndsAt: Date.now() - 5_000 });

    await assert.rejects(
      () => submitGuess(room.code, anaId, { price: 2 }),
      /Too late/,
    );
  });
});

describe('a full game', () => {
  beforeEach(async () => {
    await seedUniverse();
  });

  test('plays to the final board and stays zero-sum throughout', async () => {
    const { room, playerId: hostId } = await createRoom('Mat', {
      categories: ['price', 'mcap', 'fdv'],
      roundsMode: 'flat',
      roundsValue: 6,
      range: 'degen',
      baseRoundMs: 10_000,
    });
    const { playerId: anaId } = await joinRoom(room.code, 'Ana');
    const { playerId: boId } = await joinRoom(room.code, 'Bo');
    const ids = [hostId, anaId, boId];

    await startGame(room.code, hostId);

    const seenRanks: number[] = [];
    let rng = 42;
    const rand = () => ((rng = (rng * 48271) % 2147483647) / 2147483647);

    for (let r = 1; r <= 6; r++) {
      const before = await publicState(room.code);
      assert.equal(before.phase, 'spinning');
      const spinner = before.activePlayerId as string;
      assert.equal(spinner, ids[(r - 1) % 3], 'round robin order');

      // always request the same rank to prove duplicates get re-rolled
      const spun = await spin(room.code, spinner, 700);
      seenRanks.push(spun.round!.rank);

      const cats = spun.round!.cats as Category[];
      const truth = spun.round!.truth;

      for (const id of ids) {
        if (rand() < 0.15) continue; // someone goes AFK
        const values: Partial<Record<Category, number>> = {};
        for (const c of cats) values[c] = truth[c]! * 10 ** (rand() * 4 - 2);
        await submitGuess(room.code, id, values);
      }

      // an AFK player means the round can only end on the clock
      await expirePhase(room.code);
      await advance(room.code, hostId); // -> reveal
      const revealed = await publicState(room.code);
      assert.equal(revealed.phase, 'reveal');
      assert.ok(revealed.round?.result);
      assert.equal(
        Object.values(revealed.round!.result!.delta).reduce((a, b) => a + b, 0),
        0,
        `round ${r} delta must sum to zero`,
      );

      await advance(room.code, hostId); // -> standings
      const standings = await publicState(room.code);
      assert.equal(standings.phase, 'standings');
      assert.equal(
        totalScore(standings.players),
        0,
        `running scores must sum to zero after round ${r}`,
      );

      const nextUp = ids[r % 3];
      await advance(room.code, nextUp); // -> spinning, or final on the last round
    }

    const final = await publicState(room.code);
    assert.equal(final.phase, 'final');
    assert.equal(totalScore(final.players), 0);
    assert.equal(new Set(seenRanks).size, 6, 'every round used a distinct coin');
  });

  test('the wrong player cannot start the next round', async () => {
    const { room, playerId: hostId } = await createRoom('Mat', { roundsValue: 4 });
    const { playerId: anaId } = await joinRoom(room.code, 'Ana');
    const { playerId: boId } = await joinRoom(room.code, 'Bo');
    await startGame(room.code, hostId);
    await spin(room.code, hostId, 900);
    await submitGuess(room.code, hostId, { price: 1, mcap: 1 });
    await submitGuess(room.code, anaId, { price: 2, mcap: 2 });
    await submitGuess(room.code, boId, { price: 3, mcap: 3 });
    await advance(room.code, hostId);
    await advance(room.code, hostId);

    // Ana is next in the rotation; Bo is not, and is not the host
    await assert.rejects(() => advance(room.code, boId), /Only the next player/);
    const ok = await advance(room.code, anaId);
    assert.equal(ok.phase, 'spinning');
  });
});

describe('rank resolution', () => {
  test('an unused rank is taken as-is', () => {
    assert.equal(resolveRank(700, 100, 2500, []), 700);
  });

  test('a duplicate slides to the nearest free rank', () => {
    assert.equal(resolveRank(700, 100, 2500, [700]), 699);
    assert.equal(resolveRank(700, 100, 2500, [700, 699]), 701);
    assert.equal(resolveRank(700, 100, 2500, [700, 699, 701]), 698);
  });

  test('requests outside the range are clamped', () => {
    assert.equal(resolveRank(5, 100, 500, []), 100);
    assert.equal(resolveRank(9999, 100, 500, []), 500);
  });

  test('an exhausted range still returns something rather than hanging', () => {
    const used = Array.from({ length: 5 }, (_, i) => 100 + i);
    assert.equal(resolveRank(102, 100, 104, used), 102);
  });
});

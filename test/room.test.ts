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
    await s.set(`snap:coins:c:${i}`, coins.slice(i * PER_PAGE, (i + 1) * PER_PAGE));
  }
  await s.set('snap:coins:meta', {
    builtAt: Date.now(),
    size,
    chunks,
    bytes: 1,
  });
  return coins;
}

/** Ages a player's heartbeat so they read as gone. */
async function goQuiet(code: string, playerId: string): Promise<void> {
  await store().hset(`room:${code}:seen`, playerId, Date.now() - 60_000);
}

/** Moves the current phase's deadline, without waiting out a real timer. */
async function setPhaseEnd(code: string, msFromNow: number): Promise<void> {
  const s = store();
  const key = `room:${code}`;
  const raw = await s.get<Record<string, unknown>>(key);
  await s.set(key, { ...raw, phaseEndsAt: Date.now() + msFromNow });
}

/** Fast-forwards past the current deadline. */
const expirePhase = (code: string) => setPhaseEnd(code, -1);

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

describe('when a round ends', () => {
  test('the clock running out closes it', async () => {
    await seedUniverse();
    const { room, playerId: hostId } = await createRoom('Mat', { roundsValue: 3 });
    const { playerId: anaId } = await joinRoom(room.code, 'Ana');
    await startGame(room.code, hostId);
    await spin(room.code, hostId, 700);

    // Nobody has answered, so only the deadline can end it.
    await assert.rejects(
      () => advance(room.code, hostId),
      /Round still running/,
      'an unanswered round runs its full length',
    );

    await expirePhase(room.code);
    const scored = await advance(room.code, hostId);
    assert.equal(scored.phase, 'reveal');
  });

  test('everyone locking in closes it too, without waiting out the clock', async () => {
    await seedUniverse();
    const { room, playerId: hostId } = await createRoom('Mat', { roundsValue: 3 });
    const { playerId: anaId } = await joinRoom(room.code, 'Ana');
    const { playerId: boId } = await joinRoom(room.code, 'Bo');
    await startGame(room.code, hostId);
    const spun = await spin(room.code, hostId, 700);

    await submitGuess(room.code, hostId, { price: 1, mcap: 1e6 });
    await submitGuess(room.code, anaId, { price: 2, mcap: 2e6 });

    // Two of three in: the last player is still entitled to their time.
    await assert.rejects(
      () => advance(room.code, hostId),
      /Round still running/,
      'one player outstanding keeps the round open',
    );

    await submitGuess(room.code, boId, { price: 3, mcap: 3e6 });

    const before = Date.now();
    const scored = await advance(room.code, hostId);
    assert.equal(scored.phase, 'reveal');
    assert.ok(
      before < (spun.phaseEndsAt ?? 0),
      'and it closed while there was still time on the clock',
    );
  });
});

describe('the reveal handing over to the standings', () => {
  /** Plays a round out and stops on the reveal, with its full clock ahead. */
  async function toReveal() {
    await seedUniverse();
    const { room, playerId: host } = await createRoom('Mat', { roundsValue: 3 });
    const { playerId: ana } = await joinRoom(room.code, 'Ana');
    await startGame(room.code, host);
    await spin(room.code, host, 700);
    for (const id of [host, ana]) {
      await submitGuess(room.code, id, { price: 1, mcap: 1e6 });
    }
    await advance(room.code, host); // -> reveal
    return { code: room.code, host };
  }

  test('is not handed to a client that knocks a moment early', async () => {
    const { code, host } = await toReveal();
    await setPhaseEnd(code, 200); // inside REVEAL_GRACE_MS

    const moved = await advance(code, host);
    assert.equal(
      moved.phase,
      'standings',
      'a countdown running slightly ahead of the server still ends the reveal',
    );
  });

  test('still owns the screen for as long as it has', async () => {
    const { code, host } = await toReveal();
    await setPhaseEnd(code, 3_000);

    await assert.rejects(
      () => advance(code, host),
      /Reveal still running/,
      'the grace window is a hair, not a licence to skip the reveal',
    );
  });
});

describe('starting the next round', () => {
  /** Plays one round out and stops on the standings between rounds. */
  async function toStandings() {
    await seedUniverse();
    const { room, playerId: host } = await createRoom('Mat', {
      roundsMode: 'flat',
      roundsValue: 4,
    });
    const { playerId: ana } = await joinRoom(room.code, 'Ana');
    const { playerId: bo } = await joinRoom(room.code, 'Bo');
    await startGame(room.code, host);
    await spin(room.code, host, 700);
    for (const id of [host, ana, bo]) {
      await submitGuess(room.code, id, { price: 1, mcap: 1e6 });
    }
    await advance(room.code, host); // -> reveal
    await advance(room.code, host); // -> standings

    const s = await publicState(room.code);
    const idx = s.players.findIndex((p) => p.id === s.activePlayerId);
    const next = s.players[(idx + 1) % s.players.length]!;
    const bystander = [host, ana, bo].find(
      (id) => id !== next.id && id !== s.hostId,
    ) as string;
    return { code: room.code, host, next: next.id, bystander };
  }

  test('belongs to the next player and the host, and nobody else', async () => {
    const { code, bystander } = await toStandings();
    await assert.rejects(
      () => advance(code, bystander),
      /Only the next player can start the round/,
      'a bystander cannot take the turn off someone who is right there',
    );
  });

  test('opens up to anyone once the next player has gone quiet', async () => {
    const { code, next, bystander } = await toStandings();
    await goQuiet(code, next);

    const started = await advance(code, bystander);
    assert.equal(started.phase, 'spinning');
    assert.equal(
      started.players[started.turnIdx]?.id,
      next,
      'the turn still passes to them — the spin rescue takes it from there',
    );
  });
});

describe('when the game ends', () => {
  /** Plays a whole game out and stops on the closing standings. */
  async function playToTheEnd(rounds: number) {
    await seedUniverse();
    const { room, playerId: host } = await createRoom('Mat', {
      roundsMode: 'flat',
      roundsValue: rounds,
    });
    const { playerId: ana } = await joinRoom(room.code, 'Ana');
    const { playerId: bo } = await joinRoom(room.code, 'Bo');
    await startGame(room.code, host);

    for (let r = 1; r <= rounds; r++) {
      const before = await publicState(room.code);
      await spin(room.code, before.activePlayerId as string, 700 + r);
      for (const id of [host, ana, bo]) {
        await submitGuess(room.code, id, { price: 1, mcap: 1e6 });
      }
      await advance(room.code, host); // -> reveal
      await advance(room.code, host); // -> standings
      if (r < rounds) await advance(room.code, host); // -> next round
    }
    return { code: room.code, host, ana, bo };
  }

  test('the closing standings is the last round, and the game is over', async () => {
    const { code } = await playToTheEnd(2);
    const s = await publicState(code);
    assert.equal(s.phase, 'standings');
    assert.equal(s.roundNo, s.totalRounds, 'every round has been played');
  });

  test('anyone still here can finish it, not just the host or the next player', async () => {
    const { code, host, ana, bo } = await playToTheEnd(2);
    const s = await publicState(code);

    // Whoever the next turn would have belonged to, and the host, are the two
    // the mid-game rule allows. Find somebody who is neither.
    const idx = s.players.findIndex((p) => p.id === s.activePlayerId);
    const next = s.players[(idx + 1) % s.players.length]!;
    const bystander = [host, ana, bo].find((id) => id !== next.id && id !== s.hostId);
    assert.ok(bystander, 'a three-player game has one');

    const ended = await advance(code, bystander);
    assert.equal(ended.phase, 'final', 'the game ends for a player with no turn to take');
  });

  test('there is nowhere to go from the podium', async () => {
    const { code, host } = await playToTheEnd(2);
    await advance(code, host);
    await assert.rejects(
      () => advance(code, host),
      /Cannot advance from final/,
      'a finished game stays finished',
    );
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

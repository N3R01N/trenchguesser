/**
 * Plays a complete game over HTTP against a running server.
 *
 *   BASE=http://localhost:3111 node scripts/playthrough.ts
 *
 * Exercises every route and prints the transcript, so a broken phase transition
 * shows up without opening a browser.
 */
import type { PublicState } from '../lib/room.ts';
import { usd, offBy } from '../lib/format.ts';
import type { Category } from '../lib/types.ts';

const BASE = process.env.BASE ?? 'http://localhost:3111';
const ROUNDS = 4;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${data.error ?? ''}`);
  return data;
}

const state = (code: string) => api<PublicState>(`/api/room/${code}/state`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log(`playing a game against ${BASE}\n`);

const created = await api<{ code: string; playerId: string }>('/api/room', {
  name: 'Mat',
  config: {
    categories: ['price', 'mcap'],
    baseRoundMs: 5_000,
    roundsMode: 'flat',
    roundsValue: ROUNDS,
    range: 'degen',
  },
});
const code = created.code;
console.log(`room ${code} created`);

const ana = await api<{ playerId: string }>(`/api/room/${code}/join`, { name: 'Ana' });
const bo = await api<{ playerId: string }>(`/api/room/${code}/join`, { name: 'Bo' });
const players: Record<string, string> = {
  [created.playerId]: 'Mat',
  [ana.playerId]: 'Ana',
  [bo.playerId]: 'Bo',
};
const ids = Object.keys(players);
console.log(`joined: ${Object.values(players).join(', ')}\n`);

await api(`/api/room/${code}/start`, { playerId: created.playerId });

for (let r = 1; r <= ROUNDS; r++) {
  let s = await state(code);
  if (s.phase !== 'spinning') throw new Error(`round ${r} expected spinning, got ${s.phase}`);

  const spinner = s.activePlayerId!;
  const { rank } = await api<{ rank: number }>(`/api/room/${code}/spin`, {
    playerId: spinner,
    rank: 100 + Math.floor(Math.random() * 2400),
  });

  s = await state(code);
  const round = s.round!;
  console.log(
    `round ${r}  #${rank}  ${round.coin.n} (${round.coin.s})  spun by ${players[spinner]}` +
      (round.mergedFdv ? '  [fdv merged]' : ''),
  );

  // Everyone guesses, wildly, except Bo in round 2 who goes quiet.
  for (const id of ids) {
    if (r === 2 && id === bo.playerId) continue;
    const values: Partial<Record<Category, number>> = {};
    for (const c of round.cats) values[c] = 10 ** (Math.random() * 10 - 4);
    await api(`/api/room/${code}/guess`, { playerId: id, values });
  }

  // Everyone in -> the round can end early; otherwise wait out the clock.
  s = await state(code);
  if (s.submitted.length < ids.length) {
    const left = (s.phaseEndsAt ?? Date.now()) - s.serverTime;
    await sleep(Math.max(0, left) + 200);
  }

  await api(`/api/room/${code}/advance`, { playerId: created.playerId });
  s = await state(code);
  if (s.phase !== 'reveal') throw new Error(`expected reveal, got ${s.phase}`);

  const truth = s.round!.truth!;
  const result = s.round!.result!;
  for (const outcome of result.outcomes) {
    const winners = outcome.winners.map((w) => players[w]).join(', ') || 'nobody';
    console.log(`   ${outcome.cat.padEnd(6)} ${usd(truth[outcome.cat]).padEnd(10)} won by ${winners}`);
    for (const id of ids) {
      const g = s.round!.guesses?.[id]?.values?.[outcome.cat] ?? null;
      console.log(
        `      ${players[id].padEnd(4)} ${(g === null ? '—' : usd(g)).padEnd(10)} ${offBy(g, truth[outcome.cat])}`,
      );
    }
  }
  const sum = Object.values(result.delta).reduce((a, b) => a + b, 0);
  console.log(
    `   delta ${ids.map((id) => `${players[id]} ${result.delta[id] > 0 ? '+' : ''}${result.delta[id]}`).join('  ')}  (sum ${sum})`,
  );
  if (sum !== 0) throw new Error(`round ${r} delta did not sum to zero`);

  // reveal -> standings
  const left = (s.phaseEndsAt ?? Date.now()) - s.serverTime;
  await sleep(Math.max(0, left) + 150);
  await api(`/api/room/${code}/advance`, { playerId: created.playerId });

  s = await state(code);
  if (s.phase !== 'standings') throw new Error(`expected standings, got ${s.phase}`);
  const total = s.players.reduce((a, p) => a + p.score, 0);
  console.log(
    `   standings ${s.players.map((p) => `${p.name} ${p.score}`).join('  ')}  (sum ${total})\n`,
  );
  if (total !== 0) throw new Error('running scores are not zero-sum');

  // standings -> next round, driven by whoever is up next
  const idx = s.players.findIndex((p) => p.id === s.activePlayerId);
  const next = s.players[(idx + 1) % s.players.length];
  await api(`/api/room/${code}/advance`, { playerId: next.id });
}

const final = await state(code);
if (final.phase !== 'final') throw new Error(`expected final, got ${final.phase}`);

const board = [...final.players].sort((a, b) => b.score - a.score);
console.log('final:');
for (const [i, p] of board.entries()) {
  console.log(`  ${i + 1}. ${p.name.padEnd(4)} ${String(p.score).padStart(3)}  (${p.catWins} category wins)`);
}
console.log(`\nzero-sum: ${board.reduce((a, p) => a + p.score, 0)}`);
console.log('playthrough ok');

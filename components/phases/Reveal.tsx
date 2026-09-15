'use client';

import type { PublicState } from '@/lib/room.ts';
import { CATEGORY_LABELS } from '@/lib/types.ts';
import { offBy, usd } from '@/lib/format.ts';
import { CoinHeader } from '../ui.tsx';

/** Screen 08 — the payoff. Phase 3 adds the count-up and the confetti. */
export function Reveal({ state, you }: { state: PublicState; you: string }) {
  const round = state.round!;
  const truth = round.truth!;
  const result = round.result!;
  const name = (id: string) => state.players.find((p) => p.id === id)?.name ?? '—';

  return (
    <main className="screen">
      <CoinHeader coin={round.coin} rank={round.rank} />

      <div className="screen-body">
        {result.outcomes.map((outcome) => {
          const actual = truth[outcome.cat];
          const rows = state.players
            .map((p) => ({
              id: p.id,
              name: p.name,
              guess: round.guesses?.[p.id]?.values?.[outcome.cat] ?? null,
              won: outcome.winners.includes(p.id),
            }))
            .sort((a, b) => Number(b.won) - Number(a.won));

          return (
            <div className="reveal-cat" key={outcome.cat}>
              <div className="row spread">
                <span className="label">
                  {outcome.cat === 'mcap' && round.mergedFdv
                    ? 'Market cap / FDV'
                    : CATEGORY_LABELS[outcome.cat]}
                </span>
                {outcome.winners.length === 0 && (
                  <span className="label">nobody guessed</span>
                )}
              </div>
              <span className="reveal-truth">{usd(actual)}</span>

              <div className="stack" style={{ gap: 4 }}>
                {rows.map((r) => (
                  <div
                    className={`reveal-row${r.won ? ' won' : ''}`}
                    key={r.id}
                  >
                    <span>
                      {r.won ? '🎯 ' : ''}
                      {r.name}
                      {r.id === you ? ' (you)' : ''}
                    </span>
                    <span className="reveal-guess">
                      {r.guess === null ? '—' : usd(r.guess)}
                    </span>
                    <span className="reveal-off">{offBy(r.guess, actual)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="screen-foot">
        <div className="row spread">
          <span className="label">This round</span>
          <span className="row" style={{ gap: 12 }}>
            {state.players.map((p) => {
              const d = result.delta[p.id] ?? 0;
              return (
                <span key={p.id} className={`player-delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>
                  {p.name.slice(0, 6)} {d > 0 ? `+${d}` : d}
                </span>
              );
            })}
          </span>
        </div>
        <p className="muted" style={{ textAlign: 'center' }}>
          Scores in a moment…
        </p>
      </div>

      <span className="label" style={{ textAlign: 'center' }}>
        {name(round.spunBy)} spun this one
      </span>
    </main>
  );
}

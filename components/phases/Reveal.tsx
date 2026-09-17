'use client';

import { useEffect, useState } from 'react';
import type { PublicState } from '@/lib/room.ts';
import {
  CATEGORY_LABELS,
  CATEGORY_UNITS,
  RANKED_BY,
  REVEAL_STEP_MS,
  type Unit,
} from '@/lib/types.ts';
import { amount, offBy } from '@/lib/format.ts';
import { revealTier, type RevealTier } from '@/lib/score.ts';
import { useCountUp, useStagger } from '@/lib/motion.ts';
import { buzz } from '@/lib/client.ts';
import { Confetti } from '../Confetti.tsx';
import { LogScale, type ScaleEntry } from '../LogScale.tsx';
import { CoinHeader } from '../ui.tsx';

const TIER_COPY: Record<RevealTier, string> = {
  bullseye: 'Bullseye',
  close: 'Close',
  off: 'Off',
  'way-off': 'Way off',
};

/** Screen 08 — the payoff. */
export function Reveal({ state, you }: { state: PublicState; you: string }) {
  const round = state.round!;
  const truth = round.truth!;
  const result = round.result!;

  const shown = useStagger(result.outcomes.length, REVEAL_STEP_MS);
  const [celebrated, setCelebrated] = useState(false);

  // One burst per round, the first time you nail a category.
  useEffect(() => {
    if (celebrated || shown === 0) return;
    const latest = result.outcomes[shown - 1];
    if (!latest) return;
    const mine = round.guesses?.[you]?.values?.[latest.cat] ?? null;
    if (revealTier(mine, truth[latest.cat]!, state.config.mode) === 'bullseye') {
      setCelebrated(true);
      buzz([18, 50, 18, 50, 34]);
    }
  }, [shown, celebrated, result.outcomes, round.guesses, truth, you, state.config.mode]);

  const spinner = state.players.find((p) => p.id === round.spunBy);

  return (
    <main className="screen">
      <Confetti fire={celebrated} />

      <div className="row spread">
        <CoinHeader
          coin={round.coin}
          rank={round.rank}
          rankedBy={RANKED_BY[state.config.mode]}
        />
        <span className="label">{spinner?.name} spun it</span>
      </div>

      <div className="screen-body">
        {result.outcomes.map((outcome, i) => {
          if (i >= shown) return null;
          // An outcome only exists for a category the round actually scored,
          // so its true value is always there.
          const actual = truth[outcome.cat]!;
          const mine = round.guesses?.[you]?.values?.[outcome.cat] ?? null;
          const tier = revealTier(mine, actual, state.config.mode);

          const entries: ScaleEntry[] = state.players.map((p) => ({
            id: p.id,
            name: p.name,
            guess: round.guesses?.[p.id]?.values?.[outcome.cat] ?? null,
            won: outcome.winners.includes(p.id),
            you: p.id === you,
          }));

          return (
            <RevealCategory
              key={outcome.cat}
              label={
                outcome.cat === 'mcap' && round.mergedFdv
                  ? 'Market cap / FDV'
                  : CATEGORY_LABELS[outcome.cat]
              }
              actual={actual}
              unit={CATEGORY_UNITS[outcome.cat]}
              mine={mine}
              tier={tier}
              entries={entries}
              nobody={outcome.winners.length === 0}
              isLatest={i === shown - 1}
            />
          );
        })}
      </div>

      <div className="screen-foot">
        <div className="delta-strip">
          {state.players.map((p) => {
            const d = result.delta[p.id] ?? 0;
            return (
              <span key={p.id} className="delta-chip">
                <span className="delta-name">{p.name.slice(0, 7)}</span>
                <span className={`player-delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>
                  {d > 0 ? `+${d}` : d}
                </span>
              </span>
            );
          })}
        </div>
      </div>
    </main>
  );
}

function RevealCategory({
  label,
  actual,
  unit,
  mine,
  tier,
  entries,
  nobody,
  isLatest,
}: {
  label: string;
  actual: number;
  unit: Unit;
  mine: number | null;
  tier: RevealTier;
  entries: ScaleEntry[];
  nobody: boolean;
  isLatest: boolean;
}) {
  const counted = useCountUp(actual, 900);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 950);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className={`reveal-cat tier-${tier}${isLatest && settled ? ' is-latest' : ''}`}
    >
      <div className="row spread">
        <span className="label">{label}</span>
        {nobody ? (
          <span className="label">nobody guessed</span>
        ) : (
          <span className={`tier-tag tier-${tier}`}>
            {TIER_COPY[tier]}
            {mine !== null && ` · ${offBy(mine, actual)}`}
          </span>
        )}
      </div>

      <span className="reveal-truth mono">{amount(counted, unit)}</span>

      <LogScale truth={actual} entries={entries} show={settled} unit={unit} />
    </div>
  );
}

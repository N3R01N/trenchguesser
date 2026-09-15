'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { buzz, post } from '@/lib/client.ts';
import type { PublicState } from '@/lib/room.ts';
import { CATEGORY_LABELS, type Category } from '@/lib/types.ts';
import { usd } from '@/lib/format.ts';
import { CoinHeader, TimerRing } from '../ui.tsx';

/**
 * Slider bounds per category, in orders of magnitude.
 *
 * A log slider is the only input that works here: typing $1,500,000 on a phone
 * keyboard inside ten seconds is not possible, and because scoring is itself
 * logarithmic, slider travel maps linearly onto score.
 */
const BOUNDS: Record<Category, [number, number]> = {
  price: [1e-9, 1e4],
  mcap: [1e4, 1e12],
  ath: [1e-9, 1e5],
  fdv: [1e4, 1e13],
  vol: [1e2, 1e11],
};

const STEPS = 1000;

function toValue(step: number, cat: Category): number {
  const [lo, hi] = BOUNDS[cat];
  const t = step / STEPS;
  return 10 ** (Math.log10(lo) + t * (Math.log10(hi) - Math.log10(lo)));
}

export function Guess({
  state,
  you,
  ms,
  onChanged,
}: {
  state: PublicState;
  you: string;
  ms: number | null;
  onChanged: () => void;
}) {
  const round = state.round!;
  const [steps, setSteps] = useState<Record<string, number>>(() =>
    Object.fromEntries(round.cats.map((c) => [c, STEPS / 2])),
  );
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);

  const submit = useCallback(async () => {
    if (sending.current || submitted) return;
    sending.current = true;
    try {
      const values = Object.fromEntries(
        round.cats.map((c) => [c, toValue(steps[c] ?? STEPS / 2, c)]),
      );
      await post(`/api/room/${state.code}/guess`, { playerId: you, values });
      setSubmitted(true);
      buzz(30);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      sending.current = false;
    }
  }, [onChanged, round.cats, state.code, steps, submitted, you]);

  // "click done, or after the time is over it is automatically submitted"
  useEffect(() => {
    if (ms !== null && ms <= 400 && !submitted) void submit();
  }, [ms, submitted, submit]);

  const locked = state.submitted.length;
  const total = state.players.length;

  return (
    <main className="screen">
      <div className="row spread">
        <CoinHeader coin={round.coin} rank={round.rank} />
        <TimerRing ms={ms ?? 0} totalMs={round.durationMs} size={72} />
      </div>

      <div className="screen-body">
        {round.cats.map((cat) => (
          <div className="guess" key={cat}>
            <div className="row spread">
              <span className="label">
                {cat === 'mcap' && round.mergedFdv
                  ? 'Market cap / FDV'
                  : CATEGORY_LABELS[cat]}
              </span>
            </div>
            <span className="guess-value">{usd(toValue(steps[cat] ?? 0, cat))}</span>
            <input
              type="range"
              min={0}
              max={STEPS}
              step={1}
              value={steps[cat] ?? STEPS / 2}
              disabled={submitted}
              aria-label={CATEGORY_LABELS[cat]}
              onChange={(e) =>
                setSteps((prev) => ({ ...prev, [cat]: Number(e.target.value) }))
              }
            />
            <div className="row spread">
              <span className="label">{usd(BOUNDS[cat][0])}</span>
              <span className="label">{usd(BOUNDS[cat][1])}</span>
            </div>
          </div>
        ))}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="screen-foot">
        <button
          className="btn btn-primary btn-lg"
          disabled={submitted}
          onClick={() => void submit()}
        >
          {submitted ? `Locked in — ${locked}/${total}` : 'Lock it in'}
        </button>
      </div>
    </main>
  );
}

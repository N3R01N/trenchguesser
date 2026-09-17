'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { buzz, post } from '@/lib/client.ts';
import type { PublicRound, PublicState } from '@/lib/room.ts';
import {
  CATEGORY_LABELS,
  CATEGORY_UNITS,
  RANKED_BY,
  SPIN_SETTLE_MS,
  type Category,
} from '@/lib/types.ts';
import { amount, decadeLabel } from '@/lib/format.ts';
import { prefersReducedMotion, useWakeLock } from '@/lib/motion.ts';
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
  // NFT collections, denominated in ETH. Far fewer decades than a coin spans,
  // so guesses cluster harder and rounds run tighter.
  floor: [1e-3, 1e3],
  atvol: [1e1, 1e7],
  owners: [1e1, 1e6],
  sales: [1e1, 1e7],
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
  introMs,
  onChanged,
}: {
  state: PublicState;
  you: string;
  ms: number | null;
  introMs: number | null;
  onChanged: () => void;
}) {
  const round = state.round!;
  const [steps, setSteps] = useState<Record<string, number>>(() =>
    Object.fromEntries(round.cats.map((c) => [c, STEPS / 2])),
  );
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);

  useWakeLock(!submitted);

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

  if (introMs !== null && introMs > 0) {
    return (
      <CoinIntro
        round={round}
        introMs={introMs}
        rankedBy={RANKED_BY[state.config.mode]}
      />
    );
  }

  const locked = state.submitted.length;
  const total = state.players.length;

  return (
    <main className="screen">
      <div className="row spread">
        <CoinHeader
          coin={round.coin}
          rank={round.rank}
          rankedBy={RANKED_BY[state.config.mode]}
        />
        <TimerRing ms={ms ?? 0} totalMs={round.durationMs} size={72} />
      </div>

      <div className="screen-body">
        {round.cats.map((cat) => (
          <LogSlider
            key={cat}
            cat={cat}
            label={
              cat === 'mcap' && round.mergedFdv
                ? 'Market cap / FDV'
                : CATEGORY_LABELS[cat]
            }
            step={steps[cat] ?? STEPS / 2}
            disabled={submitted}
            onChange={(v) => setSteps((prev) => ({ ...prev, [cat]: v }))}
          />
        ))}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="screen-foot">
        <button
          className={`btn btn-lg${submitted ? '' : ' btn-primary'}`}
          disabled={submitted}
          onClick={() => void submit()}
        >
          {submitted ? `Locked in — ${locked}/${total}` : 'Lock it in'}
        </button>
        {submitted && (
          <div className="locked-strip">
            {state.players.map((p) => (
              <span
                key={p.id}
                className={`locked-chip${
                  state.submitted.includes(p.id) ? ' is-in' : ''
                }`}
              >
                {p.name.slice(0, 8)}
              </span>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

/** The shared beat: the number lands, then the coin drops in, then sliders go live. */
function CoinIntro({
  round,
  introMs,
  rankedBy,
}: {
  round: PublicRound;
  introMs: number;
  rankedBy: string;
}) {
  const progress = 1 - introMs / SPIN_SETTLE_MS;
  const settling = progress < 0.5 && !prefersReducedMotion();
  const [shown, setShown] = useState(round.rank);
  const buzzed = useRef(false);

  useEffect(() => {
    if (!settling) {
      setShown(round.rank);
      if (!buzzed.current) {
        buzzed.current = true;
        buzz(45);
      }
      return;
    }
    let frame = 0;
    const tick = () => {
      // The flicker narrows onto the real number instead of stopping dead.
      const spread = Math.max(1, Math.round(300 * (1 - progress / 0.5)));
      setShown(round.rank + Math.round((Math.random() - 0.5) * 2 * spread));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [settling, progress, round.rank]);

  return (
    <main className="screen">
      <div className="screen-body center" style={{ justifyContent: 'center' }}>
        <span className="label">Rank</span>
        <div className={`reel${settling ? ' is-spinning' : ' is-landed'}`}>
          <span className="reel-number mono">{shown}</span>
        </div>

        <div className={`intro-coin${settling ? '' : ' is-in'}`}>
          <CoinHeader coin={round.coin} rank={round.rank} rankedBy={rankedBy} />
        </div>
      </div>

      <div className="screen-foot">
        <button className="btn btn-lg" disabled>
          Get ready…
        </button>
      </div>
    </main>
  );
}

function LogSlider({
  cat,
  label,
  step,
  disabled,
  onChange,
}: {
  cat: Category;
  label: string;
  step: number;
  disabled: boolean;
  onChange: (step: number) => void;
}) {
  const value = toValue(step, cat);
  const unit = CATEGORY_UNITS[cat];
  const [lo, hi] = BOUNDS[cat];
  const decade = useRef(Math.floor(Math.log10(value)));

  function handle(next: number) {
    const nextDecade = Math.floor(Math.log10(toValue(next, cat)));
    if (nextDecade !== decade.current) {
      decade.current = nextDecade;
      buzz(6); // a tick at every order of magnitude
    }
    onChange(next);
  }

  // Tick every three decades so every label lands on a K/M/B/T boundary —
  // mixing "$1M" with "1e10" on one axis reads as a bug.
  const decades: number[] = [];
  const first = Math.ceil(Math.log10(lo));
  const last = Math.floor(Math.log10(hi));
  for (let d = Math.ceil(first / 3) * 3; d <= last; d += 3) decades.push(d);

  return (
    <div className="guess">
      <span className="label">{label}</span>
      <span className="guess-value">{amount(value, unit)}</span>
      <input
        type="range"
        min={0}
        max={STEPS}
        step={1}
        value={step}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={amount(value, unit)}
        style={{ '--fill': `${(step / STEPS) * 100}%` } as React.CSSProperties}
        onChange={(e) => handle(Number(e.target.value))}
      />
      <div className="guess-scale" aria-hidden="true">
        {decades.map((d) => (
          <span
            key={d}
            style={{
              left: `${((d - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * 100}%`,
            }}
          >
            {decadeLabel(d, unit)}
          </span>
        ))}
      </div>
    </div>
  );
}

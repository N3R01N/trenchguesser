'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { buzz, post } from '@/lib/client.ts';
import type { PublicRound, PublicState } from '@/lib/room.ts';
import {
  ART,
  INTRO_ART_SIZE,
  CATEGORY_BOUNDS,
  CATEGORY_LABELS,
  CATEGORY_OVER_CAP,
  CATEGORY_UNITS,
  OVER_CAP_GUESS,
  RANKED_BY,
  RANK_LABEL,
  SPIN_SETTLE_MS,
  zeroMeans,
  type Category,
} from '@/lib/types.ts';
import { amount, decadeLabel } from '@/lib/format.ts';
import { prefersReducedMotion, useWakeLock } from '@/lib/motion.ts';
import { CoinHeader, TimerRing, type Art } from '../ui.tsx';

const STEPS = 1000;

function toValue(step: number, cat: Category): number {
  const [lo, hi] = CATEGORY_BOUNDS[cat];
  const t = step / STEPS;
  const value = 10 ** (Math.log10(lo) + t * (Math.log10(hi) - Math.log10(lo)));
  // A count is a whole number of things, and the readout already rounds it —
  // so the axis rounds too, and nobody wins a punk's sale count by 0.4 of a
  // sale they were never shown.
  return CATEGORY_UNITS[cat] === 'count' ? Math.round(value) : value;
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
  /** A category answered with a bucket rather than a position on the axis. */
  const [buckets, setBuckets] = useState<Record<string, Bucket>>({});
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);

  useWakeLock(!submitted);

  const submit = useCallback(async () => {
    if (sending.current || submitted) return;
    sending.current = true;
    try {
      const values = Object.fromEntries(
        round.cats.map((c) => {
          const bucket = buckets[c];
          if (bucket === 'zero') return [c, 0];
          if (bucket === 'over') return [c, OVER_CAP_GUESS];
          return [c, toValue(steps[c] ?? STEPS / 2, c)];
        }),
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
  }, [onChanged, round.cats, state.code, steps, buckets, submitted, you]);

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
        rankLabel={RANK_LABEL[state.config.mode]}
        art={{ ...ART[state.config.mode], size: INTRO_ART_SIZE[state.config.mode] }}
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
          art={ART[state.config.mode]}
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
            bucket={buckets[cat]}
            disabled={submitted}
            onChange={(v) => {
              setSteps((prev) => ({ ...prev, [cat]: v }));
              setBuckets((prev) => ({ ...prev, [cat]: undefined }));
            }}
            onBucket={(b) =>
              setBuckets((prev) => ({ ...prev, [cat]: prev[cat] === b ? undefined : b }))
            }
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
  rankLabel,
  art,
}: {
  round: PublicRound;
  introMs: number;
  rankedBy: string;
  rankLabel: string;
  art: Art;
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
        <span className="label">{rankLabel}</span>
        <div className={`reel${settling ? ' is-spinning' : ' is-landed'}`}>
          <span className="reel-number mono">{shown}</span>
        </div>

        <div className={`intro-coin${settling ? '' : ' is-in'}`}>
          <CoinHeader
            coin={round.coin}
            rank={round.rank}
            rankedBy={rankedBy}
            art={art}
          />
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

type Bucket = 'zero' | 'over' | undefined;

function LogSlider({
  cat,
  label,
  step,
  bucket,
  disabled,
  onChange,
  onBucket,
}: {
  cat: Category;
  label: string;
  step: number;
  bucket: Bucket;
  disabled: boolean;
  onChange: (step: number) => void;
  onBucket: (b: Exclude<Bucket, undefined>) => void;
}) {
  const value = toValue(step, cat);
  const unit = CATEGORY_UNITS[cat];
  const [lo, hi] = CATEGORY_BOUNDS[cat];
  const zeroLabel = zeroMeans(cat);
  const overCap = CATEGORY_OVER_CAP[cat];
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
  // mixing "$1M" with "1e10" on one axis reads as a bug. A short axis gets a
  // tick per decade instead, because three would leave it with one label.
  const decades: number[] = [];
  const first = Math.ceil(Math.log10(lo));
  const last = Math.floor(Math.log10(hi));
  const every = last - first > 3 ? 3 : 1;
  const start = every === 3 ? Math.ceil(first / 3) * 3 : first;
  for (let d = start; d <= last; d += every) decades.push(d);

  return (
    <div className="guess">
      <span className="label">{label}</span>
      <span className="guess-value">
        {bucket === 'zero'
          ? zeroLabel
          : bucket === 'over'
            ? `Over ${overCap?.toLocaleString('en-US')} ETH`
            : amount(value, unit)}
      </span>
      <input
        type="range"
        min={0}
        max={STEPS}
        step={1}
        value={step}
        disabled={disabled || bucket !== undefined}
        aria-label={label}
        aria-valuetext={amount(value, unit)}
        style={{ '--fill': `${(step / STEPS) * 100}%` } as React.CSSProperties}
        onChange={(e) => handle(Number(e.target.value))}
      />
      {(zeroLabel || overCap) && (
        <div className="buckets">
          {zeroLabel && (
            <button
              type="button"
              className="chip"
              aria-pressed={bucket === 'zero'}
              disabled={disabled}
              onClick={() => onBucket('zero')}
            >
              {zeroLabel}
            </button>
          )}
          {overCap && (
            <button
              type="button"
              className="chip"
              aria-pressed={bucket === 'over'}
              disabled={disabled}
              onClick={() => onBucket('over')}
            >
              Over {overCap.toLocaleString('en-US')}
            </button>
          )}
        </div>
      )}

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

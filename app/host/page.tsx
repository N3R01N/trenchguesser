'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client.ts';
import { lastName, rememberPlayer } from '@/lib/identity.ts';
import { Spinner, WaitNote, type WaitStage } from '@/components/ui.tsx';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  DEFAULT_CONFIG,
  RANGES,
  roundDuration,
  type Category,
  type RangeKey,
} from '@/lib/types.ts';

/**
 * Creating a room rebuilds the coin snapshot when the cached one has aged out,
 * which crawls CoinGecko for the better part of a minute. These track the real
 * phases of that crawl so a cold build reads as work rather than a hang.
 */
const BUILD_STAGES: WaitStage[] = [
  { after: 0, text: 'Checking for a recent coin list…' },
  { after: 6, text: 'Crawling the market-cap rankings…' },
  { after: 22, text: 'Dropping stablecoins, wrapped and bridged tokens…' },
  { after: 45, text: 'Nearly there — the first game after a deploy is the slow one.' },
];

const BASE_CHOICES = [5_000, 10_000, 15_000, 20_000];
const PER_PLAYER_CHOICES = [1, 2, 3];
const FLAT_CHOICES = [5, 10, 15, 20];

export default function HostSetup() {
  const router = useRouter();
  const [name, setName] = useState(() => lastName());
  const [categories, setCategories] = useState<Category[]>([
    ...DEFAULT_CONFIG.categories,
  ]);
  const [baseRoundMs, setBaseRoundMs] = useState(DEFAULT_CONFIG.baseRoundMs);
  const [roundsMode, setRoundsMode] = useState<'flat' | 'perPlayer'>('flat');
  const [roundsValue, setRoundsValue] = useState(10);
  const [range, setRange] = useState<RangeKey>('degen');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(cat: Category) {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  }

  function pickRounds(mode: 'flat' | 'perPlayer') {
    setRoundsMode(mode);
    setRoundsValue(mode === 'flat' ? 10 : 2);
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ code: string; playerId: string }>('/api/room', {
        name,
        config: { categories, baseRoundMs, roundsMode, roundsValue, range },
      });
      rememberPlayer(res.code, res.playerId, name);
      router.push(`/room/${res.code}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const seconds = Math.round(roundDuration(baseRoundMs, categories.length) / 1000);

  return (
    <main className="screen">
      <div className="row spread">
        <h2>New game</h2>
        <button className="btn btn-ghost" onClick={() => router.push('/')}>
          Cancel
        </button>
      </div>

      <div className="screen-body">
        <div className="field">
          <span className="label">Your name</span>
          <input
            type="text"
            maxLength={16}
            placeholder="Degen McGee"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="field">
          <span className="label">Guess what</span>
          <div className="chips">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className="chip"
                aria-pressed={categories.includes(cat)}
                onClick={() => toggle(cat)}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
          {categories.includes('mcap') && categories.includes('fdv') && (
            <p className="muted">
              FDV matches market cap for about half of all coins. When it does,
              that round scores them as one.
            </p>
          )}
        </div>

        <div className="field">
          <span className="label">Round length</span>
          <div className="segments">
            {BASE_CHOICES.map((ms) => (
              <button
                key={ms}
                type="button"
                className="segment"
                aria-pressed={baseRoundMs === ms}
                onClick={() => setBaseRoundMs(ms)}
              >
                {ms / 1000}s
              </button>
            ))}
          </div>
          <p className="muted">
            {categories.length > 1
              ? `${seconds}s per round — each extra thing to guess adds 5s.`
              : `${seconds}s per round.`}
          </p>
        </div>

        <div className="field">
          <span className="label">Rounds</span>
          <div className="segments">
            <button
              type="button"
              className="segment"
              aria-pressed={roundsMode === 'flat'}
              onClick={() => pickRounds('flat')}
            >
              Total
            </button>
            <button
              type="button"
              className="segment"
              aria-pressed={roundsMode === 'perPlayer'}
              onClick={() => pickRounds('perPlayer')}
            >
              Per player
            </button>
          </div>
          <div className="segments">
            {(roundsMode === 'flat' ? FLAT_CHOICES : PER_PLAYER_CHOICES).map((v) => (
              <button
                key={v}
                type="button"
                className="segment"
                aria-pressed={roundsValue === v}
                onClick={() => setRoundsValue(v)}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Difficulty</span>
          <div className="segments">
            {(Object.keys(RANGES) as RangeKey[]).map((key) => (
              <button
                key={key}
                type="button"
                className="segment"
                aria-pressed={range === key}
                onClick={() => setRange(key)}
              >
                {RANGES[key].label}
              </button>
            ))}
          </div>
          <p className="muted">
            Ranks {RANGES[range].from}–{RANGES[range].to} by market cap.
          </p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="screen-foot">
        {busy && <WaitNote title="Building the coin list" stages={BUILD_STAGES} />}
        <button
          className="btn btn-primary btn-lg"
          disabled={busy || !name.trim() || categories.length === 0}
          onClick={create}
        >
          {busy ? (
            <>
              <Spinner size={16} />
              Setting up…
            </>
          ) : (
            'Create game'
          )}
        </button>
      </div>
    </main>
  );
}

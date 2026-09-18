'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client.ts';
import { lastName, rememberPlayer } from '@/lib/identity.ts';
import { Spinner, WaitNote, type WaitStage } from '@/components/ui.tsx';
import { ThemeToggle } from '@/components/ThemeToggle.tsx';
import {
  CATEGORY_LABELS,
  DEFAULT_CATEGORIES,
  DEFAULT_CONFIG,
  RANKED_BY,
  RANK_LIMITS,
  UNIVERSE_CATEGORIES,
  UNIVERSE_LABELS,
  UNIVERSE_RANGES,
  normalizeRankRange,
  roundDuration,
  type Category,
  type RangeKey,
  type UniverseKey,
} from '@/lib/types.ts';

/**
 * Creating a room rebuilds the snapshot when the cached one has aged out. The
 * coin crawl takes the better part of a minute; the collection ladder is thirty
 * requests and lands in seconds, because NFT numbers are fetched per round
 * instead. These track the real phases so a cold build reads as work, not a hang.
 */
const BUILD_STAGES: Record<UniverseKey, WaitStage[]> = {
  coins: [
    { after: 0, text: 'Checking for a recent coin list…' },
    { after: 6, text: 'Crawling the market-cap rankings…' },
    { after: 22, text: 'Dropping stablecoins, wrapped and bridged tokens…' },
    { after: 45, text: 'Nearly there — the first game after a deploy is the slow one.' },
  ],
  nfts: [
    { after: 0, text: 'Checking for a recent collection list…' },
    { after: 3, text: 'Walking the all-time volume ladder…' },
    { after: 10, text: 'Dropping unverified and hidden collections…' },
  ],
  punks: [
    { after: 0, text: 'Checking for a recent punk history…' },
    { after: 3, text: 'Reading every punk sale since June 2017…' },
    { after: 12, text: 'Folding thirty thousand sales down to ten thousand punks…' },
  ],
};

const BASE_CHOICES = [5_000, 10_000, 15_000, 20_000];
const PER_PLAYER_CHOICES = [1, 2, 3];
const FLAT_CHOICES = [5, 10, 15, 20];

export default function HostSetup() {
  const router = useRouter();
  const [name, setName] = useState(() => lastName());
  const [mode, setMode] = useState<UniverseKey>(DEFAULT_CONFIG.mode);
  const [categories, setCategories] = useState<Category[]>([
    ...DEFAULT_CONFIG.categories,
  ]);
  const [baseRoundMs, setBaseRoundMs] = useState(DEFAULT_CONFIG.baseRoundMs);
  const [roundsMode, setRoundsMode] = useState<'flat' | 'perPlayer'>('flat');
  const [roundsValue, setRoundsValue] = useState(10);
  /**
   * The difficulties are a starting point, not the choice.
   *
   * Tapping one fills the two numbers below it and the host can then move
   * either — "Noob coin, but 50 to 200" is a table's own idea of easy, and no
   * preset was ever going to name it. Held as text so a half-typed number is
   * allowed to exist; what gets sent is normalised.
   */
  const [rankFrom, setRankFrom] = useState(String(DEFAULT_CONFIG.rankFrom));
  const [rankTo, setRankTo] = useState(String(DEFAULT_CONFIG.rankTo));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const bounds = normalizeRankRange(mode, Number(rankFrom), Number(rankTo));

  /** Categories and ranks belong to a universe, so switching starts them over. */
  function pickMode(next: UniverseKey) {
    setMode(next);
    setCategories([...DEFAULT_CATEGORIES[next]]);
    pickRange(UNIVERSE_RANGES[next].degen);
  }

  function pickRange({ from, to }: { from: number; to: number }) {
    setRankFrom(String(from));
    setRankTo(String(to));
  }

  /** Whatever was typed becomes the range the game can actually be played on. */
  function settle() {
    pickRange(bounds);
  }

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
        config: {
          mode,
          categories,
          baseRoundMs,
          roundsMode,
          roundsValue,
          rankFrom: bounds.from,
          rankTo: bounds.to,
        },
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
        <div className="row">
          <ThemeToggle />
          <button className="btn btn-ghost" onClick={() => router.push('/')}>
            Cancel
          </button>
        </div>
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
          <span className="label">Guess on</span>
          <div className="segments">
            {(Object.keys(UNIVERSE_LABELS) as UniverseKey[]).map((key) => (
              <button
                key={key}
                type="button"
                className="segment"
                aria-pressed={mode === key}
                onClick={() => pickMode(key)}
              >
                {UNIVERSE_LABELS[key]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Guess what</span>
          <div className="chips">
            {UNIVERSE_CATEGORIES[mode].map((cat) => (
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

        {mode !== 'punks' && (
          <div className="field">
            <span className="label">Difficulty</span>
            <div className="segments">
              {(Object.keys(UNIVERSE_RANGES[mode]) as RangeKey[]).map((key) => {
                const preset = UNIVERSE_RANGES[mode][key];
                return (
                  <button
                    key={key}
                    type="button"
                    className="segment"
                    aria-pressed={
                      bounds.from === preset.from && bounds.to === preset.to
                    }
                    onClick={() => pickRange(preset)}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <div className="range-row">
              <label className="field">
                <span className="label">From rank</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  value={rankFrom}
                  onChange={(e) => setRankFrom(e.target.value.replace(/\D/g, ''))}
                  onBlur={settle}
                />
              </label>
              <label className="field">
                <span className="label">To rank</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  value={rankTo}
                  onChange={(e) => setRankTo(e.target.value.replace(/\D/g, ''))}
                  onBlur={settle}
                />
              </label>
            </div>

            <p className="muted">
              Ranks {bounds.from}–{bounds.to} by {RANKED_BY[mode]}. Anything from{' '}
              {RANK_LIMITS[mode].min} to {RANK_LIMITS[mode].max} is fair game.
            </p>
          </div>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="screen-foot">
        {busy && (
          <WaitNote
            title={mode === 'nfts' ? 'Building the collection list' : 'Building the coin list'}
            stages={BUILD_STAGES[mode]}
          />
        )}
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

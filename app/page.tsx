'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client.ts';
import { lastName, rememberPlayer } from '@/lib/identity.ts';

export default function Home() {
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function openJoin() {
    setName((n) => n || lastName());
    setJoining(true);
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const clean = code.trim().toUpperCase();
      const res = await post<{ code: string; playerId: string }>(
        `/api/room/${encodeURIComponent(clean)}/join`,
        { name },
      );
      rememberPlayer(res.code, res.playerId, name);
      router.push(`/room/${res.code}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="screen">
      <div className="screen-body center" style={{ justifyContent: 'center' }}>
        <h1 style={{ fontSize: 44 }}>Trenchguesser</h1>
        <p className="muted">
          Spin a number. That is a coin&apos;s market-cap rank. Guess what
          it&apos;s worth before the clock runs out.
        </p>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="screen-foot">
        {joining ? (
          <form className="stack" onSubmit={join}>
            <div className="field">
              <span className="label">Game code</span>
              <input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                autoFocus
                maxLength={4}
                placeholder="K4XP"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="mono"
                style={{ fontSize: 24, letterSpacing: '0.2em', textAlign: 'center' }}
              />
            </div>
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
            <button
              className="btn btn-primary btn-lg"
              disabled={busy || code.trim().length < 4 || !name.trim()}
            >
              {busy ? 'Joining…' : 'Join game'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setJoining(false)}
            >
              Back
            </button>
          </form>
        ) : (
          <>
            <button
              className="btn btn-primary btn-lg"
              onClick={() => router.push('/host')}
            >
              Host a game
            </button>
            <button className="btn btn-lg" onClick={openJoin}>
              Join a game
            </button>
          </>
        )}
      </div>
    </main>
  );
}
